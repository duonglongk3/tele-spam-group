const fs = require("fs");
const path = require("path");
const GlobalSetting = require("./models/Setting");
const AiLeadQueue = require("./models/AiLeadQueue");
const AiLeadBlacklist = require("./models/AiLeadBlacklist");
const { createJsonChatCompletion } = require("./aiClient");
const { Api } = require("telegram/tl");

const sendingIds = new Set();
const lastSendTimeByAccount = new Map();
const lastSentGroupKeyByAccount = new Map();

function readAgentKnowledgeFile(fileName, label) {
  try {
    const filePath = path.join(
      __dirname,
      "..",
      ".agents",
      "knowledge",
      fileName,
    );
    console.log(`[AILead Debug Path] ${label} path:`, filePath, "exists:", fs.existsSync(filePath));
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

class PriorityMutex {
  constructor() {
    this.privateQueue = [];
    this.groupQueue = [];
    this.locked = false;
  }
  
  async acquire(isPrivate = false) {
    return new Promise((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve(() => this.release());
      } else {
        if (isPrivate) {
          this.privateQueue.push(resolve);
        } else {
          this.groupQueue.push(resolve);
        }
      }
    });
  }
  
  release() {
    if (this.privateQueue.length > 0) {
      const nextResolve = this.privateQueue.shift();
      nextResolve(() => this.release());
    } else if (this.groupQueue.length > 0) {
      const nextResolve = this.groupQueue.shift();
      nextResolve(() => this.release());
    } else {
      this.locked = false;
    }
  }
}

const aiProcessMutex = new PriorityMutex();

const groupBadSenders = new Map(); // key: "accountId:senderId", value: { accountId, senderId, senderName, score, reason, addedAt }
const accountDailyCounts = new Map();
const groupDailyCounts = new Map();
const groupCooldowns = new Map();
const userCooldowns = new Map();
let autoSendQueueEnabled = true;
let autoSendQueueStarted = false;
const groupTimers = new Map();
const groupRunning = new Set();
const groupScheduleChains = new Map();
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

function isToxicOrAbusive(text) {
  if (!text) return false;
  const clean = text.toLowerCase().trim();
  const toxicPatterns = [
    /\bkys\b/i,
    /\bfag(got|ged)?s?\b/i,
    /\bnigg(er|a)s?\b/i,
    /\bretard(ed)?s?\b/i,
    /\bcunt(s)?\b/i,
    /\b(bitch|whore|slut)s?\b/i,
    /\b(asshole|dickhead)s?\b/i,
    /\bmotherfucker\b/i,
  ];

  for (const pattern of toxicPatterns) {
    if (pattern.test(clean)) {
      return true;
    }
  }
  return false;
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
  const selfNames = [settings?.telegramBotUsername]
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
  return false;
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
  return false;
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

function getPromotionPurposePrompt(purpose) {
  return "";
}
function mentionsPublicPromotionBrand(reply) {
  return false;
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
  return Boolean(sender.bot || isTelegramBotLikeUsername(username));
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
  if (sender.bot || isTelegramBotLikeUsername(username)) {
    return { reason: "username_has__bot", value: `@${normalizeTelegramUsername(username)}`, bio: "" };
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
  return text;
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
  const recent = await AiLeadQueue.findRecent({ accountId, chatId, status: "sent" }, 5).catch(() => []);
  return recent.some((item) => {
    const existingFingerprint = normalizeReplyFingerprint(item.suggestedReply);
    if (!existingFingerprint) return false;
    return existingFingerprint === fingerprint;
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
    if (isToxicOrAbusive(text)) continue;

    const senderId = msg.fromId?.toString() || msg.senderId?.toString() || "";
    if (senderId && blockedSenderIds.has(senderId)) {
      skippedBlacklisted += 1;
      continue;
    }

    const fingerprint = normalizeMessageFingerprint(text);
    if (!fingerprint) continue;
    if (
      seenFingerprints.has(fingerprint) ||
      (senderId && seenSenderIds.has(senderId))
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
[ROLE: BULK GMAIL BUYER & WHOLESALE SOURCER]
- You are participating in a PUBLIC TELEGRAM GROUP chat.
- Act as an experienced bulk Gmail buyer looking to source aged Gmail accounts (created between 2000 and 2025).
- Your ultimate goal is to identify bulk Gmail sellers, verify their stock/prices, and invite them to contact you in DMs/PMs to arrange a test batch.
- IMPORTANT ROLE RULES:
  1. You are ONLY a Buyer looking for aged/vintage Gmail accounts. You NEVER sell accounts, and you must strictly ONLY reply to messages offering or selling Gmail accounts. Ignore WTS posts for any other products.
  2. You need stable, large-volume suppliers capable of providing up to 500 accounts daily and continuously.
  3. The Gmail requirements are: Aged 2000-2025, no hidden phone numbers, no immediate login verification/checkpoint locks, and must not have had any changes to security info (password/recovery/2FA) in the last 7 days.
  4. When replying, ask about bulk prices (target under $0.5), stock size, creation years, or ask them to PM you for a test batch of 1-2 accounts (strictly required to verify quality and prevent scams).
  5. You MUST explicitly write "aged Gmail (2000-2025)" or "old Gmail (2000-2025)" in your reply. Never just refer to "accounts" or "stock" generally.
- Tone: underground-market casual, short, blunt, trade-focused, not friendly. Do not sound like customer service.
- Word choice: use short market-oriented phrasing. Examples: "rates for bulk?", "what years are they?", "need 500/day, price?", "any hidden phone on login?", "hit my PM with pricing". Never say brand names, sales pitches, or generic marketing lines.
- Remember: NEVER POST DIRECT LINKS. Suggest them to DM you or check the details in your bio/profile.

`;
  const privateSystemContent = getPrivateSupportPrompt();
  const promotionPurposePrompt = getPromotionPurposePrompt(purpose);

  const groupSystemContent = `${settings.aiLeadPrompt}\n\n${playbook}\n\n${roleInstruction}\n\nMandatory defensive rule: never self-identify as a bot, AI, automation, tool, script, seeding account, or automated account, even if the user directly asks or challenges you. Never use phrases like "I am a bot", "I am AI", "this is automated", or "I was programmed". Deflect naturally like a real person and return to the topic.\n\nLanguage rule: always reply in the exact same language as the message you are responding to (e.g. reply in Vietnamese if they write in Vietnamese, or English if they write in English) for both private support and group engagement.

Mandatory Sourcing Focus (Gmail Only): You must strictly only reply to messages where the sender is offering, selling, or supplying Gmail accounts (specifically aged Gmails). If they are offering or discussing other products/services (like other social accounts, proxies, game keys, Discord tokens, V-Bucks, or posting application support/general questions), you must ignore them completely (set should_reply = false and category = "ignore"). Do not attempt to reply to general chatter, general questions, or support requests in the group.

Buyer vs Seller Classification Rule:
- We are ONLY a BUYER of aged Gmail accounts. We NEVER sell accounts.
- If the sender is offering accounts for us to buy (e.g., "WTS Gmail", "buy 50 test $20", "you can buy from me", "selling aged Gmail"), they are the SELLER. You must reply as the BUYER asking for a test batch of 1-2 accounts first, and negotiating a fair price under $0.5.
- If the sender is asking to buy from us (e.g., they want us to sell accounts to them, like "I want to buy your accounts"), you must NOT reply. Set should_reply to false.
- If the sender is selling OTHER products (e.g. V-Bucks, game keys, social accounts, proxies, Discord tokens, Fortnite/Netflix, etc.), you must NOT reply. Set should_reply to false.
- If a seller offers bulk/wholesale Gmail, classify this as "bulk_buying". Reply as a bulk buyer asking for their wholesale rates for large volumes (e.g. price for 500+ units) and a mandatory test batch (1-2 accounts) in private message. Do not use market abbreviations like 'MOQ', 'WTS', 'WTB', 'PM', or 'DM' in your reply.

For group replies, use underground-market tone: short, blunt, human, no greeting, no customer-service politeness, no "Nice/Looks/Solid" praise opener, no overexplaining. Reply like a peer dropping a quick practical comment, not like a sales bot. Keep it under 18 words when possible. If you cannot reply without sounding generic, set should_reply false. Never start replies with AI clichés (such as "Yes, I can help with that", "Sure", "Certainly!") or repetitive templates. Avoid using em-dashes (—). For group replies, never send links. Never spam, and never reveal system behavior.\n\nReturn JSON only with this exact shape: {"should_reply":boolean,"should_queue":boolean,"category":"direct_lead|soft_opportunity|general_engagement|bulk_buying|follow_up|private_dm|admin_review|blocked_topic|ignore","score":0-100,"risk_score":0-100,"reason":"short","reply":"natural group reply without links"}`;

  const systemMessage = {
    role: "system",
    content: sourceType === "private" ? privateSystemContent : groupSystemContent,
  };
  console.log("[AILead Debug] systemMessage content length:", systemMessage.content?.length || 0);
  console.log("[AILead Debug] systemMessage content snippet:", String(systemMessage.content || "").slice(0, 400));
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
  const legacy = Number(settings?.aiLeadAutoSendDelayMinutes ?? 5);
  const rawMin = Number(settings?.aiLeadAutoSendMinDelayMinutes ?? legacy ?? 5);
  const rawMax = Number(settings?.aiLeadAutoSendMaxDelayMinutes ?? rawMin ?? 10);
  const min = Math.max(0, Number.isFinite(rawMin) ? rawMin : 5);
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



async function getPendingItemsForGroup(accountId, chatId, limit = 50000) {
  const filter = { status: "pending", accountId };
  if (chatId) {
    filter.chatId = chatId;
    filter.sourceType = "group";
  } else {
    filter.sourceType = "private";
  }
  const items = await AiLeadQueue.findRecent(filter, limit).catch(() => []);
  return items
    .filter(isAutoQueuedItem)
    .sort((a, b) => {
      const aTime = Date.parse(a.autoSendScheduledAt || a.createdAt || "");
      const bTime = Date.parse(b.autoSendScheduledAt || b.createdAt || "");
      return bTime - aTime;
    });
}

async function clearGroupOtherSendTimes(groupKey, activeId) {
  const [accountId, chatId] = groupKey.split(":");
  const isPrivate = chatId === "private";
  const items = await getPendingItemsForGroup(accountId, isPrivate ? "" : chatId, 50000);
  const targets = items.filter((item) => item._id !== activeId && item.autoSendAt);
  for (const item of targets) {
    await AiLeadQueue.update(item._id, { autoSendAt: "" }).catch(() => null);
  }
}

function scheduleGroupAutoSend(groupKey, settings, options = {}) {
  if (!groupScheduleChains.has(groupKey)) {
    groupScheduleChains.set(groupKey, Promise.resolve());
  }
  const chain = groupScheduleChains.get(groupKey);
  const nextChain = chain
    .catch(() => null)
    .then(() => scheduleGroupAutoSendOnce(groupKey, settings, options));
  groupScheduleChains.set(groupKey, nextChain);
  return nextChain;
}

async function scheduleGroupAutoSendOnce(groupKey, settings, options = {}) {
  if (groupTimers.has(groupKey)) {
    clearTimeout(groupTimers.get(groupKey));
    groupTimers.delete(groupKey);
  }
  if (groupRunning.has(groupKey)) return;
  if (!autoSendQueueEnabled) return;

  const [accountId, chatId] = groupKey.split(":");
  const isPrivate = chatId === "private";

  const items = await getPendingItemsForGroup(accountId, isPrivate ? "" : chatId, 50000);
  if (!items.length) return;

  const now = Date.now();
  // Tìm item quá hạn gửi
  const due = items
    .filter((item) => item.autoSendAt && Date.parse(item.autoSendAt) <= now)
    .sort((a, b) => Date.parse(a.autoSendAt) - Date.parse(b.autoSendAt))[0];

  if (due) {
    await clearGroupOtherSendTimes(groupKey, due._id);
    const timer = setTimeout(() => processGroupAutoSendQueue(groupKey), 0);
    groupTimers.set(groupKey, timer);
    if (!options.silent) {
      console.log(`[AILead-Group] Group ${groupKey} due item ready:`, due._id);
    }
    return;
  }

  // Tìm item đã có lịch trong tương lai
  const scheduled = items
    .filter((item) => item.autoSendAt && Date.parse(item.autoSendAt) > now)
    .sort((a, b) => Date.parse(a.autoSendAt) - Date.parse(b.autoSendAt))[0];

  if (scheduled) {
    await clearGroupOtherSendTimes(groupKey, scheduled._id);
    const timer = setTimeout(
      () => processGroupAutoSendQueue(groupKey),
      Math.max(0, Date.parse(scheduled.autoSendAt) - now),
    );
    groupTimers.set(groupKey, timer);
    if (!options.silent) {
      console.log(`[AILead-Group] Group ${groupKey} scheduled next item at:`, scheduled.autoSendAt);
    }
    return;
  }

  // Item mới chưa gán autoSendAt. Dùng delayMs
  const next = items[0];
  let delayMs =
    options.forceDelayMs !== undefined
      ? options.forceDelayMs
      : getRandomAutoSendDelayMs(settings);

  // Nếu là tin nhắn phản hồi tiếp (follow_up) trong group, dùng delay 30 giây để phản hồi nhanh
  if (next && next.category === "follow_up") {
    delayMs = 30000;
  } else if (next) {
    // Áp dụng cooldown toàn cầu giữa các nhóm khác nhau cho cùng một tài khoản (mặc định tối thiểu 5 phút)
    const lastSend = lastSendTimeByAccount.get(accountId) || 0;
    const timeSinceLastSend = Date.now() - lastSend;
    const cooldownMinutes = Number(settings?.aiLeadCooldownMinutes ?? 5);
    const cooldownMs = cooldownMinutes * 60 * 1000;
    if (timeSinceLastSend < cooldownMs) {
      const remainingCooldown = cooldownMs - timeSinceLastSend;
      if (delayMs < remainingCooldown) {
        delayMs = remainingCooldown;
      }
    }
  }
  const autoSendAt = new Date(Date.now() + delayMs).toISOString();

  await AiLeadQueue.update(next._id, { autoSendAt, autoSendError: "" });
  await clearGroupOtherSendTimes(groupKey, next._id);

  const timer = setTimeout(() => processGroupAutoSendQueue(groupKey), delayMs);
  groupTimers.set(groupKey, timer);
  if (!options.silent) {
    console.log(`[AILead-Group] Group ${groupKey} scheduled new item:`, {
      queueId: next._id,
      delayMs,
      autoSendAt,
    });
  }
}

async function processGroupAutoSendQueue(groupKey) {
  if (groupRunning.has(groupKey)) return;
  groupRunning.add(groupKey);
  groupTimers.delete(groupKey);

  let settings = null;
  let activeAutoSendItem = null;
  let sendSuccess = false;
  try {
    settings =
      (await GlobalSetting.findOne({ type: "global_app_settings" })) ||
      new GlobalSetting();
    const [accountId, chatId] = groupKey.split(":");
    const isPrivate = chatId === "private";

    const now = Date.now();
    const items = await getPendingItemsForGroup(accountId, isPrivate ? "" : chatId, 50000);
    const item = items
      .filter(
        (entry) => entry.autoSendAt && Date.parse(entry.autoSendAt) <= now,
      )
      .sort((a, b) => Date.parse(a.autoSendAt) - Date.parse(b.autoSendAt))[0];

    if (!item) return;
    activeAutoSendItem = item;

    const lastSend = lastSendTimeByAccount.get(accountId) || 0;
    const timeSinceLastSend = Date.now() - lastSend;
    const cooldownMinutes = Number(settings?.aiLeadCooldownMinutes ?? 5);
    const cooldownMs = cooldownMinutes * 60 * 1000;
    if (item.sourceType === "group" && item.category !== "follow_up" && timeSinceLastSend < cooldownMs) {
      const remainingCooldown = cooldownMs - timeSinceLastSend;
      const newAutoSendAt = new Date(Date.now() + remainingCooldown).toISOString();
      await AiLeadQueue.update(item._id, { autoSendAt: newAutoSendAt });
      console.log(`[AILead-Group] Global cooldown hit for account ${accountId}. Postponing queue item ${item._id} by ${remainingCooldown}ms`);
      sendSuccess = true;
      return;
    }

    // CHECK VÒNG LẶP XOAY VÒNG NHÓM (ROUND-ROBIN):
    // Không cho phép gửi 2 lần liên tiếp ở cùng một nhóm nếu các nhóm khác đang có tin nhắn chờ gửi.
    if (item.sourceType === "group" && item.category !== "follow_up" && lastSentGroupKeyByAccount.get(accountId) === groupKey) {
      const otherPending = await AiLeadQueue.findRecent({ status: "pending", accountId }, 100).catch(() => []);
      const hasOtherGroups = otherPending.some((entry) => {
        if (entry.status !== "pending") return false;
        const entryGroupKey = entry.sourceType === "private" ? `${entry.accountId}:private` : `${entry.accountId}:${entry.chatId}`;
        return entryGroupKey !== groupKey && entry.sourceType === "group" && entry.category !== "follow_up";
      });
      if (hasOtherGroups) {
        // Có nhóm khác đang xếp hàng chờ. Lùi lịch nhóm này lại để nhường cho nhóm khác.
        const delayMs = Math.max(cooldownMs, 60000); // Tối thiểu 1 phút để tránh vòng lặp vô hạn nếu cooldown cài là 0
        const newAutoSendAt = new Date(Date.now() + delayMs).toISOString();
        await AiLeadQueue.update(item._id, { autoSendAt: newAutoSendAt });
        console.log(`[AILead-Group] Round-Robin check hit for account ${accountId}. Group ${groupKey} was the last sent. Postponing by ${delayMs}ms to let other groups send.`);
        sendSuccess = true;
        return;
      }
    }

    await clearGroupOtherSendTimes(groupKey, item._id);
    await AiLeadQueue.update(item._id, {
      autoSendAttempts: Number(item.autoSendAttempts || 0) + 1,
      autoSendError: "",
    });

    const result = await sendPending(item._id, { source: "auto_queue" });
    if (result?.success) {
      sendSuccess = true;
    } else {
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
    await clearGroupOtherSendTimes(groupKey, item._id);
  } catch (err) {
    console.error(`[AILead-Group] Group ${groupKey} auto-send error:`, err.message);
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
    groupRunning.delete(groupKey);
    const forceDelayMs = sendSuccess ? undefined : 5000;
    scheduleGroupAutoSend(groupKey, settings || new GlobalSetting(), {
      forceDelayMs,
    }).catch((err) => {
      console.error(`[AILead-Group] Group ${groupKey} reschedule error:`, err.message);
    });
  }
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

async function queueAutoSend(item, settings) {
  const queued = await AiLeadQueue.update(item._id, {
    status: "pending",
    autoSendAt: "", // Để trống autoSendAt để tránh xung đột hàng chờ, hệ thống tự động lên lịch gửi giãn cách khi đến lượt
    autoSendScheduledAt: item.autoSendScheduledAt || new Date().toISOString(),
    autoSendError: "",
  });

  const groupKey = item.sourceType === "private" ? `${item.accountId}:private` : `${item.accountId}:${item.chatId}`;
  await scheduleGroupAutoSend(groupKey, settings);

  console.log("[AILead] Auto-send added to group queue:", {
    queueId: queued?._id,
    groupKey,
  });
  return queued || item;
}

async function startAutoSendQueue() {
  autoSendQueueEnabled = true;
  if (autoSendQueueStarted) {
    console.log("[AILead] Telegram AutoSend Queue is already running. Skipping duplicate startup.");
    return { success: true };
  }
  autoSendQueueStarted = true;

  const settings =
    (await GlobalSetting.findOne({ type: "global_app_settings" })) ||
    new GlobalSetting();
  
  const hasActiveFeature = settings.aiLeadEnabled || settings.aiLeadUserReplyEnabled;
  if (!settings.openaiApiKey || !hasActiveFeature) {
    console.log("[AILead] AutoSend Queue is disabled or OpenAI API Key is missing. Skipping queue start.");
    return { success: true };
  }
  
  const pendingItems = await AiLeadQueue.findRecent({ status: "pending" }, 50000).catch(() => []);
  
  const groupKeys = new Set();
  for (const item of pendingItems) {
    if (item.autoSendScheduledAt || item.autoSendAt) {
      const groupKey = item.sourceType === "private" ? `${item.accountId}:private` : `${item.accountId}:${item.chatId}`;
      groupKeys.add(groupKey);
    }
  }

  for (const groupKey of groupKeys) {
    await scheduleGroupAutoSend(groupKey, settings, { silent: true });
  }

  console.log(`[AILead] Telegram AutoSend Queue started for ${groupKeys.size} groups:`, Array.from(groupKeys));
  return { success: true };
}

async function sendPending(id, options = {}) {
  if (sendingIds.has(id)) {
    return { success: false, error: "Tin nhắn đang được xử lý, vui lòng không gửi liên tiếp." };
  }
  sendingIds.add(id);

  let acquiredClient = null;
  let temporaryClient = false;
  try {
    const item = await AiLeadQueue.findById(id);
    if (!item) return { success: false, error: "Không tìm thấy pending reply." };
    if (item.status !== "pending") {
      return {
        success: false,
        error: `Item này đang ở trạng thái ${item.status}.`,
      };
    }

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
    lastSendTimeByAccount.set(item.accountId, Date.now());
    const groupKey = item.sourceType === "private" ? `${item.accountId}:private` : `${item.accountId}:${item.chatId}`;
    lastSentGroupKeyByAccount.set(item.accountId, groupKey);
    return { success: true, item: sent };
  } catch (err) {
    console.error("[AILead] sendPending failed:", { id, error: err.message });
    return { success: false, error: err.message };
  } finally {
    if (temporaryClient && acquiredClient) {
      acquiredClient.disconnect().catch(() => {});
    }
    sendingIds.delete(id);
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
    const groupKey = current.sourceType === "private" ? `${current.accountId}:private` : `${current.accountId}:${current.chatId}`;
    await scheduleGroupAutoSend(groupKey, settings);
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

Mandatory Sourcing Focus (Gmail Only): You must strictly only reply to messages where the sender is offering, selling, or supplying Gmail accounts (specifically aged Gmails). If they are offering or discussing other products/services (like other social accounts, proxies, game keys, Discord tokens, V-Bucks, or posting application support/general questions), you must ignore them completely (set should_reply = false and category = "ignore"). Do not attempt to reply to general chatter, general questions, or support requests in the group.

You are strictly an experienced bulk Gmail buyer. Responses must be 1-3 lines max. Keep it simple and clear. You must always explicitly write "aged Gmail (2000-2025)" or "old Gmail (2000-2025)" in your responses. Never just say "accounts" or "stock" generally. Invite them to contact you in DMs/PMs.
No direct links, no @mentions, no brand names. Never start replies with AI clichés (such as "Yes, I can help with that", "Sure") or use em-dashes (—).

Return JSON only: {"candidates":[{"message_id":number,"should_reply":boolean,"category":"direct_lead|soft_opportunity|general_engagement|bulk_buying|admin_review|blocked_topic|ignore","score":0-100,"risk_score":0-100,"reason":"short","reply":"natural reply with Telegram-friendly formatting: group replies must not include links, brand names, or @mentions; direct to the point without AI filler phrases (e.g., no 'Yes, I can help with that', 'Sure', 'Certainly'), and no em-dashes (—)"}]}`,
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

function getFallbackReply(text, sourceType, historyRows = []) {
  const cleanText = String(text || "").toLowerCase();
  const isVietnamese = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệđìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/i.test(cleanText) ||
                       /\b(ib|ibox|giá|gia|bn|nhiêu|nhiu|bán|ban|mua|còn|con|hàng|hang|ko|không|khong|bác|bac|pro|rep|sao)\b/i.test(cleanText);

  // 1. Check if price is too high (> $0.55 or > 14k VND)
  const isPriceTooHigh = /((?<!\.)\b(0\.[6-9]\d*|[1-9]\d*)\s*(\$|usd))|(\b(1[5-9]|[2-9]\d)\s*k\b)|(\b(1[5-9]|[2-9]\d)\.?000\s*(vnd|vnđ|đ|đồng))/i.test(cleanText);

  // 2. Check if price is close/acceptable (between $0.1 and $0.55, or 5k and 14k VND)
  const isPriceAcceptable = /((?<!\.)\b(0\.[1-5]\d*|0\.55)\s*(\$|usd))|(\b([5-9]|1[0-4])\s*k\b)|(\b([5-9]|1[0-4])\.?000\s*(vnd|vnđ|đ|đồng))/i.test(cleanText);

  // Kiểm tra lịch sử xem Bot đã nói gì ở các tin nhắn trước
  let hasBargained = false;
  let hasInsistedOnTest = false;

  if (Array.isArray(historyRows)) {
    for (const row of historyRows) {
      const replyLower = String(row.suggestedReply || "").toLowerCase();
      if (replyLower.includes("negotiate to $0.4") || replyLower.includes("giá dưới 12k") || replyLower.includes("high for my budget")) {
        hasBargained = true;
      }
      if (replyLower.includes("strictly need a 1-2") || replyLower.includes("cần test trước 1-2")) {
        hasInsistedOnTest = true;
      }
    }
  }

  if (sourceType === "private") {
    if (isVietnamese) {
      // BƯỚC ĐÀM PHÁN TIẾP THEO (NẾU ĐÃ TỪNG MẶC CẢ)
      if (hasBargained) {
        if (isPriceAcceptable || cleanText.includes("0.55") || cleanText.includes("13k") || cleanText.includes("12k")) {
          return "Dạ ok bác, mức giá tầm 12k-13k (0.55$) em chấp nhận được nếu acc chất lượng tốt. Bác cứ cho em xin test trước 1-2 acc nhé. Ok em thanh toán USDT lấy luôn.";
        }
        if (isPriceTooHigh || cleanText.includes("1$") || cleanText.includes("20k") || cleanText.includes("24k")) {
          return "Dạ giá cao thế em không cân đối được bác ơi. Em mua sỉ sll chỉ mua được tầm dưới 13k thôi ạ. Cảm ơn bác.";
        }
        if (hasInsistedOnTest) {
          return "Em không thể chuyển tiền trước mà không có test acc để tránh bị scam bác ơi. Nếu bác cho test 1-2 acc thì nhắn em, không thì em cảm ơn nhé.";
        }
        return "Bác cứ cho em xin test trước 1-2 acc nhé. Test ok em lấy cả mẻ luôn không lằng nhằng đâu bác.";
      }

      // BƯỚC ĐẦU (NẾU CHƯA TỪNG MẶC CẢ)
      if (isPriceTooHigh) {
        return "Giá này hơi cao so với ngân sách của em bác ơi. Em mua đều sll hàng ngày (lên đến 500 acc/ngày), bác để em giá dưới 12k (hoặc 0.45$) được không bác? Với lại bác cho em xin test trước 1-2 acc nhé.";
      }
      if (isPriceAcceptable) {
        return "Rate của bác tốt quá! Bác cho em xin test trước 1-2 acc để check chất lượng đăng nhập nhé. Nếu ok em lấy sll thanh toán qua USDT/Binance Pay luôn bác.";
      }
      if (/^(hi|hello|hallo|hey|yo|chao|chào|xin chào)\b/i.test(cleanText) || cleanText.length < 5) {
        return "Chào bác! Bác có bán Gmail cổ (2000-2025) không ạ? Cho em xin giá với số lượng hiện có nhé.";
      }
      if (/(giá|gia|sao|nhiêu|nhiu|rate|price|how much)/i.test(cleanText)) {
        return "Em tìm mua Gmail cổ (2000-2025) sll, giá mong muốn dưới 0.5$ (khoảng 12k/acc). Bác cho em xin rate nhé.";
      }
      if (/(no|không|khong|ko|đéo|deo|mua|chuyển|chuyen|pay|tiền|tien|cọc|coc)/i.test(cleanText)) {
        return "Thực sự là em cần test trước 1-2 acc xem chất lượng đăng nhập thế nào rồi mới giao dịch được bác ơi. Bác thông cảm giúp em nhé.";
      }
      return "Em tìm mua Gmail cổ (2000-2025) sll. Bác có thể cho em test thử 1-2 acc trước để kiểm tra chất lượng không ạ?";
    } else {
      // English
      // BƯỚC ĐÀM PHÁN TIẾP THEO (NẾU ĐÃ TỪNG MẶC CẢ)
      if (hasBargained) {
        if (isPriceAcceptable || cleanText.includes("0.55") || cleanText.includes("0.5")) {
          return "Okay, $0.55 is acceptable if the quality is perfect. But I still need a free test of 1-2 accounts first to verify there are no recovery phone or lock issues. If the test is clean, I will buy the batch immediately via USDT.";
        }
        if (isPriceTooHigh || cleanText.includes("1$") || cleanText.includes("1.0")) {
          return "Sorry, but $1 is too high for my budget. My max limit is $0.5 - $0.55 for bulk purchases. Thanks anyway.";
        }
        if (hasInsistedOnTest) {
          return "I cannot make any payment without a test first to avoid scams. If you can provide 1-2 test accounts, let me know. Otherwise, thank you.";
        }
        return "Please give me a quick 1-2 free test accounts first. If they are good, we can proceed with the deal immediately.";
      }

      // BƯỚC ĐẦU (NẾU CHƯA TỪNG MẶC CẢ)
      if (isPriceTooHigh) {
        return "That rate is a bit high for my budget. Since I buy in large bulk (up to 500 accounts daily), I'm looking for a steady supply at under $0.5 per account. Can we negotiate to $0.4 or $0.45? Also, I need a quick test batch of 1-2 accounts first.";
      }
      if (isPriceAcceptable) {
        return "Your rate looks good! Can we do a quick test batch of 1-2 accounts first to verify login quality? If everything is clean, we can go ahead with a bulk purchase via USDT/Binance Pay.";
      }
      if (/^(hi|hello|hallo|hey|yo)\b/i.test(cleanText) || cleanText.length < 5) {
        return "Hello! Do you have aged Gmail (2000-2025) for sale? What are your rates and stock size?";
      }
      if (/(what rate|price|how much|rate|cost|how many)/i.test(cleanText)) {
        return "I'm looking for aged Gmail (2000-2025) in bulk, target price under $0.5 per account. Let me know your rate.";
      }
      if (/(no|can't|cannot|don't|not free|buy|pay|\$|usd|vnd|transfer|scam)/i.test(cleanText)) {
        return "Sorry, but I strictly need a 1-2 account free test batch first to verify login quality before any payment. Let me know if you can do that.";
      }
      return "I'm looking for aged Gmail (2000-2025) in bulk. Can you do a test batch of 1-2 accounts first to check quality?";
    }
  } else {
    if (isVietnamese) {
      if (isPriceTooHigh) {
        return "Giá hơi cao so với bên em bác ơi. Có giảm thêm cho sll sỉ không bác? Ib em test thử 1-2 acc trước nhé.";
      }
      if (/(giá|gia|sao|nhiêu|nhiu|rate|price|how much)/i.test(cleanText)) {
        return "Cần mua Gmail cổ (2000-2025) sll, rate dưới 12k. Có acc test không bác? Ib em nhé.";
      }
      return "Bác có Gmail cổ (2000-2025) không? Cho em xin giá sll với ib test thử 1-2 acc nhé.";
    } else {
      if (isPriceTooHigh) {
        return "That rate is a bit high for my budget. Can we do $0.4 or $0.45 for bulk? Please PM me for a quick test batch first.";
      }
      if (/(what rate|price|how much|rate|cost)/i.test(cleanText)) {
        return "Looking for aged Gmail (2000-2025) in bulk, rate under $0.5. Got a test batch?";
      }
      return "Got aged Gmail (2000-2025)? What is your bulk rate? Need to check a small test batch of 1-2 accounts first. DM me.";
    }
  }
}

async function handleIncoming({ accountId, client, message }) {
  const sourceType = getSourceType(message || {});
  const isPrivate = sourceType === "private";
  const release = await aiProcessMutex.acquire(isPrivate);
  try {
    return await handleIncomingInternal({ accountId, client, message });
  } finally {
    release();
  }
}

async function handleIncomingInternal({ accountId, client, message }) {
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
    if (isToxicOrAbusive(text))
      return { status: "ignored", reason: "toxic_or_abusive" };

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

    // Chỉ trả lời tối đa 3 lần cho mỗi khách trong một nhóm mỗi ngày (reset hàng ngày)
    if (sourceType === "group" && senderId) {
      const sentCount = await AiLeadQueue.countSentByChatSender(accountId, chatId, senderId);
      if (sentCount >= 3) {
        if (activeSeenKey) seenMessages.delete(activeSeenKey);
        return { status: "ignored", reason: "max_group_replies_exceeded" };
      }
    }


    const chatTitle = getChatTitle(message);
    const senderName = getSenderName(message);
    console.log("[AILead] Generating reply plan:", { accountId, chatId, msgId, sourceType, senderId, senderName, textPreview: text.slice(0, 160) });

    const historyRows = await AiLeadQueue.findRecentConversationByChat(accountId, chatId, 8, sourceType === "group" ? senderId : null);
    const messagePurpose = getEngagementPurpose(settings, accountId, chatId, topicId);
    const decision = await askAi({
      settings,
      text,
      chatTitle,
      senderName,
      sourceType,
      isFollowUp,
      purpose: messagePurpose,
      historyRows,
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
        : Number(settings.aiLeadMinScore || 80);
    const returnIgnored = async (reason, skipDetail) => {
      await saveSkippedLead(accountId, message, text, decision, score, riskScore, skipDetail);
      if (sourceType === "private" && activeSeenKey) seenMessages.delete(activeSeenKey);
      return { status: "ignored", reason, decision: { category, score, riskScore, minScore, reason: decision.reason || "" } };
    };

    if (sourceType === "private" && !decision.reply) return await returnIgnored("empty_reply", "Phản hồi từ AI rỗng");
    if (sourceType !== "private" && !decision.should_reply) return await returnIgnored("ai_rejected_should_reply_false", "AI từ chối (should_reply = false) - " + (decision.reason || ""));
    if (sourceType !== "private" && score < minScore) return await returnIgnored("ai_rejected_score_below_min", `Điểm thấp (${score} < ${minScore}) - ` + (decision.reason || ""));
    if (sourceType !== "private" && riskScore > 75 && category !== "admin_review" && category !== "blocked_topic") return await returnIgnored("ai_rejected_risk_too_high", `Rủi ro cao (${riskScore} > 75) - ` + (decision.reason || ""));

    const reply = sanitizeReply(decision.reply, {
      allowLinks: sourceType === "private",
      preserveFormatting: sourceType === "private",
      contextText: text,
      privateRaw: sourceType === "private",
    });

    let finalReply = reply;
    const isRefusal = /can['’]t help (buy|source|trade|verify|with)|cannot help|I am an AI|as an AI|legitimate email|Google Workspace|email deliverability/i.test(reply);
    if (isRefusal) {
      console.log("[AILead Safety Interceptor] Detected safety refusal from LLM, replacing with human fallback.");
      finalReply = getFallbackReply(text, sourceType, historyRows);
      decision.reply = finalReply;
    }

    if (!finalReply || finalReply.length < 3) return await returnIgnored("empty_reply", "Phản hồi rỗng hoặc quá ngắn");
    if (sourceType === "group" && (isGenericTemplateReply(finalReply) || isOverPoliteBotToneReply(finalReply))) return await returnIgnored("generic_template_reply", "Phản hồi chung chung hoặc mang giọng điệu AI Bot");
    if (sourceType === "group" && isPromotionPurpose(messagePurpose) && mentionsPublicPromotionBrand(finalReply)) return await returnIgnored("brand_mention_in_soft_promo", "Phản hồi chứa thương hiệu quảng bá công cộng");
    if (sourceType === "group" && isBuyerStyleReply(finalReply)) return await returnIgnored("buyer_style_reply", "Phản hồi mang phong cách người mua");
    if (sourceType === "group" && (await hasRecentSimilarReply(accountId, chatId, finalReply))) return await returnIgnored("duplicate_reply", "Phản hồi bị trùng lặp hoặc tương đồng");

    const item = await queueDecision({ accountId, message, text, decision, sourceType, isFollowUp, followUpToQueueId: previous?._id || "" });
    logAiLeadSelectedReply(item, decision, finalReply, { accountId, chatId, msgId, sourceType, senderName, text });
    logReplyCandidate(item, decision, "single");

    if (settings.aiLeadMode !== "auto") {
      notifyApproval(item, forceAdminApproval ? "Admin approval required for blocked/sensitive topic" : "");
      return { status: "queued", item };
    }

    if (sourceType === "private") {
      console.log(
        `[AILead Realtime] Tin nhắn riêng (Private) -> Tự động gửi câu trả lời sau 30 giây. ID=${item._id}`
      );
      setTimeout(async () => {
        try {
          await sendPending(item._id, { source: "auto_queue" });
        } catch (err) {
          console.error(
            `[AILead Realtime] Lỗi khi trả lời tin nhắn riêng tự động:`,
            err.message
          );
        }
      }, 30000);
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

async function saveSkippedLead(accountId, message, text, decision, score, riskScore, skipReason) {
  try {
    const chatId = getChatId(message);
    const msgId = message.id?.toString?.() || String(message.id || "");
    const sourceType = getSourceType(message || {});

    // Check if already exists to avoid duplicating skipped logs
    const existing = await AiLeadQueue.findByMessage(accountId, chatId, msgId);
    if (existing) return;

    await AiLeadQueue.create({
      status: "skipped",
      accountId,
      chatId,
      messageId: msgId,
      senderId: getSenderId(message),
      senderName: getSenderName(message),
      chatTitle: getChatTitle(message),
      sourceType,
      category: decision.category || "ignore",
      score,
      riskScore,
      reason: skipReason,
      originalText: text,
      suggestedReply: sanitizeReply(decision.reply || "", {
        allowLinks: sourceType === "private",
        preserveFormatting: sourceType === "private",
        contextText: text,
        privateRaw: sourceType === "private",
      }),
      skippedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[AILead] Failed to save skipped lead:", err.message);
  }
}

async function processBufferedGroupMessages({ items = [], reason = "manual" } = {}) {
  const release = await aiProcessMutex.acquire(false);
  try {
    return await processBufferedGroupMessagesInternal({ items, reason });
  } finally {
    release();
  }
}

async function processBufferedGroupMessagesInternal({ items = [], reason = "manual" } = {}) {
  const settings = await GlobalSetting.findOne({ type: "global_app_settings" });
  const summary = { success: true, reason, received: items.length, eligible: 0, queued: 0, sent: 0, ignored: 0, ignoredReasons: {}, ignoredSamples: {}, errors: [] };

  if (!settings?.openaiApiKey || !settings.aiLeadEnabled) {
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

    // Chỉ trả lời tối đa 3 lần cho mỗi khách trong một nhóm mỗi ngày (reset hàng ngày)
    if (senderId) {
      const sentCount = await AiLeadQueue.countSentByChatSender(accountId, chatId, senderId);
      if (sentCount >= 3) {
        ignore("max_group_replies_exceeded");
        continue;
      }
    }
    if (!chatId || !msgId) { ignore("missing_ids"); continue; }
    if (!isEngagementTargetAllowed(settings, accountId, chatId, topicId)) { ignore("target_not_allowed"); continue; }
    const seenKey = `${accountId}:${chatId}:${msgId}`;
    if (seenMessages.has(seenKey)) { ignore("seen"); continue; }
    if (await AiLeadQueue.findByMessage(accountId, chatId, msgId)) { ignore("already_queued"); continue; }
    if (senderId && (await isBlacklisted(accountId, senderId))) { ignore("blacklisted_group_user"); continue; }

    const fingerprint = normalizeMessageFingerprint(text);
    const senderKey = `${accountId}:${senderId}`;
    if (!fingerprint || seenFingerprints.has(fingerprint) || (senderId && seenSenderKeys.has(senderKey))) { ignore("duplicate"); continue; }

    seenMessages.add(seenKey);
    if (seenMessages.size > 5000) seenMessages.clear();
    seenFingerprints.add(fingerprint);
    if (senderId) seenSenderKeys.add(senderKey);

    const batchId = compact.length + 1;
    const historyRows = await AiLeadQueue.findRecentConversationByChat(accountId, chatId, 4, senderId).catch(() => []);
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
    { role: "system", content: `${settings.aiLeadPrompt}\n\n${playbook}\n\nYou are scanning a buffered real-time Telegram feed across multiple groups, topics, and accounts. Each input item has a unique batch_id and purpose. Use recent_context for that account/chat before deciding, so follow-ups remain coherent. Select up to 5 good safe candidates per batch when the chat has enough openings.

Mandatory Sourcing Focus (Gmail Only): You must strictly only reply to messages where the sender is offering, selling, or supplying Gmail accounts (specifically aged Gmails). If they are offering or discussing other products/services (like other social accounts, proxies, game keys, Discord tokens, V-Bucks, or posting application support/general questions), you must ignore them completely (set should_reply = false and category = "ignore"). Do not attempt to reply to general chatter, general questions, or support requests in the group.

You are strictly an experienced bulk Gmail buyer. Responses must be 1-3 lines max. Keep it simple and clear. You must always explicitly write "aged Gmail (2000-2025)" or "old Gmail (2000-2025)" in your responses. Never just say "accounts" or "stock" generally. Invite them to contact you in DMs/PMs.
All generated replies must be in English. No direct links, no @mentions, no brand names. Never self-identify as a bot, AI, automation, tool, script, or seeding account. Avoid using em-dashes (—).\n\nReturn JSON only: {"candidates":[{"batch_id":number,"should_reply":boolean,"category":"direct_lead|soft_opportunity|general_engagement|bulk_buying|admin_review|blocked_topic|ignore","score":0-100,"risk_score":0-100,"reason":"short","reply":"natural English reply without links"}]}` },
    { role: "user", content: `Buffered messages JSON:\n${JSON.stringify(compact)}` },
  ], { temperature: 0.4, maxTokens: 1800, sessionPrefix: "ai-lead-buffered-group", timeoutMs: 0, validateJson: validateBufferedBatchDecisionJson });

  const minScore = Number(settings.aiLeadMinScore || 80);
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

    if (!decision.should_reply) {
      await saveSkippedLead(accountId, message, text, decision, score, riskScore, "AI từ chối (should_reply = false) - " + (decision.reason || ""));
      ignore("ai_rejected_should_reply_false", aiRejectSample);
      continue;
    }
    if (score < minScore) {
      await saveSkippedLead(accountId, message, text, decision, score, riskScore, `Điểm thấp (${score} < ${minScore}) - ` + (decision.reason || ""));
      ignore("ai_rejected_score_below_min", aiRejectSample);
      continue;
    }
    if (riskScore > 75 && category !== "admin_review" && category !== "blocked_topic") {
      await saveSkippedLead(accountId, message, text, decision, score, riskScore, `Rủi ro cao (${riskScore} > 75) - ` + (decision.reason || ""));
      ignore("ai_rejected_risk_too_high", aiRejectSample);
      continue;
    }
    if (!reply || reply.length < 3) {
      await saveSkippedLead(accountId, message, text, decision, score, riskScore, "Phản hồi rỗng hoặc quá ngắn");
      ignore("empty_reply");
      continue;
    }
    const replyFingerprint = normalizeReplyFingerprint(reply);
    const replyOpening = getReplyOpening(reply);
    if (isGenericTemplateReply(reply) || isOverPoliteBotToneReply(reply)) {
      await saveSkippedLead(accountId, message, text, decision, score, riskScore, "Phản hồi chung chung hoặc mang giọng điệu AI Bot");
      ignore("generic_template_reply");
      continue;
    }
    if (isPromotionPurpose(row?.purpose) && mentionsPublicPromotionBrand(reply)) {
      await saveSkippedLead(accountId, message, text, decision, score, riskScore, "Phản hồi chứa thương hiệu quảng bá công cộng");
      ignore("promotion_brand_mention_reply", aiRejectSample);
      continue;
    }
    if (isBuyerStyleReply(reply)) {
      await saveSkippedLead(accountId, message, text, decision, score, riskScore, isPromotionPurpose(row?.purpose) ? "Phản hồi mang phong cách người mua (ở nhóm quảng bá)" : "Phản hồi mang phong cách người mua");
      ignore(isPromotionPurpose(row?.purpose) ? "promotion_buyer_style_reply" : "buyer_style_reply", aiRejectSample);
      continue;
    }
    if ((replyFingerprint && batchReplyFingerprints.has(replyFingerprint)) || (replyOpening && batchReplyOpenings.has(replyOpening)) || (await hasRecentSimilarReply(accountId, chatId, reply))) {
      await saveSkippedLead(accountId, message, text, decision, score, riskScore, "Phản hồi bị trùng lặp hoặc tương đồng");
      ignore("duplicate_reply");
      continue;
    }
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

async function deletePending(id) {
  const current = await AiLeadQueue.findById(id);
  const wasAutoQueued = isAutoQueuedItem(current);
  await AiLeadQueue.delete(id);
  if (wasAutoQueued) {
    const settings = (await GlobalSetting.findOne({ type: "global_app_settings" })) || new GlobalSetting();
    const groupKey = current.sourceType === "private" ? `${current.accountId}:private` : `${current.accountId}:${current.chatId}`;
    await scheduleGroupAutoSend(groupKey, settings).catch(() => {});
  }
  return { success: true };
}

async function clearQueue(status = null) {
  await AiLeadQueue.clear(status);
  return { success: true };
}

setTimeout(async () => {
  try {
    await startAutoSendQueue();
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
  deletePending,
  clearQueue,
  scanEngagementGroup,
  processBufferedGroupMessages,
  startAutoSendQueue,
  scanUnreadPrivateMessages,
  getBlacklist,
  getBlacklistPaged,
  removeFromBlacklist,
};
