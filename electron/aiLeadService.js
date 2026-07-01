const fs = require("fs");
const path = require("path");
const GlobalSetting = require("./models/Setting");
const AiLeadQueue = require("./models/AiLeadQueue");
const AiLeadBlacklist = require("./models/AiLeadBlacklist");
const { createJsonChatCompletion } = require("./aiClient");
const { Api } = require("telegram/tl");

function readAgentKnowledgeFile(fileName, label) {
  try {
    const filePath = path.join(
      process.cwd(),
      ".agents",
      "knowledge",
      fileName,
    );
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf8");
    }
  } catch (err) {
    console.error(`[AILead] Error reading ${label}:`, err.message);
  }
  return "";
}

function getTelegramBotRolePrompt() {
  return readAgentKnowledgeFile("telegram_bot_role.md", "telegram_bot_role.md");
}

function getPrivateSupportPrompt() {
  return readAgentKnowledgeFile("private_support_prompt.md", "private_support_prompt.md");
}

const seenMessages = new Set();
const groupBadSenders = new Map(); // key: "accountId:senderId", value: { accountId, senderId, senderName, score, reason, addedAt }
const accountDailyCounts = new Map();
const groupDailyCounts = new Map();
const groupCooldowns = new Map();
const userCooldowns = new Map();
let autoSendQueueTimer = null;
let autoSendQueueRunning = false;
const senderProfileTextCache = new Map();
const botLikeUserNotifyKeys = new Set();

async function addToBadSenders(
  accountId,
  senderId,
  senderName = "",
  score = 0,
  reason = "",
  extra = {},
) {
  if (!senderId) return null;
  const key = `${accountId}:${senderId}`;
  const item = {
    accountId,
    senderId,
    senderName: senderName || "Unknown user",
    score,
    riskScore: Number(extra.riskScore || 0),
    reason: reason || "AI score below limit",
    chatId: extra.chatId || "",
    sourceType: extra.sourceType || "group",
    addedAt: new Date().toISOString(),
  };
  groupBadSenders.set(key, item);
  if (groupBadSenders.size > 20000) {
    const firstKey = groupBadSenders.keys().next().value;
    if (firstKey) groupBadSenders.delete(firstKey);
  }
  await AiLeadBlacklist.upsert(item).catch((err) => {
    console.error("[AILead] Failed to persist blacklist item:", err.message);
  });
  return item;
}

async function isBlacklisted(accountId, senderId) {
  if (!senderId) return false;
  const key = `${accountId}:${senderId}`;
  if (groupBadSenders.has(key)) return true;
  const item = await AiLeadBlacklist.findOne(accountId, senderId).catch(
    () => null,
  );
  if (item) groupBadSenders.set(key, item);
  return !!item;
}

async function getBlacklist() {
  const rows = await AiLeadBlacklist.findRecent(500).catch(() => []);
  for (const item of rows)
    groupBadSenders.set(`${item.accountId}:${item.senderId}`, item);
  const merged = new Map(
    [...Array.from(groupBadSenders.values()), ...rows].map((item) => [
      `${item.accountId}:${item.senderId}`,
      item,
    ]),
  );
  return Array.from(merged.values());
}

async function removeFromBlacklist(accountId, senderId) {
  const key = `${accountId}:${senderId}`;
  groupBadSenders.delete(key);
  return AiLeadBlacklist.delete(accountId, senderId);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function countKey(...parts) {
  return [todayKey(), ...parts].join(":");
}

function getMessageText(message) {
  return (message?.message || message?.text || "").trim();
}

function hasMessageMedia(message) {
  return Boolean(message?.media);
}

function getForwardMetaText(message) {
  const fwd = message?.fwdFrom || message?.forward || message?.forwardedFrom;
  if (!fwd) return "";
  return [
    fwd.fromName,
    fwd.postAuthor,
    fwd.savedFromName,
    fwd.fromId?.userId?.toString?.(),
    fwd.fromId?.channelId?.toString?.(),
    fwd.savedFromPeer?.userId?.toString?.(),
    fwd.savedFromPeer?.channelId?.toString?.(),
  ]
    .filter(Boolean)
    .join("\n");
}

async function getUserProfileText(client, userLike) {
  if (!client || !userLike) return "";
  try {
    const entity = await client.getEntity(userLike);
    const full =
      entity?.className === "User"
        ? await client.invoke(new Api.users.GetFullUser({ id: entity }))
        : null;
    return [
      entity?.username,
      entity?.firstName,
      entity?.lastName,
      entity?.title,
      full?.fullUser?.about,
      full?.users?.[0]?.username,
      full?.users?.[0]?.firstName,
      full?.users?.[0]?.lastName,
    ]
      .filter(Boolean)
      .join("\n");
  } catch (_) {
    return "";
  }
}

async function getForwardQuoteContext({ client, message }) {
  const parts = [getForwardMetaText(message)];
  const fwd = message?.fwdFrom || message?.forward || message?.forwardedFrom;
  const fwdUserLike =
    fwd?.fromId?.userId ||
    fwd?.fromId ||
    fwd?.savedFromPeer?.userId ||
    fwd?.savedFromPeer;
  const fwdProfile = await getUserProfileText(client, fwdUserLike);
  if (fwdProfile) parts.push(fwdProfile);

  const replyToId = getReplyToMessageId(message);
  if (replyToId && client) {
    try {
      const entity = message?.chat || message?.chatId || message?.peerId;
      const replies = await client.getMessages(entity, {
        ids: [Number(replyToId)],
      });
      const quoted = Array.isArray(replies) ? replies[0] : replies;
      if (quoted) {
        parts.push(getMessageText(quoted));
        parts.push(getForwardMetaText(quoted));
        const quotedSenderProfile = await getUserProfileText(
          client,
          quoted.sender || quoted.senderId || quoted.fromId?.userId || quoted.fromId,
        );
        if (quotedSenderProfile) parts.push(quotedSenderProfile);
      }
    } catch (_) {}
  }

  return parts.filter(Boolean).join("\n");
}

function getChatTitle(message) {
  return (
    message?.chat?.title ||
    message?.chat?.username ||
    message?.chatId?.toString() ||
    "Unknown chat"
  );
}

function getSenderName(message) {
  const sender = message?.sender || {};
  return sender.username
    ? `@${sender.username}`
    : [sender.firstName, sender.lastName].filter(Boolean).join(" ") ||
        "Unknown user";
}

// Hàm getSenderId bị thiếu đã được khôi phục
function getSenderId(message) {
  return (
    message?.senderId?.toString?.() || message?.sender?.id?.toString?.() || ""
  );
}

function getChatId(message) {
  if (getSourceType(message || {}) === "private") {
    return (
      message.peerId?.userId?.toString?.() ||
      message.senderId?.toString?.() ||
      message.sender?.id?.toString?.() ||
      message.chat?.id?.toString?.() ||
      message.chatId?.toString?.() ||
      ""
    );
  }
  return (
    message.chatId?.toString() ||
    message.peerId?.channelId?.toString() ||
    message.peerId?.chatId?.toString() ||
    message.peerId?.userId?.toString() ||
    ""
  );
}

function getSourceType(message) {
  if (
    message.isPrivate ||
    message.chat?.className === "User" ||
    message.peerId?.userId
  )
    return "private";
  return "group";
}

function getReplyToMessageId(message) {
  return (
    message.replyToMsgId ||
    message.replyTo?.replyToMsgId ||
    message.replyTo?.replyToTopId ||
    ""
  );
}

function getTopicId(message) {
  return message.replyTo?.replyToTopId?.toString?.() || "";
}

function normalizeTelegramUsername(value) {
  return String(value || "")
    .replace(/^@+/, "")
    .trim();
}

function isTelegramBotLikeUsername(value) {
  const username = normalizeTelegramUsername(value);
  if (!username) return false;
  return /_bot$/i.test(username);
}

function getTelegramUsernamesFromText(text) {
  const rawText = String(text || "");
  const usernames = new Set();
  for (const match of rawText.matchAll(/@([a-zA-Z][\w]{3,31})\b/g)) {
    usernames.add(match[1]);
  }
  return Array.from(usernames);
}

function isBotLikeProfile(message) {
  const sender = message?.sender || {};
  const profileText = [
    sender.about,
    sender.bio,
    sender.description,
    message?.senderAbout,
    message?.senderBio,
    message?.senderDescription,
    message?.senderProfileAbout,
    message?.senderProfileBio,
  ]
    .filter(Boolean)
    .join("\n");
  return Boolean(
    sender.bot ||
    isTelegramBotLikeUsername(sender.username) ||
    isTelegramBotLikeUsername(message?.senderUsername) ||
    isTelegramBotLikeUsername(message?.username) ||
    hasBotLikeContent(profileText),
  );
}

function hasBotLikeContent(text) {
  const raw = String(text || "");
  return getTelegramUsernamesFromText(raw).some(isTelegramBotLikeUsername);
}

function findBotUsernameInText(text) {
  const raw = String(text || "");
  const match = raw.match(/@?([a-zA-Z][\w]{3,31}_bot)\b/i);
  return match ? match[1] : "";
}

function isLikelySelfMessage(settings, accountId, message, text) {
  const selfNames = [settings?.telegramBotUsername, "teleshopbotcommm"]
    .filter(Boolean)
    .map((value) => normalizeTelegramUsername(value).toLowerCase());
  const senderNames = [
    message?.sender?.username,
    message?.senderUsername,
    getSenderName(message),
  ]
    .filter(Boolean)
    .map((value) =>
      normalizeTelegramUsername(value).replace(/^@/, "").toLowerCase(),
    );
  const senderId = getSenderId(message);
  if (senderId && String(senderId) === String(accountId)) return true;
  if (senderNames.some((name) => selfNames.includes(name))) return true;
  return /\bteleshopbot\b/i.test(String(text || ""));
}

function isLowContextMessage(text) {
  const raw = String(text || "").trim();
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length <= 3 && raw.length < 35) return true;
  return /^(need chat|dm me|pm me|hi|hello|up|available|check dm|done)$/i.test(
    raw,
  );
}

function isBotLikeSellerAdText(text) {
  const raw = String(text || "");
  if (!raw.trim()) return false;
  const lower = raw.toLowerCase();
  const hasBotUsernameOrLink = /(?:@|(?:https?:\/\/)?t\.me\/|telegram\.me\/)[a-z0-9_]*bot/i.test(raw);
  const hasBotSellerPhrase = /(bot\s+(setor|order|shop|deposit|auto)|auto\s+bot|order\s+lewat\s+bot|shop\s+bot|buy\s+bot|sell\s+bot)/i.test(lower);
  const telegramRefs = raw.match(/(?:https?:\/\/)?t\.me\/\S+|@[a-z0-9_]{4,}/gi) || [];
  return hasBotUsernameOrLink || (hasBotSellerPhrase && telegramRefs.length >= 2);
}

function isBuyerStyleReply(reply) {
  const normalized = normalizeReplyFingerprint(reply);
  if (!normalized) return false;
  const buyerOnlyPatterns = [
    /^any bulk price/,
    /^bulk price/,
    /^best price/,
    /^last price/,
    /^price for/,
    /^how much/,
    /^how many (keys|accounts|pcs|pieces|stock)/,
    /^do you have (stock|bulk|warranty)/,
    /^is (it )?available/,
    /^available for/,
    /^can i buy/,
    /^need (price|stock|supplier)/,
    /^what.*(price|warranty|stock)/,
  ];
  return buyerOnlyPatterns.some((pattern) => pattern.test(normalized));
}

function isPromotionPurpose(purpose = "") {
  const normalized = String(purpose || "").toLowerCase();
  return /promo|promotion|quảng bá|quang ba|seed|soft/.test(normalized);
}

function getPromotionPurposePrompt(purpose = "") {
  if (!isPromotionPurpose(purpose)) return "";
  return `
Soft-promotion purpose rule:
- Promote our shop-bot solution indirectly. Do NOT mention the brand name TeleShopBot in public group replies.
- Use one message with this flow: ask a light operations question first, then pivot to a generic solution.
- Do NOT ask buyer questions about buying price, warranty, delivery availability, or supplier details.
- If the seller posts many product packages, tiers, or bulk pricing, ask a workflow question about whether they can manage that volume/pricing cleanly, then pivot.
- Ask about seller workflow instead: handling many packages, tier prices, DMs, tracking orders, managing stock, payment checks, delivery, proof, or referrals.
- Then softly suggest a generic Telegram shop bot, auto delivery bot, simple dashboard, stock/order tracking, tier/package management, auto payment notes, or referral tracking.
- Never praise or promote the other seller's product. Use their post only as context to pivot toward better selling workflow.
- No direct links, no @mentions, no brand name. If you cannot naturally ask-then-pivot, set should_reply false.
- Good reply examples: "Do you manage bulk prices manually? A shop bot keeps packages and orders cleaner.", "Lots of plans here, do you track each buyer in DM? A small dashboard helps.", "Do you handle all Gmail orders in DM? A shop bot with stock tracking saves time.", "Are 7d/30d plans delivered manually? Auto delivery is cleaner when orders pile up.", "Do buyers send payment proof in DM? A small dashboard keeps paid/unpaid orders clear."
`;
}
function mentionsPublicPromotionBrand(reply) {
  return /\bteleshop\s*bot\b|\bteleshopbot\b/i.test(String(reply || ""));
}

function isOverPoliteBotToneReply(reply) {
  const text = String(reply || "").trim();
  return (
    /\b(thanks|thank you|please|happy to help|glad to help|dear|sir|welcome)\b/i.test(
      text,
    ) ||
    /^(nice|looks|solid|got it|yeah|good stuff)\b/i.test(text) ||
    (/\b(mate|buddy|dude)\b/i.test(text) && text.length > 80)
  );
}
function shouldIgnoreBotLikeUser(settings, message, text) {
  if (settings?.aiLeadIgnoreBotLikeUsers !== true) return false;
  const sender = message?.sender || {};
  const username =
    sender.username || message?.senderUsername || message?.username || "";
  if (isTelegramBotLikeUsername(username)) return true;
  const profileText = [
    sender.about,
    sender.bio,
    sender.description,
    message?.senderAbout,
    message?.senderBio,
    message?.senderDescription,
    message?.senderProfileAbout,
    message?.senderProfileBio,
  ]
    .filter(Boolean)
    .join("\n");
  return Boolean(findBotUsernameInText(profileText));
}

async function getSenderProfileText({ accountId, client, message }) {
  const senderId = getSenderId(message);
  if (!client || !senderId) return "";
  const cacheKey = `${accountId}:${senderId}`;
  if (senderProfileTextCache.has(cacheKey))
    return senderProfileTextCache.get(cacheKey);

  let profileText = "";
  try {
    const user = message?.sender || (await client.getEntity(senderId));
    const full = await client.invoke(new Api.users.GetFullUser({ id: user }));
    profileText = [
      full?.fullUser?.about,
      full?.users?.[0]?.username,
      full?.users?.[0]?.firstName,
      full?.users?.[0]?.lastName,
    ]
      .filter(Boolean)
      .join("\n");
  } catch (_) {
    profileText = "";
  }

  senderProfileTextCache.set(cacheKey, profileText);
  if (senderProfileTextCache.size > 5000) {
    const firstKey = senderProfileTextCache.keys().next().value;
    if (firstKey) senderProfileTextCache.delete(firstKey);
  }
  return profileText;
}

function notifyBotLikeUserSkipped({ accountId, message, text, detection }) {
  const chatId = getChatId(message);
  const msgId = message?.id?.toString?.() || String(message?.id || "");
  const senderId = getSenderId(message);
  const key = `${accountId}:${chatId}:${senderId}:${detection.reason}:${detection.value}`;
  if (botLikeUserNotifyKeys.has(key)) return;
  botLikeUserNotifyKeys.add(key);
  if (botLikeUserNotifyKeys.size > 2000) {
    const firstKey = botLikeUserNotifyKeys.keys().next().value;
    if (firstKey) botLikeUserNotifyKeys.delete(firstKey);
  }
  notifyAdminSafe(
    [
      "Skipped bot-like seller user",
      `Reason: ${detection.reason}`,
      `Matched: ${detection.value}`,
      `Account: ${accountId}`,
      `Group: ${getChatTitle(message)}`,
      `Sender: ${getSenderName(message)}${senderId ? ` (${senderId})` : ""}`,
      `Message ID: ${msgId}`,
      "",
      `Text:\n${String(text || "").slice(0, 700)}`,
    ].join("\n"),
    {},
    {
      sourceType: "group",
      chatId,
      messageId: msgId,
      prefix: "bot_like_user",
    },
  );
}

async function getBotLikeUserDetection({ accountId, client, message }) {
  const sender = message?.sender || {};
  const username =
    sender.username || message?.senderUsername || message?.username || "";
  if (isTelegramBotLikeUsername(username)) {
    return { reason: "username_has__bot", value: `@${normalizeTelegramUsername(username)}`, bio: "" };
  }

  const inlineProfileText = [
    sender.about,
    sender.bio,
    sender.description,
    message?.senderAbout,
    message?.senderBio,
    message?.senderDescription,
    message?.senderProfileAbout,
    message?.senderProfileBio,
  ]
    .filter(Boolean)
    .join("\n");
  const profileText = findBotUsernameInText(inlineProfileText)
    ? inlineProfileText
    : await getSenderProfileText({ accountId, client, message });
  const botUsername = findBotUsernameInText(profileText);
  if (botUsername) {
    return { reason: "bio_has__bot", value: `@${normalizeTelegramUsername(botUsername)}`, bio: profileText };
  }
  return null;
}

async function shouldIgnoreBotLikeUserAsync(args) {
  const detection = await getBotLikeUserDetection(args);
  if (!detection) return false;
  notifyBotLikeUserSkipped({ ...args, detection });
  return true;
}

function isOfficialPrivateSupportUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || "").replace(/[).,]+$/, ""));
    const host = parsed.hostname.toLowerCase();
    return host === "teleshopbot.com" || host === "www.teleshopbot.com" || host === "t.me";
  } catch (_) {
    return false;
  }
}

function inferShopSlugFromText(text) {
  const source = String(text || "");
  const match = source.match(/\b([A-Z][a-z0-9]*(?:\s+[A-Z][a-z0-9]*){0,3})\s+Store\b/);
  if (!match) return "";
  return `${match[1]} Store`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isPaymentSetupText(text) {
  return /\b(payment|pay|qr|bank|usdt|crypto|gateway|thanh toán|chuyển khoản)\b/i.test(String(text || ""));
}

function addPrivateSupportFallbackLink(text, contextText) {
  if (/https?:\/\/\S+/i.test(text)) return text;
  if (!isPaymentSetupText(`${text}\n${contextText}`)) return text;
  const slug = inferShopSlugFromText(contextText);
  const link = slug
    ? `https://teleshopbot.com/${slug}/payment`
    : "https://teleshopbot.com/login";
  return `${text.trim()}\n\nOpen:\n${link}`;
}

function formatPrivateSupportText(text) {
  return String(text || "")
    .replace(/\s+(?=\d+\.\s+)/g, "\n")
    .replace(/\s+(Open:|Then:|Test:|Link:)\s*/gi, "\n\n$1\n")
    .replace(/\s+(https?:\/\/\S+)/gi, "\n$1")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeReply(reply, options = {}) {
  const allowLinks = options.allowLinks === true;
  const preserveFormatting = options.preserveFormatting === true;
  const privateRaw = options.privateRaw === true;
  const contextText = options.contextText || "";
  let text = String(reply || "").trim();

  if (privateRaw) {
    text = addPrivateSupportFallbackLink(text, contextText);
    return formatPrivateSupportText(text).slice(0, 1800);
  }

  // Loại bỏ các câu mào đầu AI phổ biến
  const aiPrefixes = [
    /^(yes,\s+)?i\s+can\s+help\s+with\s+that\.?\s*/i,
    /^(yes,\s+)?sure(,\s+)?i\s+can\s+help(\s+you)?(\s+with\s+that)?\.?\s*/i,
    /^certainly!\s*/i,
    /^sure[.!]?\s*/i,
    /^surething!\s*/i,
    /^absolutely!\s*/i,
    /^here\s+is\s+a\s+suggested\s+reply:?\s*/i,
    /^here's\s+a\s+suggested\s+reply:?\s*/i,
  ];

  for (const prefix of aiPrefixes) {
    text = text.replace(prefix, "");
  }

  // Thay thế/loại bỏ em-dash (—) hoặc gạch ngang thừa ở đầu/cuối
  text = text.replace(/—/g, "-").replace(/^[—\-\s]+|[—\-\s]+$/g, "");

  if (!allowLinks) {
    text = text.replace(/https?:\/\/\S+/gi, "");
  } else {
    text = text.replace(/https?:\/\/\S+/gi, (url) =>
      isOfficialPrivateSupportUrl(url) ? url : "",
    );
  }
  text = text.replace(/@(?!(botfather|BotFather|Botfather)\b)[\w_]{4,}/g, "");

  if (preserveFormatting) {
    text = addPrivateSupportFallbackLink(text, contextText);
    return formatPrivateSupportText(text).slice(0, 1400);
  }

  return text.replace(/\s+/g, " ").trim().slice(0, 900);
}

function normalizeMessageFingerprint(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/@\w+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

async function hasRecentDuplicateFromSender(accountId, senderId, text) {
  if (!senderId) return false;
  const fingerprint = normalizeMessageFingerprint(text);
  if (!fingerprint) return false;
  const recent = await AiLeadQueue.findRecentByAccountSender(
    accountId,
    senderId,
    20,
  ).catch(() => []);
  return (
    Array.isArray(recent) &&
    recent.some(
      (entry) =>
        normalizeMessageFingerprint(entry.originalText) === fingerprint,
    )
  );
}

function minutesSince(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return Infinity;
  return (Date.now() - time) / 60000;
}

async function hasRecentQueueForSender(
  accountId,
  chatId,
  senderId,
  minutes = 720,
) {
  if (!senderId) return false;
  const recent = await AiLeadQueue.findRecentByAccountSender(
    accountId,
    senderId,
    20,
  ).catch(() => []);
  return recent.some(
    (item) =>
      String(item.chatId) === String(chatId) &&
      ["pending", "sent"].includes(String(item.status || "")) &&
      minutesSince(item.createdAt) < minutes,
  );
}

async function countRecentQueueForGroup(accountId, chatId, minutes = 60) {
  const recent = await AiLeadQueue.findRecent({}, 200).catch(() => []);
  return recent.filter(
    (item) =>
      String(item.accountId) === String(accountId) &&
      String(item.chatId) === String(chatId) &&
      ["pending", "sent"].includes(String(item.status || "")) &&
      minutesSince(item.createdAt) < minutes,
  ).length;
}
function normalizeReplyFingerprint(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(mate|buddy|dude)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getReplyOpening(text) {
  return normalizeReplyFingerprint(text).split(" ").slice(0, 3).join(" ");
}

function isGenericTemplateReply(reply) {
  const normalized = normalizeReplyFingerprint(reply);
  return [
    "looks solid",
    "solid list",
    "nice list",
    "nice one",
    "got it",
    "yeah",
    "cheap or expensive",
    "how much",
    "what item",
    "good stuff",
    "nice bundle",
    "solid lineup",
    "sounds like",
    "yeah",
  ].some((opening) => normalized.startsWith(opening));
}

function isLowSignalGroupText(text) {
  const normalized = String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length < 12) return true;
  return ["need chat", "dm me", "pm me", "inbox me", "hi", "hello"].includes(
    normalized,
  );
}

async function hasRecentSimilarReply(accountId, chatId, reply) {
  const fingerprint = normalizeReplyFingerprint(reply);
  if (!fingerprint) return false;
  const opening = getReplyOpening(reply);
  const recent = await AiLeadQueue.findRecent({}, 80).catch(() => []);
  return recent.some((item) => {
    if (
      String(item.accountId) !== String(accountId) ||
      String(item.chatId) !== String(chatId)
    )
      return false;
    const existingFingerprint = normalizeReplyFingerprint(item.suggestedReply);
    if (!existingFingerprint) return false;
    return (
      existingFingerprint === fingerprint ||
      (opening && getReplyOpening(item.suggestedReply) === opening)
    );
  });
}

async function buildCompactMessagesForAi({
  accountId,
  messages,
  maxItems,
  blockedSenderIds,
  settings,
}) {
  const compact = [];
  const seenSenderIds = new Set();
  const seenFingerprints = new Set();
  let skippedBlacklisted = 0;
  let skippedDuplicate = 0;

  for (const msg of messages) {
    const text = String(msg.text || "").trim();
    if (!text || text.length < 4 || msg.hasMedia) continue;
    if (shouldIgnoreBotLikeUser(settings, msg, text) || isBotLikeSellerAdText(text)) continue;

    const senderId = msg.fromId?.toString() || msg.senderId?.toString() || "";
    if (senderId && blockedSenderIds.has(senderId)) {
      skippedBlacklisted += 1;
      continue;
    }

    const fingerprint = normalizeMessageFingerprint(text);
    if (!fingerprint) continue;
    if (
      seenFingerprints.has(fingerprint) ||
      (senderId && seenSenderIds.has(senderId)) ||
      (await hasRecentDuplicateFromSender(accountId, senderId, text))
    ) {
      skippedDuplicate += 1;
      continue;
    }

    seenFingerprints.add(fingerprint);
    if (senderId) seenSenderIds.add(senderId);
    compact.push({
      id: msg.id,
      sender_id: senderId,
      sender:
        msg.senderUsername || msg.senderName || msg.fromId || "Unknown user",
      text: text.slice(0, 700),
    });

    if (compact.length >= maxItems) break;
  }

  if (skippedBlacklisted || skippedDuplicate) {
    console.log("[AILead] Batch prefilter skipped messages:", {
      accountId,
      skippedBlacklisted,
      skippedDuplicate,
      compact: compact.length,
    });
  }
  return compact;
}
function canPassRateLimit() {
  return true;
}

function recordReply(settings, accountId, chatId, senderId, sourceType) {
  return;
}

function notifyAdminSafe(message, extra = {}, meta = {}) {
  try {
    const botService = require("./botService");
    const result = botService.notifyAdmin(message, null, extra);
    Promise.resolve(result)
      .then((ok) => {
        if (ok !== false && meta.queueId) {
          AiLeadQueue.findById(meta.queueId)
            .then((item) => {
              if (!item) return null;
              return AiLeadQueue.update(meta.queueId, {
                adminNotifiedAt: item.adminNotifiedAt || new Date().toISOString(),
                adminNotifyCount: Number(item.adminNotifyCount || 0) + 1,
              });
            })
            .catch((err) => {
              console.error("[AILead] admin notification mark error:", err.message);
            });
        }
        console.log("[AILead] Telegram admin notification result:", {
          ok: ok !== false,
          queueId: meta.queueId || "",
          sourceType: meta.sourceType || "",
          chatId: meta.chatId || "",
          messageId: meta.messageId || "",
          prefix: meta.prefix || "",
        });
      })
      .catch((err) => {
        console.error("[AILead] Telegram admin notification failed:", {
          error: err.message,
          queueId: meta.queueId || "",
          chatId: meta.chatId || "",
          messageId: meta.messageId || "",
        });
      });
  } catch (err) {
    console.error("[AILead] notifyAdmin error:", err.message);
  }
}

function logReplyCandidate(item, decision, stage = "selected") {
  console.log("[AILead] Reply candidate selected:", {
    stage,
    queueId: item._id,
    sourceType: item.sourceType,
    accountId: item.accountId,
    chatId: item.chatId,
    chatTitle: item.chatTitle,
    messageId: item.messageId,
    senderId: item.senderId,
    senderName: item.senderName,
    category: item.category,
    score: item.score,
    riskScore: item.riskScore,
    shouldQueue: !!decision?.should_queue,
    reason: item.reason || decision?.reason || "",
    originalPreview: String(item.originalText || "").slice(0, 220),
    replyPreview: String(item.suggestedReply || "").slice(0, 220),
  });
}

function formatApprovalCard(item) {
  const groupName = item.chatTitle.startsWith("@")
    ? item.chatTitle
    : item.chatTitle;
  return [
    "AI Engagement suggestion",
    `ID: ${item._id}`,
    `Tên nhóm: ${groupName}`,
    `Người gửi: ${item.senderName}`,
    `Score: ${item.score} | Category: ${item.category}`,
    "",
    `Nội dung gửi:\n${item.originalText.slice(0, 700)}`,
    "",
    `Nội dung bot định trả lời:\n${item.suggestedReply}`,
  ].join("\n");
}

function approvalButtons(item) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Đồng ý", callback_data: `ailead:send:${item._id}` },
          { text: "Từ chối", callback_data: `ailead:skip:${item._id}` },
        ],
      ],
    },
  };
}

function logAiLeadSelectedReply(item, decision, reply, context = {}) {
  console.log("[AILead] Selected reply candidate:", {
    queueId: item?._id || "",
    accountId: item?.accountId || context.accountId || "",
    chatId: item?.chatId || context.chatId || "",
    chatTitle: item?.chatTitle || context.chatTitle || "",
    messageId: item?.messageId || context.messageId || "",
    sourceType: item?.sourceType || context.sourceType || "",
    senderName: item?.senderName || context.senderName || "",
    category: item?.category || decision?.category || "",
    score: item?.score ?? Number(decision?.score || 0),
    riskScore: item?.riskScore ?? Number(decision?.risk_score || decision?.riskScore || 0),
    shouldQueue: !!decision?.should_queue,
    reason: decision?.reason || item?.reason || "",
    originalPreview: String(item?.originalText || context.text || "").slice(0, 220),
    replyPreview: String(reply || item?.suggestedReply || "").slice(0, 260),
  });
}
// notifyApproval đã được khôi phục nguyên vẹn
function notifyApproval(item, prefix = "") {
  console.log("[AILead] Sending Telegram admin notification:", {
    queueId: item._id,
    sourceType: item.sourceType,
    chatId: item.chatId,
    chatTitle: item.chatTitle,
    messageId: item.messageId,
    senderName: item.senderName,
    prefix,
    replyPreview: String(item.suggestedReply || "").slice(0, 180),
  });
  notifyAdminSafe(
    prefix
      ? `${prefix}\n\n${formatApprovalCard(item)}`
      : formatApprovalCard(item),
    approvalButtons(item),
    {
      queueId: item._id,
      sourceType: item.sourceType,
      chatId: item.chatId,
      messageId: item.messageId,
      prefix,
    },
  );
}

function getEngagementGroupConfig(settings, accountId, chatId) {
  const groups = Array.isArray(settings.aiLeadEngagementGroups)
    ? settings.aiLeadEngagementGroups
    : [];
  return (
    groups.find(
      (group) =>
        String(group.accountId) === String(accountId) &&
        String(group.chatId) === String(chatId),
    ) || null
  );
}

function isEngagementTargetAllowed(settings, accountId, chatId, topicId = "") {
  const config = getEngagementGroupConfig(settings, accountId, chatId);
  if (!config) return false;
  const topics = Array.isArray(config.topics) ? config.topics : [];
  if (!topics.length) return true;
  if (!topicId) return false;
  return topics.some((topic) => String(topic?.id ?? topic) === String(topicId));
}

function getEngagementPurpose(settings, accountId, chatId, topicId = "") {
  const config = getEngagementGroupConfig(settings, accountId, chatId);
  if (!config) return "";
  const topics = Array.isArray(config.topics) ? config.topics : [];
  const topic = topicId
    ? topics.find((item) => String(item?.id ?? item) === String(topicId))
    : null;
  return topic?.purpose || config.purpose || "";
}

function shouldForceAdminApproval(text, decision, sourceType = "") {
  return false;
}

async function listPending(limitOrAccountId = 10, maybeLimit = 100) {
  const numericLimit = Number(limitOrAccountId);
  const accountId = Number.isFinite(numericLimit)
    ? ""
    : String(limitOrAccountId || "");
  const limit = Number.isFinite(numericLimit)
    ? numericLimit
    : Number(maybeLimit || 100);
  const list = await AiLeadQueue.findRecent({ status: "pending" }, limit);
  return accountId
    ? list.filter((item) => String(item.accountId) === accountId)
    : list;
}

async function acquireClientForAccount(accountId) {
  const telegramService = require("./telegramService");
  const liveClient = telegramService.clients?.get(accountId);
  if (liveClient) return { client: liveClient, temporary: false };

  const TelegramAccount = require("./models/TelegramAccount");
  const account = await TelegramAccount.findOne({ accountId });
  if (!account?.sessionString)
    throw new Error(
      "Account chưa connected hoặc không tìm thấy session để gửi.",
    );

  const { TelegramClient } = require("telegram");
  const { StringSession } = require("telegram/sessions");

  const apiId = Number(process.env.TELEGRAM_API_ID || 2040);
  const apiHash =
    process.env.TELEGRAM_API_HASH || "b18441a1ff607e10a989891a5462e627";
  const clientOptions = {
    connectionRetries: 5,
    deviceModel: process.env.TELEGRAM_DEVICE_MODEL || "Desktop",
    systemVersion: process.env.TELEGRAM_SYSTEM_VERSION || "Windows 10",
    appVersion:
      process.env.TELEGRAM_APP_VERSION || "Telegram Desktop 6.9.3 x64",
    langCode: process.env.TELEGRAM_LANG_CODE || "en",
    systemLangCode: process.env.TELEGRAM_SYSTEM_LANG_CODE || "en-US",
  };

  const client = new TelegramClient(
    new StringSession(account.sessionString),
    apiId,
    apiHash,
    clientOptions,
  );
  client.setLogLevel?.("none");
  await client.connect();
  await client.getDialogs({ limit: 500 }).catch(() => {});
  console.log(
    "[AILead] Temporary Telegram client connected for approve-send:",
    { accountId },
  );
  return { client, temporary: true };
}

function validateSingleDecisionJson(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return "Root JSON must be an object";
  if (typeof parsed.should_reply !== "boolean")
    return "Missing boolean should_reply";
  if (typeof parsed.category !== "string") return "Missing string category";
  if (!Number.isFinite(Number(parsed.score))) return "Missing numeric score";
  if (!Number.isFinite(Number(parsed.risk_score ?? parsed.riskScore)))
    return "Missing numeric risk_score";
  if (typeof parsed.reason !== "string") return "Missing string reason";
  if (parsed.should_reply && typeof parsed.reply !== "string")
    return "Missing string reply";
  return true;
}

function validateBatchDecisionJson(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return "Root JSON must be an object";
  if (!Array.isArray(parsed.candidates)) return "Missing candidates array";
  for (const candidate of parsed.candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      return "Each candidate must be an object";
    if (!Number.isFinite(Number(candidate.message_id)))
      return "Each candidate needs numeric message_id";
    if (typeof candidate.should_reply !== "boolean")
      return "Each candidate needs boolean should_reply";
    if (typeof candidate.category !== "string")
      return "Each candidate needs string category";
    if (!Number.isFinite(Number(candidate.score)))
      return "Each candidate needs numeric score";
    if (!Number.isFinite(Number(candidate.risk_score ?? candidate.riskScore)))
      return "Each candidate needs numeric risk_score";
    if (typeof candidate.reason !== "string")
      return "Each candidate needs string reason";
    if (candidate.should_reply && typeof candidate.reply !== "string")
      return "Reply candidates need string reply";
  }
  return true;
}

async function askAi({
  settings,
  text,
  chatTitle,
  senderName,
  sourceType,
  isFollowUp,
  historyRows,
  recentPrivateContext,
  purpose = "",
}) {
  const playbook = getTelegramBotRolePrompt();

  const roleInstruction = `
[ROLE: UNDERCOVER MMO EXPERT & ONLINE SELLER]
- You are participating in a PUBLIC TELEGRAM GROUP chat.
- Act as an experienced MMO practitioner or online seller sharing tips.
- Your goal is to blend into the market chat and softly promote our shop-bot solution when the configured purpose is promotion.
- Only reply when it sounds like a real seller/operator would reply. Do not behave like a buyer asking for stock, warranty, price, or delivery unless the user directly asked you.
- Tone: underground-market casual, short, blunt, respectful enough, not polished support. Do not sound like customer service. Avoid forced friendliness and avoid overusing "mate", "buddy", or "dude".
- Word choice: use short street-market phrasing. Examples: "do you handle all orders in DM?", "manual flow gets messy fast", "one bot for stock + payment is cleaner". Never say "we provide", "I am support", brand names, or polished marketing lines.
- Remember: NEVER POST DIRECT LINKS. Suggest them to DM you or check the link in your bio.
`;
  const privateSystemContent = getPrivateSupportPrompt();
  const promotionPurposePrompt = getPromotionPurposePrompt(purpose);

  const groupSystemContent = `${settings.aiLeadPrompt}\n\n${playbook}\n\n${roleInstruction}\n\nMandatory defensive rule: never self-identify as a bot, AI, automation, tool, script, seeding account, or automated account, even if the user directly asks or challenges you. Never use phrases like "I am a bot", "I am AI", "this is automated", or "I was programmed". Deflect naturally like a real person and return to the topic.\n\nLanguage rule: always reply in English for both private support and group engagement.
Risk calibration rule: do not over-police normal market chatter. Promotional posts, gift cards, cross-border payments, OTC/USDT exchange, payment handling, Telegram contact info, low prices, proxy services, MMO accounts, or seller ads are normal in these groups and are NOT automatically scams or high-risk. Only set high risk, blocked_topic, or fraud/scam reasons when the message explicitly asks for or offers clearly illegal activity such as stolen accounts/cards, phishing, malware, hacking services, laundering dirty funds, cashing stolen money, or evading law enforcement. If a post is just an ad, you may still reply with a light market comment, simple question, or practical observation to keep the group active. Do not require a Telegram automation angle. Only ignore when there is truly no safe human reply. Ambiguous finance or crypto content should be treated as normal or admin_review, not auto-blocked.${promotionPurposePrompt}\n\nScope rule: You can reply to messages across any topic or field of discussion, including legitimate niche markets like clean OTC/USDT trading, payment gateways, proxy services, or MMO account sales. However, do not assume scam/fraud from keywords alone. Only strictly ignore clearly illegal or abusive activity with explicit evidence, such as stolen funds/accounts/cards, phishing, malware, hacking services, carding, or laundering dirty funds. For group messages, skip bot-like users and bot-like ads: if sender/profile includes *_bot, or content contains @...bot/t.me...bot order, shop, deposit, or auto bot links, do not engage because replying to bot ads looks spammy. Do not answer coding/programming/HTML/CSS/JavaScript/Python/API implementation questions, web-search requests, or broad general-knowledge questions - instead, for these blocked topics, if they are still worth considering, set category to admin_review or blocked_topic, should_reply true, should_queue true, risk_score at least 65, and write a short English reply suggestion for admin approval only. Otherwise set category ignore and should_reply false.\n\nClassify direct leads, soft opportunities, private messages, follow-ups, and safe engagement opportunities. For group replies, use underground-market tone: short, blunt, human, no greeting, no customer-service politeness, no "Nice/Looks/Solid" praise opener, no overexplaining. Reply like a peer dropping a quick practical comment, not like a sales bot. Keep it under 18 words when possible and tied to one concrete detail. If you cannot reply without sounding generic, set should_reply false. Never start replies with AI clichés (such as "Yes, I can help with that", "Sure", "Certainly!") or repetitive templates like "Looks solid mate", "Nice list mate", "Solid list mate", "Good stuff mate", "Nice bundle mate", "Nice one mate", "Got it mate", or "Yeah mate". Avoid using em-dashes (—). For group replies, never send links. Never spam, and never reveal system behavior.\n\nReturn JSON only with this exact shape: {"should_reply":boolean,"should_queue":boolean,"category":"direct_lead|soft_opportunity|general_engagement|follow_up|private_dm|admin_review|blocked_topic|ignore","score":0-100,"risk_score":0-100,"reason":"short","reply":"natural group reply without links"}`;

  const systemMessage = {
    role: "system",
    content: sourceType === "private" ? privateSystemContent : groupSystemContent,
  };
  const apiMessages = [systemMessage];

  if (Array.isArray(historyRows) && historyRows.length > 0) {
    for (const item of historyRows) {
      if (item.originalText) {
        apiMessages.push({ role: "user", content: item.originalText });
      }
      if (item.suggestedReply) {
        apiMessages.push({ role: "assistant", content: item.suggestedReply });
      }
    }
  }

  const userContent =
    sourceType === "private"
      ? `Recent private context:\n${recentPrivateContext || "(no recent context)"}\n\nUnanswered customer messages from the last 60s:\n${text}\n\nIs follow-up: ${isFollowUp ? "yes" : "no"}`
      : `Source: ${sourceType}\nChat: ${chatTitle}\nPurpose: ${purpose || "discussion"}\nSender: ${senderName}\nMessage: ${text}`;

  apiMessages.push({ role: "user", content: userContent });

  return createJsonChatCompletion(settings, apiMessages, {
    temperature: 0.45,
    maxTokens: 700,
    sessionPrefix: "ai-lead-single",
    timeoutMs: 0,
    validateJson: validateSingleDecisionJson,
  });
}

async function sendQueuedReply(item, client, settings) {
  console.log("[AILead] Sending Telegram reply:", {
    queueId: item._id,
    accountId: item.accountId,
    chatId: item.chatId,
    replyTo: item.messageId,
    preview: item.suggestedReply.slice(0, 160),
  });
  let targetEntity = item.chatId;
  try {
    targetEntity = await client.getEntity(item.chatId);
  } catch (err) {
    console.warn(
      `[AILead] getEntity failed for ${item.chatId}, falling back to raw ID:`,
      err.message,
    );
  }

  const replyToMsgId = Number(item.messageId);
  const options = item.sourceType === "private" ? { parseMode: "html" } : {};
  if (Number.isInteger(replyToMsgId) && replyToMsgId > 0) {
    options.replyTo = replyToMsgId;
  }

  const sent = await client.sendMessage(targetEntity, {
    message: item.suggestedReply,
    linkPreview: false,
    ...options,
  });
  const sentMessageId = sent?.id?.toString?.() || "";

  const now = new Date().toISOString();
  const updated = await AiLeadQueue.update(item._id, {
    status: "sent",
    sentMessageId,
    sentAt: now,
  });

  recordReply(
    settings,
    item.accountId,
    item.chatId,
    item.senderId,
    item.sourceType,
  );
  return updated;
}

function getAutoSendDelayRangeMinutes(settings) {
  const legacy = Number(settings?.aiLeadAutoSendDelayMinutes ?? 15);
  const rawMin = Number(settings?.aiLeadAutoSendMinDelayMinutes ?? legacy ?? 15);
  const rawMax = Number(settings?.aiLeadAutoSendMaxDelayMinutes ?? rawMin ?? 30);
  const min = Math.max(0, Number.isFinite(rawMin) ? rawMin : 15);
  const max = Math.max(min, Number.isFinite(rawMax) ? rawMax : min);
  return { min, max };
}

function getRandomAutoSendDelayMs(settings) {
  const { min, max } = getAutoSendDelayRangeMinutes(settings);
  const minutes = min === max ? min : min + Math.random() * (max - min);
  return Math.round(minutes * 60 * 1000);
}

function isAutoQueuedItem(item) {
  return Boolean(item?.autoSendScheduledAt || item?.autoSendAt);
}

async function getAutoQueuedPendingItems(limit = 1000) {
  const items = await AiLeadQueue.findRecent({ status: "pending" }, limit).catch(() => []);
  return items
    .filter(isAutoQueuedItem)
    .sort((a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0));
}

async function clearOtherAutoSendTimes(activeId) {
  const items = await getAutoQueuedPendingItems();
  await Promise.all(
    items
      .filter((item) => item._id !== activeId && item.autoSendAt)
      .map((item) => AiLeadQueue.update(item._id, { autoSendAt: "" }).catch(() => null)),
  );
}

function formatAutoSendCard(item) {
  return [
    "AI auto-sent reply",
    `ID: ${item._id}`,
    `Tên nhóm: ${item.chatTitle}`,
    `Người gửi: ${item.senderName}`,
    `Score: ${item.score} | Category: ${item.category}`,
    "",
    `Tin gốc:\n${String(item.originalText || "").slice(0, 700)}`,
    "",
    `Đã gửi:\n${item.suggestedReply}`,
  ].join("\n");
}

function notifyAutoSendSuccess(item) {
  if (!item) return;
  notifyAdminSafe(formatAutoSendCard(item), {}, {
    queueId: item._id,
    sourceType: item.sourceType,
    chatId: item.chatId,
    messageId: item.messageId,
    prefix: "auto_sent",
  });
}

function notifyAutoSendFailureSkipped(item, error) {
  if (!item) return;
  notifyAdminSafe(
    [
      "AI auto-send failed, skipped queue item",
      `ID: ${item._id}`,
      `Group: ${item.chatTitle}`,
      `Sender: ${item.senderName}`,
      `Error: ${error || "unknown"}`,
      "",
      `Original:\n${String(item.originalText || "").slice(0, 700)}`,
      "",
      `Reply:\n${item.suggestedReply}`,
    ].join("\n"),
    {},
    {
      queueId: item._id,
      sourceType: item.sourceType,
      chatId: item.chatId,
      messageId: item.messageId,
      prefix: "auto_failed_skipped",
    },
  );
}

async function scheduleGlobalAutoSend(settings) {
  if (autoSendQueueTimer) {
    clearTimeout(autoSendQueueTimer);
    autoSendQueueTimer = null;
  }
  if (autoSendQueueRunning) return;

  const items = await getAutoQueuedPendingItems();
  if (!items.length) return;

  const now = Date.now();
  const due = items
    .filter((item) => item.autoSendAt && Date.parse(item.autoSendAt) <= now)
    .sort((a, b) => Date.parse(a.autoSendAt) - Date.parse(b.autoSendAt))[0];
  if (due) {
    const delayMs = getRandomAutoSendDelayMs(settings);
    const autoSendAt = new Date(Date.now() + delayMs).toISOString();
    await AiLeadQueue.update(due._id, { autoSendAt, autoSendError: "" });
    await clearOtherAutoSendTimes(due._id);
    autoSendQueueTimer = setTimeout(() => processGlobalAutoSendQueue(), delayMs);
    console.log("[AILead] Stale auto-send due item rescheduled after restart:", {
      queueId: due._id,
      delayMs,
      autoSendAt,
    });
    return;
  }

  const scheduled = items
    .filter((item) => item.autoSendAt && Date.parse(item.autoSendAt) > now)
    .sort((a, b) => Date.parse(a.autoSendAt) - Date.parse(b.autoSendAt))[0];
  if (scheduled) {
    autoSendQueueTimer = setTimeout(
      () => processGlobalAutoSendQueue(),
      Math.max(0, Date.parse(scheduled.autoSendAt) - now),
    );
    return;
  }

  const next = items[0];
  const delayMs = getRandomAutoSendDelayMs(settings);
  const autoSendAt = new Date(Date.now() + delayMs).toISOString();
  await AiLeadQueue.update(next._id, { autoSendAt, autoSendError: "" });
  autoSendQueueTimer = setTimeout(() => processGlobalAutoSendQueue(), delayMs);
  console.log("[AILead] Global auto-send queue scheduled:", {
    queueId: next._id,
    delayMs,
    autoSendAt,
  });
}

async function processGlobalAutoSendQueue() {
  if (autoSendQueueRunning) return;
  autoSendQueueRunning = true;
  autoSendQueueTimer = null;
  let settings = null;
  let activeAutoSendItem = null;
  try {
    settings = (await GlobalSetting.findOne({ type: "global_app_settings" })) || new GlobalSetting();
    const now = Date.now();
    const items = await getAutoQueuedPendingItems();
    const item = items
      .filter((entry) => entry.autoSendAt && Date.parse(entry.autoSendAt) <= now)
      .sort((a, b) => Date.parse(a.autoSendAt) - Date.parse(b.autoSendAt))[0];
    if (!item) return;
    activeAutoSendItem = item;

    await clearOtherAutoSendTimes(item._id);
    await AiLeadQueue.update(item._id, {
      autoSendAttempts: Number(item.autoSendAttempts || 0) + 1,
      autoSendError: "",
    });
    const result = await sendPending(item._id, { source: "auto_queue" });
    if (!result?.success) {
      const error = result?.error || "Auto-send failed";
      await AiLeadQueue.update(item._id, {
        status: "skipped",
        skippedAt: new Date().toISOString(),
        autoSendAt: "",
        autoSendScheduledAt: "",
        autoSendError: error,
      });
      notifyAutoSendFailureSkipped(item, error);
    }
    await clearOtherAutoSendTimes(item._id);
  } catch (err) {
    console.error("[AILead] Global auto-send queue error:", err.message);
    if (activeAutoSendItem) {
      await AiLeadQueue.update(activeAutoSendItem._id, {
        status: "skipped",
        skippedAt: new Date().toISOString(),
        autoSendAt: "",
        autoSendScheduledAt: "",
        autoSendError: err.message || "Auto-send failed",
      }).catch(() => null);
      notifyAutoSendFailureSkipped(activeAutoSendItem, err.message || "Auto-send failed");
    }
  } finally {
    autoSendQueueRunning = false;
    scheduleGlobalAutoSend(settings || new GlobalSetting()).catch((err) => {
      console.error("[AILead] Global auto-send reschedule error:", err.message);
    });
  }
}

async function queueAutoSend(item, settings) {
  const queued = await AiLeadQueue.update(item._id, {
    status: "pending",
    autoSendAt: "",
    autoSendScheduledAt: item.autoSendScheduledAt || new Date().toISOString(),
    autoSendError: "",
  });
  await scheduleGlobalAutoSend(settings);
  console.log("[AILead] Auto-send added to global queue:", {
    queueId: queued?._id,
    sourceType: queued?.sourceType,
    chatId: queued?.chatId,
    rangeMinutes: getAutoSendDelayRangeMinutes(settings),
  });
  return queued || item;
}

async function startAutoSendQueue() {
  const settings = (await GlobalSetting.findOne({ type: "global_app_settings" })) || new GlobalSetting();
  await scheduleGlobalAutoSend(settings);
  return { success: true };
}

async function sendPending(id, options = {}) {
  const item = await AiLeadQueue.findById(id);
  if (!item) return { success: false, error: "Không tìm thấy pending reply." };
  if (item.status !== "pending")
    return {
      success: false,
      error: `Item này đang ở trạng thái ${item.status}.`,
    };

  let acquiredClient = null;
  let temporaryClient = false;
  try {
    console.log(options.source === "auto_queue" ? "[AILead] Auto queue sending pending reply:" : "[AILead] Admin approved pending reply:", {
      id,
      accountId: item.accountId,
      chatId: item.chatId,
      status: item.status,
    });
    const acquired = await acquireClientForAccount(item.accountId);
    acquiredClient = acquired.client;
    temporaryClient = acquired.temporary;
    const settings = await GlobalSetting.findOne({
      type: "global_app_settings",
    });
    const sent = await sendQueuedReply(
      item,
      acquiredClient,
      settings || new GlobalSetting(),
    );
    console.log(options.source === "auto_queue" ? "[AILead] Auto queued reply sent:" : "[AILead] Admin approved reply sent:", {
      id,
      sentMessageId: sent.sentMessageId,
      temporaryClient,
    });
    if (options.source === "auto_queue") notifyAutoSendSuccess(sent);
    return { success: true, item: sent };
  } catch (err) {
    console.error("[AILead] sendPending failed:", { id, error: err.message });
    return { success: false, error: err.message };
  } finally {
    if (temporaryClient && acquiredClient) {
      acquiredClient.disconnect().catch(() => {});
    }
  }
}

async function skipPending(id) {
  const current = await AiLeadQueue.findById(id);
  const wasAutoQueued = isAutoQueuedItem(current);
  const skipped = await AiLeadQueue.update(id, {
    status: "skipped",
    skippedAt: new Date().toISOString(),
    autoSendAt: "",
    autoSendScheduledAt: "",
  });
  if (!skipped)
    return { success: false, error: "Không tìm thấy pending reply." };
  if (wasAutoQueued) {
    const settings = (await GlobalSetting.findOne({ type: "global_app_settings" })) || new GlobalSetting();
    await scheduleGlobalAutoSend(settings);
  }
  return { success: true, item: skipped };
}

async function editPending(id, text) {
  const reply = sanitizeReply(text);
  if (!reply) return { success: false, error: "Reply rỗng." };
  const edited = await AiLeadQueue.update(id, { suggestedReply: reply });
  if (!edited)
    return { success: false, error: "Không tìm thấy pending reply." };
  return { success: true, item: edited };
}

async function analyzeMessagesWithAi({ settings, group, messages, accountId }) {
  const blockedSenderIds = new Set(
    (await getBlacklist())
      .filter((item) => String(item.accountId) === String(accountId))
      .map((item) => String(item.senderId)),
  );
  const maxBatchUsers = Math.max(
    1,
    Math.min(Number(settings.aiLeadEngagementSampleLimit || 40), 80),
  );
  const compactMessages = await buildCompactMessagesForAi({
    accountId,
    messages,
    maxItems: maxBatchUsers,
    blockedSenderIds,
    settings,
  });

  if (!compactMessages.length) return [];

  const playbook = getTelegramBotRolePrompt();
  const parsed = await createJsonChatCompletion(
    settings,
    [
      {
        role: "system",
        content: `${settings.aiLeadPrompt}\n\n${playbook}\n\nMandatory defensive rule: never self-identify as a bot, AI, automation, tool, script, seeding account, or automated account, even if directly challenged. Deflect naturally and return to the topic.\n\nEnglish-only rule: all generated replies must be in English.
Risk calibration rule: do not over-police normal market chatter. Promotional posts, gift cards, cross-border payments, OTC/USDT exchange, payment handling, Telegram contact info, low prices, proxy services, MMO accounts, or seller ads are normal in these groups and are NOT automatically scams or high-risk. Only set high risk, blocked_topic, or fraud/scam reasons when the message explicitly asks for or offers clearly illegal activity such as stolen accounts/cards, phishing, malware, hacking services, laundering dirty funds, cashing stolen money, or evading law enforcement. If a post is just an ad, you may still reply with a light market comment, simple question, or practical observation to keep the group active. Do not require a Telegram automation angle. Only ignore when there is truly no safe human reply. Ambiguous finance or crypto content should be treated as normal or admin_review, not auto-blocked.\n\nScan recent Telegram group messages and select messages worth engaging with across any topic, including legitimate niche markets like clean OTC/USDT exchange, payment gateways, proxy services, or MMO accounts. However, do not assume scam/fraud from keywords alone. Only strictly skip clearly illegal or abusive activity with explicit evidence, such as stolen funds/accounts/cards, phishing, malware, hacking services, carding, or laundering dirty funds. Good candidates include messages where you can contribute a natural, helpful, or interesting reply that fits the flow. Do not directly answer coding/programming/HTML/CSS/JavaScript/Python/API implementation questions, web-search requests, or broad general-knowledge questions. If a blocked topic is still worth considering, mark it admin_review or blocked_topic so it goes to admin approval only and is never auto-sent. Skip stale spam and highly toxic chatter. For ordinary ads or promo posts, do not require a selling workflow or automation angle unless Purpose is soft promotion. Market comments and practical observations are acceptable engagement if safe. If Purpose is promotion/soft-promotion/quảng bá, promote our shop-bot solution indirectly, not the other seller's product. Do not mention TeleShopBot in public group replies. Do not act like a buyer and do not ask buying price, warranty, delivery availability, or supplier questions. If the seller posts many product packages, tiers, or bulk pricing, ask whether they manage those packages/prices manually, then pivot. In one message, ask a light operations question first, then pivot to a generic Telegram shop bot, stock/order dashboard, tier/package management, auto delivery, auto QR/payment notes, affiliate/referral tracking, or reducing manual DM work. No direct links, no @mentions, no brand name. If you cannot ask-then-pivot naturally, skip. Do not label them scam/high-risk just because they mention payments, gift cards, USDT, cheap pricing, or Telegram contacts. Replies must be short, natural, useful, and without links. Never start replies with AI clichés (such as "Yes, I can help with that", "Sure") or use em-dashes (—).\n\nReturn JSON only: {"candidates":[{"message_id":number,"should_reply":boolean,"category":"direct_lead|soft_opportunity|general_engagement|admin_review|blocked_topic|ignore","score":0-100,"risk_score":0-100,"reason":"short","reply":"natural reply with Telegram-friendly formatting: group replies must not include links, brand names, or @mentions; direct to the point without AI filler phrases (e.g., no 'Yes, I can help with that', 'Sure', 'Certainly'), and no em-dashes (—)"}]}`,
      },
      {
        role: "user",
        content: `Group: ${group.title}${group.username ? ` (@${group.username})` : ""}${group.topicTitle ? ` / Topic: ${group.topicTitle}` : ""}\nPurpose: ${group.purpose || "discussion"}\nMessages JSON:\n${JSON.stringify(compactMessages)}`,
      },
    ],
    {
      temperature: 0.4,
      maxTokens: 1200,
      sessionPrefix: "ai-lead-batch",
      timeoutMs: 0,
      validateJson: validateBatchDecisionJson,
    },
  );

  return Array.isArray(parsed.candidates) ? parsed.candidates : [];
}

async function scanEngagementGroup({
  accountId,
  chatId,
  limit,
  topicId = null,
  topicTitle = "",
  purpose = "",
}) {
  const settings = await GlobalSetting.findOne({ type: "global_app_settings" });
  if (!settings?.openaiApiKey)
    return { success: false, error: "Thiếu OpenAI API Key." };

  const telegramService = require("./telegramService");
  const dialogs = await telegramService.getDialogs(accountId);
  const group = dialogs.find((dialog) => String(dialog.id) === String(chatId));
  if (!group)
    return { success: false, error: "Không tìm thấy group trong account này." };

  const sampleLimit = Number(
    limit || settings.aiLeadEngagementSampleLimit || 40,
  );
  const resolvedPurpose =
    purpose ||
    getEngagementPurpose(
      settings,
      accountId,
      chatId,
      topicId ? String(topicId) : "",
    );
  const messages = await telegramService.getMessages(
    accountId,
    chatId,
    sampleLimit,
    topicId || undefined,
  );
  const decisions = await analyzeMessagesWithAi({
    settings,
    group: { ...group, topicTitle, purpose: resolvedPurpose },
    messages,
    accountId,
  });
  const byId = new Map(messages.map((msg) => [String(msg.id), msg]));
  const minScore = Math.max(40, Number(settings.aiLeadMinScore || 85) - 45);
  const queued = [];

  for (const decision of decisions) {
    const msg = byId.get(String(decision.message_id));
    const score = Number(decision.score || 0);
    const riskScore = Number(decision.risk_score || decision.riskScore || 0);
    const reply = sanitizeReply(decision.reply);

    if (
      !msg ||
      !decision.should_reply ||
      score < minScore ||
      riskScore > 75 ||
      !reply
    )
      continue;

    const item = await AiLeadQueue.create({
      status: "pending",
      accountId,
      chatId,
      messageId: String(msg.id),
      senderId: msg.fromId?.toString() || msg.senderId?.toString() || "",
      senderName: msg.senderUsername || msg.senderName || "Unknown user",
      chatTitle: group.title || "Unknown group",
      sourceType: "group",
      category: decision.category || "general_engagement",
      score,
      riskScore,
      reason: decision.reason || "",
      originalText: msg.text || "",
      suggestedReply: reply,
    });
    if (settings.aiLeadMode === "auto") {
      queued.push(await queueAutoSend(item, settings));
    } else {
      queued.push(item);
      notifyApproval(
        item,
        shouldForceAdminApproval(msg.text || "", decision)
          ? "Admin approval required for blocked/sensitive topic"
          : "AI Engagement suggestion",
      );
    }
  }

  return {
    success: true,
    scanned: messages.length,
    queued: queued.length,
    items: queued,
  };
}

async function queueDecision({
  accountId,
  message,
  text,
  decision,
  sourceType,
  isFollowUp,
  followUpToQueueId,
}) {
  const chatId = getChatId(message);
  const item = await AiLeadQueue.create({
    status: "pending",
    accountId,
    chatId,
    messageId: message.id?.toString?.() || String(message.id || ""),
    senderId: getSenderId(message),
    senderName: getSenderName(message),
    chatTitle: getChatTitle(message),
    sourceType,
    category: isFollowUp ? "follow_up" : decision.category,
    score: Number(decision.score || 0),
    riskScore: Number(decision.risk_score || decision.riskScore || 0),
    reason: decision.reason || "",
    originalText: text,
    suggestedReply: sanitizeReply(decision.reply, {
      allowLinks: sourceType === "private",
      preserveFormatting: sourceType === "private",
      contextText: text,
      privateRaw: sourceType === "private",
    }),
    followUpToQueueId: followUpToQueueId || "",
  });
  return item;
}

async function handleIncoming({ accountId, client, message }) {
  let activeSeenKey = "";
  try {
    const settings = await GlobalSetting.findOne({ type: "global_app_settings" });
    const sourceType = getSourceType(message || {});
    if (!settings?.openaiApiKey || settings.aiLeadUserReplyEnabled === false)
      return { status: "ignored", reason: "disabled_or_missing_key" };
    if (!settings.aiLeadEnabled && sourceType !== "private")
      return { status: "ignored", reason: "watcher_disabled_for_group" };
    if (Array.isArray(settings.aiLeadAccountIds) && settings.aiLeadAccountIds.length > 0 && !settings.aiLeadAccountIds.includes(accountId))
      return { status: "ignored", reason: "account_not_enabled" };

    const text = getMessageText(message);
    if (!message || message.out || (!text && message.media))
      return { status: "ignored", reason: "unsupported_message" };
    if (!text) return { status: "ignored", reason: "invalid_text" };
    if (sourceType === "group" && isLikelySelfMessage(settings, accountId, message, text))
      return { status: "ignored", reason: "self_message" };
    if (sourceType === "group" && (await shouldIgnoreBotLikeUserAsync({ settings, accountId, client, message, text })))
      return { status: "ignored", reason: "bot_like_user" };
    if (sourceType === "group" && isBotLikeSellerAdText(text))
      return { status: "ignored", reason: "bot_like_ad" };

    const chatId = getChatId(message);
    const msgId = message.id || "";
    const seenKey = `${accountId}:${chatId}:${msgId}`;
    if (!chatId || !msgId || seenMessages.has(seenKey))
      return { status: "ignored", reason: "seen" };
    activeSeenKey = seenKey;
    seenMessages.add(seenKey);
    if (seenMessages.size > 5000) seenMessages.clear();

    const topicId = getTopicId(message);
    if (sourceType === "group" && !isEngagementTargetAllowed(settings, accountId, chatId, topicId)) {
      if (activeSeenKey) seenMessages.delete(activeSeenKey);
      return { status: "ignored", reason: "target_not_allowed" };
    }

    const existing = await AiLeadQueue.findByMessage(accountId, chatId, msgId.toString());
    if (existing) {
      if (activeSeenKey) seenMessages.delete(activeSeenKey);
      return { status: "ignored", reason: "already_queued", item: existing };
    }

    const senderId = getSenderId(message);
    if (sourceType === "group" && senderId && (await isBlacklisted(accountId, senderId))) {
      if (activeSeenKey) seenMessages.delete(activeSeenKey);
      return { status: "ignored", reason: "blacklisted_group_user" };
    }

    const replyToId = getReplyToMessageId(message);
    let previous = null;
    if (replyToId) {
      previous =
        (await AiLeadQueue.findBySentMessage(accountId, chatId, replyToId.toString())) ||
        (await AiLeadQueue.findByMessage(accountId, chatId, replyToId.toString()));
    }
    if (!previous && senderId) {
      previous = await AiLeadQueue.findLastSentByChatUser(accountId, chatId, senderId);
    }
    const isFollowUp = Boolean(previous);


    const chatTitle = getChatTitle(message);
    const senderName = getSenderName(message);
    console.log("[AILead] Generating reply plan:", { accountId, chatId, msgId, sourceType, senderId, senderName, textPreview: text.slice(0, 160) });

    const messagePurpose = getEngagementPurpose(settings, accountId, chatId, topicId);
    const decision = await askAi({
      settings,
      text,
      chatTitle,
      senderName,
      sourceType,
      isFollowUp,
      purpose: messagePurpose,
      historyRows: await AiLeadQueue.findRecentConversationByChat(accountId, chatId, 8),
      recentPrivateContext: message.recentPrivateContext || "",
    });

    const score = Number(decision.score || 0);
    const riskScore = Number(decision.risk_score || decision.riskScore || 0);
    const category = String(decision.category || "");
    const forceAdminApproval = shouldForceAdminApproval(text, decision, sourceType);
    const isEngagement = category === "general_engagement" || forceAdminApproval;
    const minScore =
      sourceType === "private" || isFollowUp
        ? Math.max(55, settings.aiLeadMinScore - 20)
        : isEngagement
          ? Math.max(40, Number(settings.aiLeadMinScore || 85) - 45)
          : Math.max(45, Number(settings.aiLeadMinScore || 85) - 35);
    const returnIgnored = (reason) => {
      if (sourceType === "private" && activeSeenKey) seenMessages.delete(activeSeenKey);
      return { status: "ignored", reason, decision: { category, score, riskScore, minScore, reason: decision.reason || "" } };
    };

    if (sourceType === "private" && !decision.reply) return returnIgnored("empty_reply");
    if (sourceType !== "private" && !decision.should_reply) return returnIgnored("ai_rejected_should_reply_false");
    if (sourceType !== "private" && score < minScore) return returnIgnored("ai_rejected_score_below_min");
    if (sourceType !== "private" && riskScore > 75 && category !== "admin_review" && category !== "blocked_topic") return returnIgnored("ai_rejected_risk_too_high");

    const reply = sanitizeReply(decision.reply, {
      allowLinks: sourceType === "private",
      preserveFormatting: sourceType === "private",
      contextText: text,
      privateRaw: sourceType === "private",
    });
    if (!reply || reply.length < 3) return returnIgnored("empty_reply");
    if (sourceType === "group" && (isGenericTemplateReply(reply) || isOverPoliteBotToneReply(reply))) return returnIgnored("generic_template_reply");
    if (sourceType === "group" && isPromotionPurpose(messagePurpose) && mentionsPublicPromotionBrand(reply)) return returnIgnored("brand_mention_in_soft_promo");
    if (sourceType === "group" && isBuyerStyleReply(reply)) return returnIgnored("buyer_style_reply");
    if (sourceType === "group" && (await hasRecentSimilarReply(accountId, chatId, reply))) return returnIgnored("duplicate_reply");

    const item = await queueDecision({ accountId, message, text, decision, sourceType, isFollowUp, followUpToQueueId: previous?._id || "" });
    logAiLeadSelectedReply(item, decision, reply, { accountId, chatId, msgId, sourceType, senderName, text });
    logReplyCandidate(item, decision, "single");

    if (settings.aiLeadMode !== "auto") {
      notifyApproval(item, forceAdminApproval ? "Admin approval required for blocked/sensitive topic" : "");
      return { status: "queued", item };
    }

    const queued = await queueAutoSend(item, settings);
    return { status: "queued", item: queued };
  } catch (err) {
    console.error("[AILead] handleIncoming error:", err);
    if (activeSeenKey) seenMessages.delete(activeSeenKey);
    return { status: "error", error: err.message };
  }
}

function validateBufferedBatchDecisionJson(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "Root JSON must be an object";
  if (!Array.isArray(parsed.candidates)) return "Missing candidates array";
  for (const candidate of parsed.candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return "Each candidate must be an object";
    if (!Number.isFinite(Number(candidate.batch_id))) return "Each candidate needs numeric batch_id";
    if (typeof candidate.should_reply !== "boolean") return "Each candidate needs boolean should_reply";
    if (typeof candidate.category !== "string") return "Each candidate needs string category";
    if (!Number.isFinite(Number(candidate.score))) return "Each candidate needs numeric score";
    if (!Number.isFinite(Number(candidate.risk_score ?? candidate.riskScore))) return "Each candidate needs numeric risk_score";
    if (typeof candidate.reason !== "string") return "Each candidate needs string reason";
    if (candidate.should_reply && typeof candidate.reply !== "string") return "Reply candidates need string reply";
  }
  return true;
}

function logBufferedGroupSummary(summary, extra = {}) {
  console.log("[AILead] Buffered group summary:", {
    reason: summary?.reason || "",
    received: Number(summary?.received || 0),
    eligible: Number(summary?.eligible || 0),
    queued: Number(summary?.queued || 0),
    sent: Number(summary?.sent || 0),
    ignored: Number(summary?.ignored || 0),
    ignoredReasons: summary?.ignoredReasons || {},
    ignoredSamples: summary?.ignoredSamples || {},
    errors: summary?.errors || [],
    ...extra,
  });
}

async function processBufferedGroupMessages({ items = [], reason = "manual" } = {}) {
  const settings = await GlobalSetting.findOne({ type: "global_app_settings" });
  const summary = { success: true, reason, received: items.length, eligible: 0, queued: 0, sent: 0, ignored: 0, ignoredReasons: {}, ignoredSamples: {}, errors: [] };

  if (!settings?.openaiApiKey || settings.aiLeadUserReplyEnabled === false || !settings.aiLeadEnabled) {
    return { ...summary, success: false, error: "AI Lead disabled or missing API key" };
  }

  const ignore = (reasonName, sample = null) => {
    summary.ignored += 1;
    summary.ignoredReasons[reasonName] = (summary.ignoredReasons[reasonName] || 0) + 1;
    if (sample) {
      summary.ignoredSamples[reasonName] = summary.ignoredSamples[reasonName] || [];
      if (summary.ignoredSamples[reasonName].length < 3) summary.ignoredSamples[reasonName].push(sample);
    }
  };
  const getGroupIgnoreSample = (message, text, extra = {}) => ({ chat: getChatTitle(message), sender: getSenderName(message), messageId: message.id?.toString?.() || String(message.id || ""), text: String(text || "").slice(0, 160), ...extra });

  const compact = [];
  const byBatchId = new Map();
  const seenSenderKeys = new Set();
  const seenFingerprints = new Set();
  const maxItems = 50;

  for (const item of items) {
    const accountId = item.accountId;
    const client = item.client;
    const message = item.message;
    const sourceType = getSourceType(message || {});
    if (sourceType !== "group") { ignore("not_group"); continue; }
    if (Array.isArray(settings.aiLeadAccountIds) && settings.aiLeadAccountIds.length > 0 && !settings.aiLeadAccountIds.includes(accountId)) { ignore("account_not_enabled"); continue; }
    const text = getMessageText(message);
    if (!message || message.out || (!text && message.media)) { ignore("unsupported_message"); continue; }
    if (!text) { ignore("invalid_text"); continue; }
    if (isLikelySelfMessage(settings, accountId, message, text)) { ignore("self_message"); continue; }
    if (await shouldIgnoreBotLikeUserAsync({ settings, accountId, client, message, text })) { ignore("bot_like_user", getGroupIgnoreSample(message, text)); continue; }
    if (isBotLikeSellerAdText(text)) { ignore("bot_like_ad", getGroupIgnoreSample(message, text)); continue; }

    const chatId = getChatId(message);
    const msgId = message.id?.toString?.() || String(message.id || "");
    const senderId = getSenderId(message);
    const topicId = getTopicId(message);
    if (!chatId || !msgId) { ignore("missing_ids"); continue; }
    if (!isEngagementTargetAllowed(settings, accountId, chatId, topicId)) { ignore("target_not_allowed"); continue; }
    const seenKey = `${accountId}:${chatId}:${msgId}`;
    if (seenMessages.has(seenKey)) { ignore("seen"); continue; }
    if (await AiLeadQueue.findByMessage(accountId, chatId, msgId)) { ignore("already_queued"); continue; }
    if (senderId && (await isBlacklisted(accountId, senderId))) { ignore("blacklisted_group_user"); continue; }

    const fingerprint = normalizeMessageFingerprint(text);
    const senderKey = `${accountId}:${senderId}`;
    if (!fingerprint || seenFingerprints.has(fingerprint) || (senderId && seenSenderKeys.has(senderKey)) || (await hasRecentDuplicateFromSender(accountId, senderId, text))) { ignore("duplicate"); continue; }

    seenMessages.add(seenKey);
    if (seenMessages.size > 5000) seenMessages.clear();
    seenFingerprints.add(fingerprint);
    if (senderId) seenSenderKeys.add(senderKey);

    const batchId = compact.length + 1;
    const historyRows = await AiLeadQueue.findRecentConversationByChat(accountId, chatId, 4).catch(() => []);
    const row = { batch_id: batchId, account_id: String(accountId), chat_id: chatId, message_id: msgId, chat: getChatTitle(message), topic_id: topicId || "", purpose: getEngagementPurpose(settings, accountId, chatId, topicId), sender_id: senderId, sender: getSenderName(message), text: text.slice(0, 700), recent_context: historyRows.map((entry) => ({ user: entry.originalText, bot: entry.suggestedReply })).slice(-4) };
    compact.push(row);
    byBatchId.set(String(batchId), { accountId, message, text, row });
    summary.eligible += 1;
    if (compact.length >= maxItems) break;
  }

  if (!compact.length) {
    logBufferedGroupSummary(summary, { aiCalled: false });
    return summary;
  }

  console.log("[AILead] Buffered group AI batch prepared:", { reason, received: items.length, eligible: compact.length, ignored: summary.ignored, ignoredReasons: summary.ignoredReasons });
  const playbook = getTelegramBotRolePrompt();
  const parsed = await createJsonChatCompletion(settings, [
    { role: "system", content: `${settings.aiLeadPrompt}\n\n${playbook}\n\nYou are scanning a buffered real-time Telegram feed across multiple groups, topics, and accounts. Each input item has a unique batch_id and purpose. Use recent_context for that account/chat before deciding, so follow-ups remain coherent. Select up to 5 good safe candidates per batch when the chat has enough openings. In large active groups, visibility and natural participation are valid goals, but replies must match the configured purpose. Skip bot-like seller users when the sender username ends with _bot or the sender bio contains a _bot username. Also skip bot-like seller ads that include @...bot or t.me/...bot order/shop/deposit bot links. You may choose general_engagement for lively public chatter, jokes, opinions, market/news reactions, seller listings, stock/price/delivery questions, or community discussion when the reply can mention a concrete detail from that post and sound like a real participant. Ordinary seller ads and promo posts are valid. For items where purpose is promotion, soft-promotion, quảng bá, seed, or similar: promote our shop-bot solution indirectly, not the other seller's product. Do NOT mention TeleShopBot in public group replies. Do NOT act like a buyer, do NOT ask buying price, warranty, delivery availability, or supplier questions, and do NOT write replies like "Any bulk price?" or "How many keys do you need?". If the seller posts many packages, tiers, or bulk pricing, ask whether they manage those packages/prices manually, then pivot. In one message, ask a light operations question first, then pivot to a generic Telegram shop bot, stock/order dashboard, tier/package management, auto delivery, auto QR/payment notes, affiliate/referral tracking, DM handling, or less manual work. Example: "Do you manage bulk prices manually? A shop bot keeps packages and orders cleaner." No direct links, no @mentions, no brand name. If you cannot ask-then-pivot naturally, set should_reply false. Do not over-police normal market chatter. Skip stale spam, duplicate-like content, pure insults, slurs, bait, threats, harassment, and broad coding/general-knowledge requests. Only mark scam/fraud/blocked_topic when there is explicit evidence of stolen funds/accounts/cards, phishing, malware, hacking services, carding, or laundering dirty funds. Never self-identify as a bot, AI, automation, tool, script, or seeding account.\n\nReturn JSON only: {"candidates":[{"batch_id":number,"should_reply":boolean,"category":"direct_lead|soft_opportunity|general_engagement|admin_review|blocked_topic|ignore","score":0-100,"risk_score":0-100,"reason":"short","reply":"natural English reply without links"}]}` },
    { role: "user", content: `Buffered messages JSON:\n${JSON.stringify(compact)}` },
  ], { temperature: 0.4, maxTokens: 1800, sessionPrefix: "ai-lead-buffered-group", timeoutMs: 0, validateJson: validateBufferedBatchDecisionJson });

  const minScore = Math.max(40, Number(settings.aiLeadMinScore || 85) - 45);
  const decisions = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  const decidedBatchIds = new Set();
  const batchReplyFingerprints = new Set();
  const batchReplyOpenings = new Set();

  for (const decision of decisions) {
    const mapped = byBatchId.get(String(decision.batch_id));
    if (!mapped) { ignore("unknown_batch_id"); continue; }
    decidedBatchIds.add(String(decision.batch_id));
    const { accountId, message, text, row } = mapped;
    const chatId = getChatId(message);
    const senderName = getSenderName(message);
    const score = Number(decision.score || 0);
    const riskScore = Number(decision.risk_score || decision.riskScore || 0);
    const category = String(decision.category || "");
    const reply = sanitizeReply(decision.reply);
    const aiRejectSample = getGroupIgnoreSample(message, text, { category, score, riskScore, aiReason: decision.reason || "" });

    if (!decision.should_reply) { ignore("ai_rejected_should_reply_false", aiRejectSample); continue; }
    if (score < minScore) { ignore("ai_rejected_score_below_min", aiRejectSample); continue; }
    if (riskScore > 75 && category !== "admin_review" && category !== "blocked_topic") { ignore("ai_rejected_risk_too_high", aiRejectSample); continue; }
    if (!reply || reply.length < 3) { ignore("empty_reply"); continue; }
    const replyFingerprint = normalizeReplyFingerprint(reply);
    const replyOpening = getReplyOpening(reply);
    if (isGenericTemplateReply(reply) || isOverPoliteBotToneReply(reply)) { ignore("generic_template_reply"); continue; }
    if (isPromotionPurpose(row?.purpose) && mentionsPublicPromotionBrand(reply)) { ignore("promotion_brand_mention_reply", aiRejectSample); continue; }
    if (isBuyerStyleReply(reply)) { ignore(isPromotionPurpose(row?.purpose) ? "promotion_buyer_style_reply" : "buyer_style_reply", aiRejectSample); continue; }
    if ((replyFingerprint && batchReplyFingerprints.has(replyFingerprint)) || (replyOpening && batchReplyOpenings.has(replyOpening)) || (await hasRecentSimilarReply(accountId, chatId, reply))) { ignore("duplicate_reply"); continue; }
    if (replyFingerprint) batchReplyFingerprints.add(replyFingerprint);
    if (replyOpening) batchReplyOpenings.add(replyOpening);

    const item = await queueDecision({ accountId, message, text, decision, sourceType: "group", isFollowUp: false, followUpToQueueId: "" });
    logAiLeadSelectedReply(item, decision, reply, { accountId, chatId, sourceType: "group", senderName, text });
    logReplyCandidate(item, decision, "buffered_group");

    const forceAdminApproval = shouldForceAdminApproval(text, decision, "group");
    if (settings.aiLeadMode !== "auto") {
      notifyApproval(item, forceAdminApproval ? "Admin approval required for blocked/sensitive topic" : "AI Engagement suggestion");
      summary.queued += 1;
      continue;
    }
    await queueAutoSend(item, settings);
    summary.queued += 1;
  }

  for (const batchId of byBatchId.keys()) {
    if (!decidedBatchIds.has(String(batchId))) ignore("ai_no_decision");
  }
  logBufferedGroupSummary(summary, { aiCalled: true });
  return summary;
}
async function scanUnreadPrivateMessages(options = {}) {
  const telegramService = require("./telegramService");
  return telegramService.scanUnreadPrivateMessages(options);
}

async function getStatus() {
  const settings = await GlobalSetting.findOne({ type: "global_app_settings" });
  const pending = await AiLeadQueue.findRecent({ status: "pending" }, 5).catch(
    () => [],
  );
  return {
    ...(settings ? settings.toObject() : new GlobalSetting().toObject()),
    pendingCountPreview: pending.length,
  };
}

async function getBlacklistPaged(options = {}) {
  return AiLeadBlacklist.findBlacklistPaged(options);
}

setTimeout(async () => {
  try {
    const settings =
      (await GlobalSetting.findOne({ type: "global_app_settings" })) ||
      new GlobalSetting();
    await scheduleGlobalAutoSend(settings);
  } catch (err) {
    console.error("[AILead] Global auto-send startup schedule error:", err.message);
  }
}, 5000);

module.exports = {
  handleIncoming,
  getStatus,
  listPending,
  sendPending,
  skipPending,
  editPending,
  scanEngagementGroup,
  processBufferedGroupMessages,
  startAutoSendQueue,
  scanUnreadPrivateMessages,
  getBlacklist,
  getBlacklistPaged,
  removeFromBlacklist,
};
