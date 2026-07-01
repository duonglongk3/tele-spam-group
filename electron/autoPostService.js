const telegramService = require('./telegramService');
const PostLog = require('./models/PostLog');
const PostCampaign = require('./models/PostCampaign');
const { notifyAdmin, getBot } = require('./botService');
const cron = require('node-cron');
const { Button } = require('telegram/tl/custom/button');
const { createChatCompletion } = require('./aiClient');
const GlobalSetting = require('./models/Setting');

async function rewriteTextWithAI(text, settings) {
  if (!settings?.openaiApiKey || !text) return text;
  try {
    const result = await createChatCompletion(
      settings,
      [
        {
          role: 'system',
          content: 'You rewrite Telegram sales or marketing posts in English. Keep the original meaning, preserve emojis, URLs, @mentions, spin syntax, and Telegram HTML tags exactly when present. You may improve Telegram HTML parse formatting when useful using only supported tags such as <b>, <i>, <u>, <s>, <code>, <pre>, <blockquote>, <a href="https://...">, <tg-spoiler>, and <tg-emoji emoji-id="...">. Return only the rewritten post text, no markdown fences or extra commentary.',
        },
        {
          role: 'user',
          content: text,
        },
      ],
      { temperature: 0.8, maxTokens: 1200, sessionPrefix: 'auto-post-rewrite' },
    );

    const rewritten = result.content?.trim();
    if (rewritten) {
      console.log(`[AI-Rewrite] Successfully rewrote content with ${result.model}.`);
      return rewritten;
    }
  } catch (err) {
    console.error('[AI-Rewrite] Error:', err.message);
  }
  return text;
}

async function generateAutoPostContentDraft(payload = {}) {
  const settings = await GlobalSetting.findOne({ type: 'global_app_settings' });
  if (!settings?.openaiApiKey) {
    throw new Error('Thiếu AI API Key trong Settings.');
  }

  const action = payload.action || 'rewrite';
  const content = String(payload.content || '').trim();
  const actionPrompts = {
    rewrite: 'Rewrite the provided Telegram post from the existing content. Keep the same meaning, offers, URLs, @mentions, emojis, and important details. Improve clarity, conversion, and natural wording.',
    new: 'Write a completely new Telegram post based on the provided content. Keep the same core product, offer, URLs, @mentions, and constraints, but use a new structure and fresh wording.',
    spin: 'Create a full semantic spin-text version using {A|B|C}. Preserve every Telegram HTML tag exactly, especially <tg-emoji ...> tags, and spin only human-readable text around them. Add multiple meaningful alternatives to titles, hooks, feature descriptions, CTAs, and hashtags. Every option inside each brace must fit grammatically with every surrounding sentence so any generated combination reads naturally and preserves the full meaning. The output must clearly differ from the source and must contain many spin groups.',
    html: 'Convert or improve the provided content for Telegram HTML parse mode. Add formatting only where useful and preserve meaning, URLs, @mentions, and emojis.',
  };

  if (!actionPrompts[action]) {
    throw new Error('AI action không hợp lệ.');
  }
  if (!content) {
    throw new Error('Vui lòng nhập content trước khi dùng AI.');
  }

  const result = await createChatCompletion(
    settings,
    [
      {
        role: 'system',
        content: 'You are an expert Telegram content editor. Return only the final Telegram post text, no explanation and no markdown fences. The output must be ready for Telegram HTML parse mode. You may use Telegram-supported HTML tags: <b>, <strong>, <i>, <em>, <u>, <ins>, <s>, <strike>, <del>, <code>, <pre>, <blockquote>, <a href="https://...">text</a>, <tg-spoiler>, and <tg-emoji emoji-id="...">emoji</tg-emoji>. Do not invent unsupported tags. Preserve existing <tg-emoji ...>...</tg-emoji> tags exactly. Keep links and @mentions intact unless asked to rewrite wording around them.',
      },
      {
        role: 'user',
        content: `${actionPrompts[action]}\n\nSource content:\n${content}`,
      },
    ],
    { temperature: action === 'spin' ? 0.75 : 0.85, maxTokens: action === 'spin' ? 6000 : 3000, sessionPrefix: `auto-post-${action}`, timeoutMs: 0 },
  );

  const generated = String(result.content || '').trim().replace(/^```(?:html|text)?\s*/i, '').replace(/```$/i, '').trim();
  if (!generated) throw new Error('AI không trả về nội dung.');
  return { success: true, content: generated, model: result.model };
}

function obfuscateLinks(text) {
  if (!text) return text;
  
  // 1. Convert markdown links: [Label](http://domain.com/path) -> Label (domain[.]com/path)
  let processed = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (match, label, url) => {
    const cleanUrl = url.replace(/^https?:\/\/(www\.)?/, '');
    const obfuscatedUrl = cleanUrl.replace(/\./g, '[.]');
    return `${label} (${obfuscatedUrl})`;
  });

  // 2. Convert raw links: https://buffortune.com/products -> buffortune[.]com/products
  processed = processed.replace(/(https?:\/\/)?(www\.)?([a-zA-Z0-9-]+\.[a-zA-Z]{2,})(\/[^\s]*)?/gi, (match, protocol, www, domain, path) => {
    // Skip if already has [.] or (dot) or [dot] or space/braces in it
    if (domain.includes('[') || domain.includes('(') || domain.includes(' ') || domain.includes(']')) {
      return match;
    }
    const formats = [
      domain.replace(/\./g, '[.]'),
      domain.replace(/\./g, ' (dot) '),
      domain.replace(/\./g, '[dot]')
    ];
    const obfuscatedDomain = formats[Math.floor(Math.random() * formats.length)];
    const p = path && path !== '/' ? path : '';
    return `${obfuscatedDomain}${p}`;
  });

  return processed;
}


function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/[&<>"']/g, (m) => {
    switch (m) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return m;
    }
  });
}

function spinContent(text) {
  if (!text) return text;
  return text.replace(/\{([^{}]+)\}/g, (match, group) => {
    const variants = group.split('|').map(s => s.trim()).filter(Boolean);
    if (variants.length === 0) return match;
    return variants[Math.floor(Math.random() * variants.length)];
  });
}

function parseSchedule(scheduleStr) {
    if (!scheduleStr) return null;
    if (scheduleStr.includes('-')) {
        const [min, max] = scheduleStr.split('-').map(Number);
        if (isNaN(min) || isNaN(max)) return null;
        return { type: 'random', min, max };
    }
    if (scheduleStr.includes(':')) {
        const times = scheduleStr.split(',').map(s => s.trim());
        return { type: 'fixed', times };
    }
    const val = Number(scheduleStr);
    if (!isNaN(val)) return { type: 'random', min: val, max: val };
    return null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function getNextFixedTime(timesArr, referenceDate = new Date()) {
    const sorted = [...timesArr].sort();
    const now = referenceDate;
    const currentH = now.getHours();
    const currentM = now.getMinutes();

    for (let timeStr of sorted) {
        let [h, m] = timeStr.split(':').map(Number);
        if (h > currentH || (h === currentH && m > currentM)) {
            let next = new Date(now);
            next.setHours(h, m, 0, 0);
            return next;
        }
    }
    // Next day
    let [h, m] = sorted[0].split(':').map(Number);
    let next = new Date(now);
    next.setDate(now.getDate() + 1);
    next.setHours(h, m, 0, 0);
    return next;
}

function toValidDate(value) {
    if (!value) return null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getInputFileFromMessage(message) {
    if (!message?.media) return null;
    if (message.media.photo) {
        return message.media.photo;
    }
    if (message.media.document) {
        return message.media.document;
    }
    return null;
}

function buildReplyMarkup(actionButtons = []) {
    const validButtons = actionButtons
        .filter((button) => button?.text && button?.url)
        .slice(0, 2);

    if (validButtons.length === 0) {
        return undefined;
    }

    return [validButtons.map((button) => Button.url(button.text, button.url))];
}

function appendActionLinks(text, actionButtons = [], parseMode = 'md') {
    const validButtons = actionButtons
        .filter((button) => button?.text && button?.url)
        .slice(0, 2);

    if (validButtons.length === 0) {
        return text;
    }

    const suffix = parseMode === 'html'
        ? validButtons.map((button) => `<a href="${escapeHtml(button.url)}">${escapeHtml(button.text)}</a>`).join(' | ')
        : validButtons.map((button) => `[${button.text}](${button.url})`).join(' | ');

    return `${text}\n\n${suffix}`;
}

function appendObfuscatedActionLinks(text, actionButtons = []) {
    const validButtons = actionButtons
        .filter((button) => button?.text && button?.url)
        .slice(0, 2);

    if (validButtons.length === 0) {
        return text;
    }

    const suffix = validButtons.map((button) => {
        const obfuscatedUrl = obfuscateLinks(button.url);
        return `${button.text}: ${obfuscatedUrl}`;
    }).join(' | ');

    return `${text}\n\n${suffix}`;
}

function getDelayMins(delayStr) {
    if (typeof delayStr === 'number') return Math.max(1, delayStr);
    if (typeof delayStr === 'string' && delayStr.includes('-')) {
        const [min, max] = delayStr.split('-').map(Number);
        if (!isNaN(min) && !isNaN(max) && max >= min) {
            return Math.floor(Math.random() * (max - min + 1)) + min;
        }
    }
    const val = Number(delayStr);
    return !isNaN(val) && val > 0 ? val : 5;
}

function getTargetScheduleValue(campaign, target) {
    if (target?.scheduleType === 'random' || target?.scheduleType === 'fixed') {
        return target.customSchedule || campaign.delayBetweenPosts;
    }
    return campaign.delayBetweenPosts;
}

function getNextTargetRunAt(campaign, target, referenceDate = new Date()) {
    const scheduleValue = getTargetScheduleValue(campaign, target);
    const parsed = parseSchedule(scheduleValue);

    if (target?.scheduleType === 'fixed' && parsed?.type === 'fixed') {
        return getNextFixedTime(parsed.times, referenceDate);
    }

    if (target?.scheduleType === 'fixed' && parsed?.type !== 'fixed') {
        return new Date(referenceDate.getTime() + getDelayMins(campaign.delayBetweenPosts) * 60000);
    }

    return new Date(referenceDate.getTime() + getDelayMins(scheduleValue) * 60000);
}

function getInitialTargetRunAt(campaign, target, referenceDate = new Date()) {
    if (campaign.firstRunMode === 'random') {
        return getNextTargetRunAt(campaign, target, referenceDate);
    }
    return new Date(referenceDate.getTime());
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getTelegramErrorMessage(err) {
    return err?.message || String(err || '');
}

function isPhotoSendForbiddenError(err) {
    const message = getTelegramErrorMessage(err);
    return message.includes('CHAT_SEND_PHOTOS_FORBIDDEN')
        || message.includes('PHOTO_SEND_FORBIDDEN')
        || message.includes('CHAT_SEND_MEDIA_FORBIDDEN');
}

function isTemporaryAntiRaidError(err) {
    const message = getTelegramErrorMessage(err);
    return /(?:FLOOD_WAIT|FLOOD_PREMIUM_WAIT|SLOWMODE_WAIT)_\d+/.test(message)
        || message.includes('PEER_FLOOD')
        || message.includes('USER_RESTRICTED');
}

function parseTelegramSafetyError(err) {
    const message = err?.message || String(err || '');
    const flood = message.match(/(?:FLOOD_WAIT|FLOOD_PREMIUM_WAIT)_(\d+)/);
    if (flood) {
        return {
            type: 'flood',
            seconds: Math.max(Number(flood[1]) || 60, 60),
            fatal: false,
            message,
        };
    }

    const slowmode = message.match(/SLOWMODE_WAIT_(\d+)/);
    if (slowmode) {
        return {
            type: 'slowmode',
            seconds: Math.max(Number(slowmode[1]) || 30, 30),
            fatal: false,
            message,
        };
    }

    if (message.includes('PEER_FLOOD') || message.includes('USER_RESTRICTED')) {
        return {
            type: 'account_pause',
            seconds: 6 * 60 * 60,
            fatal: false,
            message,
        };
    }

    if (
        message.includes('USER_BANNED_IN_CHANNEL') ||
        message.includes('CHAT_WRITE_FORBIDDEN') ||
        message.includes('CHAT_SEND_PLAIN_FORBIDDEN') ||
        message.includes('CHAT_SEND_MEDIA_FORBIDDEN') ||
        message.includes('CHAT_ADMIN_REQUIRED') ||
        message.includes('CHANNEL_PRIVATE')
    ) {
        return {
            type: 'target_disable',
            seconds: 0,
            fatal: true,
            message,
        };
    }

    return null;
}

class AutoPostManager {
    constructor() {
        this.timers = new Map(); // key: targetKey (campaignId:targetId:accountId)
        this.nextRunTimes = new Map();
        this.cronJob = null;
        this.queue = [];
        this.queueKeys = new Set();
        this.dispatcherRunning = false;
        this.accountCooldowns = new Map();
        this.targetCooldowns = new Map();
    }

    start() {
        console.log('[AutoPost] Starting scheduler...');
        this.cronJob = cron.schedule('* * * * *', () => {
            this.syncAndRun();
        });
        this.syncAndRun(); // run immediately
    }

    stop() {
        if (this.cronJob) this.cronJob.stop();
        for (let [key, timer] of this.timers) clearTimeout(timer);
        this.timers.clear();
        this.nextRunTimes.clear();
        console.log('[AutoPost] Scheduler stopped.');
    }

    async syncAndRun() {
        try {
            const activeCampaigns = await PostCampaign.find({ isRunning: true });
            const activeTargetKeys = new Set();
            let executionDelayOffset = 0;

            for (const camp of activeCampaigns) {
                const maxPosts = (typeof camp.maxPostsPerDay === 'number' && camp.maxPostsPerDay > 0) ? camp.maxPostsPerDay : 3;
                let needsSave = false;
                const validTargets = camp.targets.filter(t => !t.isDisabled);
                if (validTargets.length === 0) continue;

                const now = new Date();
                for (const target of validTargets) {
                    const accId = target.accountId || (camp.accounts && camp.accounts.length > 0 ? camp.accounts[0] : 'bot');
                    const targetKey = `${camp._id}:${target.chatId}:${target.topicId || '0'}:${accId}`;
                    activeTargetKeys.add(targetKey);

                    const currentRunAt = toValidDate(target.nextRunAt);
                    if (!currentRunAt) {
                        if (camp.firstRunMode === 'random') {
                            target.nextRunAt = getNextTargetRunAt(camp, target, now);
                        } else {
                            target.nextRunAt = new Date(now.getTime() + executionDelayOffset);
                            executionDelayOffset += 60_000;
                        }
                        needsSave = true;
                        this.nextRunTimes.set(targetKey, new Date(target.nextRunAt).getTime());
                        continue;
                    }

                    if (currentRunAt.getTime() <= now.getTime() + 5000) {
                        const todayStr = now.toISOString().split('T')[0];
                        if (target.dailySentDate !== todayStr) {
                            target.dailySentCount = 0;
                            target.dailySentDate = todayStr;
                            needsSave = true;
                        }

                        if (target.dailySentCount >= maxPosts) {
                            const tomorrow = new Date(now);
                            tomorrow.setDate(tomorrow.getDate() + 1);
                            tomorrow.setHours(0, 0, 0, 0);
                            target.nextRunAt = getNextTargetRunAt(camp, target, tomorrow);
                            needsSave = true;
                            console.log(`[AutoPost] Target ${target.name} reached daily limit (${maxPosts}). Scheduled independently at ${target.nextRunAt}`);
                        } else {
                            this.enqueueJob(camp, target, accId, targetKey, executionDelayOffset);
                            executionDelayOffset += 60_000;
                            target.dailySentCount++;
                            target.nextRunAt = getNextTargetRunAt(camp, target, now);
                            needsSave = true;
                            console.log(`[AutoPost] Scheduled independent next post for ${target.name} at ${target.nextRunAt} (Sent today: ${target.dailySentCount}/${maxPosts})`);
                        }
                    }

                    this.nextRunTimes.set(targetKey, new Date(target.nextRunAt).getTime());
                }

                if (needsSave) {
                    await camp.save();
                }
            }

            for (const key of this.nextRunTimes.keys()) {
                if (!activeTargetKeys.has(key)) {
                    this.nextRunTimes.delete(key);
                }
            }
        } catch (err) {
            console.error('[AutoPost] Cron loop errored:', err);
        }
    }

    enqueueJob(campaign, target, accountId, targetKey, delayMs = 0) {
        if (this.queueKeys.has(targetKey)) return;
        this.queueKeys.add(targetKey);
        this.queue.push({
            campaign,
            target,
            accountId,
            targetKey,
            availableAt: Date.now() + Math.max(0, delayMs),
        });
        this.runDispatcher().catch((err) => {
            console.error('[AutoPost] Dispatcher errored:', err);
        });
    }

    async runDispatcher() {
        if (this.dispatcherRunning) return;
        this.dispatcherRunning = true;

        try {
            while (this.queue.length > 0) {
                this.queue.sort((a, b) => a.availableAt - b.availableAt);
                const job = this.queue.shift();
                const waitMs = Math.max(0, job.availableAt - Date.now());
                if (waitMs > 0) await sleep(waitMs);

                this.queueKeys.delete(job.targetKey);
                const cooldownUntil = this.getCooldownUntil(job.accountId, job.targetKey);
                if (cooldownUntil > Date.now()) {
                    job.availableAt = cooldownUntil + getRandomInt(15_000, 45_000);
                    this.enqueueJob(job.campaign, job.target, job.accountId, job.targetKey, job.availableAt - Date.now());
                    continue;
                }

                await sleep(getRandomInt(15_000, 45_000));
                await this.executeJob(job.campaign, job.target, job.accountId, job.targetKey).catch(() => {});
            }
        } finally {
            this.dispatcherRunning = false;
            if (this.queue.length > 0) {
                this.runDispatcher().catch((err) => console.error('[AutoPost] Dispatcher restart errored:', err));
            }
        }
    }

    getCooldownUntil(accountId, targetKey) {
        return Math.max(
            this.accountCooldowns.get(accountId) || 0,
            this.targetCooldowns.get(targetKey) || 0,
        );
    }

    async applySafetyError(err, campaign, target, accountId, targetKey) {
        const safety = parseTelegramSafetyError(err);
        if (!safety) return false;

        const until = Date.now() + safety.seconds * 1000;
        if (safety.type === 'flood' || safety.type === 'account_pause') {
            this.accountCooldowns.set(accountId, until);
        }
        if (safety.type === 'slowmode') {
            this.targetCooldowns.set(targetKey, until);
        }
        if (safety.type === 'target_disable') {
            target.isDisabled = true;
            target.lastError = safety.message.substring(0, 180);
        } else {
            target.nextRunAt = new Date(until + getRandomInt(60_000, 180_000));
            target.lastError = safety.message.substring(0, 180);
        }

        await campaign.save();

        const resumeAt = safety.seconds > 0 ? new Date(until).toLocaleString('vi-VN') : 'đã dừng';
        notifyAdmin(`⚠️ *CẢNH BÁO AN TOÀN TELEGRAM*\nChiến dịch: [${campaign.name}]\nTarget: ${target.name}\nLỗi: \`${target.lastError}\`\nHành động: ${safety.type === 'target_disable' ? 'Tắt target' : `Tạm dừng đến ${resumeAt}`}`);
        return true;
    }

    /* 
    async runAutoDelete() {
        // Removed as per user request to keep posts for traffic
    }
    */

    async executeJob(campaign, target, accountId, targetKey) {
        console.log(`[AutoPost] Executing job for ${target.name} (Camp: ${campaign.name})`);
        
        // Anti-spam delay (0 to 5 seconds per job start)
        const delayMs = Math.floor(Math.random() * 5000);
        await sleep(delayMs);

        if (campaign.type === 'forward' && campaign.forwardSource) {
            await this.executeForward(campaign, target, accountId, targetKey);
        } else {
            await this.executePost(campaign, target, accountId, targetKey);
        }
    }

    async executeForTarget(campaign, target, accountId) {
        const beforeCount = await PostLog.countDocuments({ campaignId: campaign._id });

        if (campaign.type === 'forward' && campaign.forwardSource) {
            await this.executeForward(campaign, target, accountId);
        } else {
            await this.executePost(campaign, target, accountId);
        }

        const logs = await PostLog.find({ campaignId: campaign._id }).lean();
        logs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const newLogs = logs.filter((log) => log.targetId === (target.chatId || '')).slice(0, Math.max(1, logs.length - beforeCount));
        const latestLog = newLogs[0] || logs.find((log) => log.targetId === (target.chatId || ''));

        return latestLog || { status: 'success', sentMessageIds: [] };
    }

    async logAction({ campaign, accountId, target, action, status, contentPreview, errorMessage, sentMessageIds = [] }) {
        try {
            let postLinks = [];
            if (status === 'success' && sentMessageIds.length > 0 && target.chatId) {
                const cleanId = target.chatId.toString().replace('-100', '');
                postLinks = sentMessageIds.map(id => {
                    if (target.topicId) {
                        return `https://t.me/c/${cleanId}/${target.topicId}/${id}`;
                    }
                    return `https://t.me/c/${cleanId}/${id}`;
                });
            }

            await PostLog.create({
                campaignId: campaign._id,
                campaignName: campaign.name || '',
                accountId,
                accountName: accountId,
                targetId: target.chatId || '',
                targetName: (target.topicName ? `${target.name || ''} > ${target.topicName}` : (target.name || '')) + ` (ID: ${target.chatId})`,
                targetLink: target.chatId,
                action: action || 'post',
                status,
                contentPreview: contentPreview ? contentPreview.substring(0, 200) : '',
                sentMessageIds,
                postLinks,
                errorMessage: errorMessage || '',
            });
        } catch (err) {
            console.error('[AutoPost] logAction DB error:', err.message);
        }
    }

    async executeForward(campaign, target, accountId, targetKey = null) {
        targetKey = targetKey || `${campaign._id}:${target.chatId}:${target.topicId || '0'}:${accountId}`;
        const source = campaign.forwardSource;
        if (!source || !source.fromChatId || !source.messageIds || source.messageIds.length === 0) return;

        const logBase = { campaign, accountId, target, action: 'forward', contentPreview: `Forward from ${source.fromChatId} / MsgId: ${source.messageIds.join(',')}` };
        const sourceAccountId = source.accountId || accountId;
        
        try {
            const res = await telegramService.withAccount(sourceAccountId, async (client) => {
                let sentIds = [];
                const toEntity = await telegramService.resolveEntity(client, target.chatId);
                
                // Anti-Spam: simulate reading group history
                await telegramService.simulateHumanActivity(client, toEntity);
                await sleep(1000 + Math.random() * 1500);

                const fromEntity = await telegramService.resolveEntity(client, source.fromChatId);
                const resArray = await client.forwardMessages(toEntity, {
                    messages: source.messageIds,
                    fromPeer: fromEntity
                });
                // Trích xuất list msg ID gửi thành công
                if (Array.isArray(resArray)) resArray.forEach(m => { if(m&&m.id) sentIds.push(m.id) });
                else if (resArray && resArray.id) sentIds.push(resArray.id);

                return { success: true, sentIds };
            });

            console.log(`[AutoPost] Forward success for ${target.name}: ${res.sentIds.join(', ') || 'no message id returned'}`);
            await this.logAction({ ...logBase, status: 'success', sentMessageIds: res.sentIds });
        } catch (err) {
            const errMsg = err.message || '';
            console.error(`[AutoPost] Forward failed for ${target.name}:`, err);

            if (errMsg.includes('CHAT_ADMIN_REQUIRED') || errMsg.includes('USER_BANNED_IN_CHANNEL') || errMsg.includes('CHAT_FORWARDS_RESTRICTED')) {
                try {
                    const resent = await telegramService.withAccount(sourceAccountId, async (client) => {
                        const fromEntity = await telegramService.resolveEntity(client, source.fromChatId);
                        const toEntity = await telegramService.resolveEntity(client, target.chatId);
                        const messages = await client.getMessages(fromEntity, { ids: source.messageIds });
                        const sentIds = [];

                        for (const message of messages) {
                            if (!message) continue;

                            let text = message.message || '';
                            const file = getInputFileFromMessage(message);
                            let resMsg;

                            // Apply AI Rewrite if enabled in fallback
                            if (campaign.useAI) {
                                try {
                                    const s = await GlobalSetting.findOne({ type: 'global_app_settings' });
                                    if (s && s.openaiApiKey) {
                                        console.log(`[AutoPost] Requesting Fallback AI rewrite for campaign: ${campaign.name}`);
                                        text = await rewriteTextWithAI(text, s);
                                    }
                                } catch (aiErr) {
                                    console.error(`[AutoPost] Fallback AI Rewrite error:`, aiErr.message);
                                }
                            }

                            // Apply Link Obfuscation in fallback
                            let shouldObfuscateFallback = !!campaign.obfuscateLinks;
                            if (!shouldObfuscateFallback && toEntity) {
                                try {
                                    let rights = toEntity.defaultBannedRights;
                                    if (!rights && (toEntity.className === 'Channel' || toEntity.megagroup)) {
                                        const { Api } = require('telegram/tl');
                                        const fullChannel = await client.invoke(new Api.channels.GetFullChannel({ channel: toEntity }));
                                        if (fullChannel && fullChannel.chats && fullChannel.chats.length > 0) {
                                            rights = fullChannel.chats[0].defaultBannedRights;
                                        }
                                    }
                                    if (rights && (rights.embedLinks || rights.sendInline)) {
                                        shouldObfuscateFallback = true;
                                        console.log(`[AutoPost] Forward fallback: target ${target.name} restricts links/inline bots dynamically. Enabling obfuscation.`);
                                    }
                                } catch (e) {
                                    console.error('[AutoPost] Forward fallback dynamic rights check failed:', e.message);
                                }
                            }

                            if (shouldObfuscateFallback) {
                                text = obfuscateLinks(text);
                            }

                            // Anti-Spam: simulate reading group history
                            await telegramService.simulateHumanActivity(client, toEntity);
                            await sleep(1000 + Math.random() * 1000);

                            // Anti-Spam: simulate typing status
                            await telegramService.simulateTyping(client, toEntity, file ? 'photo' : 'text');

                            if (file) {
                                resMsg = await client.sendFile(toEntity, {
                                    file,
                                    caption: text,
                                    replyTo: target.topicId || undefined,
                                });
                            } else {
                                resMsg = await client.sendMessage(toEntity, {
                                    message: text,
                                    replyTo: target.topicId || undefined,
                                    linkPreview: false,
                                });
                            }

                            if (Array.isArray(resMsg)) resMsg.forEach(m => { if (m && m.id) sentIds.push(m.id) });
                            else if (resMsg && resMsg.id) sentIds.push(resMsg.id);
                        }

                        return { sentIds };
                    });

                    console.log(`[AutoPost] Forward fallback resend success for ${target.name}: ${resent.sentIds.join(', ') || 'no message id returned'}`);
                    await this.logAction({ ...logBase, status: 'success', sentMessageIds: resent.sentIds });
                    return;
                } catch (fallbackErr) {
                    console.error(`[AutoPost] Forward fallback resend failed for ${target.name}:`, fallbackErr);
                }
            }

            await this.logAction({ ...logBase, status: 'fail', errorMessage: errMsg });
            if (await this.applySafetyError(err, campaign, target, accountId, targetKey)) {
                throw err;
            }
            
            // Auto Disable on fatal restrictions
            if (errMsg.includes('CHAT_SEND_WEBPAGE_FORBIDDEN') || errMsg.includes('ALLOW_PAYMENT_REQUIRED') || errMsg.includes('USER_BANNED_IN_CHANNEL')) {
                console.log(`[AutoPost] Auto-disabling target ${target.name} due to fatal restriction.`);
                target.isDisabled = true;
                target.lastError = errMsg.includes('CHAT_SEND_WEBPAGE_FORBIDDEN') ? 'CHAT_SEND_WEBPAGE_FORBIDDEN' : errMsg.includes('ALLOW_PAYMENT_REQUIRED') ? 'ALLOW_PAYMENT_REQUIRED' : 'USER_BANNED_IN_CHANNEL';
                await campaign.save();
                
                notifyAdmin(`⚠️ *CẢNH BÁO AUTO POST*\nChiến dịch: [${campaign.name}]\nTarget: ${target.name}\nLỗi trầm trọng: \`${target.lastError}\`\n👉 Đã cấu hình TỰ ĐỘNG BLOCK mục tiêu này!`);
            }
            throw err;
        }
    }

    async executePost(campaign, target, accountId, targetKey = null) {
        targetKey = targetKey || `${campaign._id}:${target.chatId}:${target.topicId || '0'}:${accountId}`;
        // Find a client to perform dynamic permission check if needed
        let clientToCheck = null;
        if (accountId && accountId !== 'bot') {
            clientToCheck = telegramService.clients.get(accountId);
        }
        if (!clientToCheck && telegramService.clients.size > 0) {
            clientToCheck = telegramService.clients.values().next().value;
        }

        let shouldObfuscate = !!campaign.obfuscateLinks;
        if (!shouldObfuscate && clientToCheck) {
            try {
                const entity = await telegramService.resolveEntity(clientToCheck, target.chatId);
                let rights = entity.defaultBannedRights;
                if (!rights && (entity.className === 'Channel' || entity.megagroup)) {
                    const { Api } = require('telegram/tl');
                    const fullChannel = await clientToCheck.invoke(new Api.channels.GetFullChannel({ channel: entity }));
                    if (fullChannel && fullChannel.chats && fullChannel.chats.length > 0) {
                        rights = fullChannel.chats[0].defaultBannedRights;
                    }
                }
                if (rights) {
                    if (rights.embedLinks || rights.sendInline) {
                        shouldObfuscate = true;
                        console.log(`[AutoPost] Target ${target.name} restricts links/inline bots dynamically. Enabling obfuscation.`);
                    }
                }
            } catch (err) {
                console.error(`[AutoPost] Dynamic permission check failed for ${target.name}:`, err.message);
            }
        }

        let finalMessage = '';
        let currentParseMode = 'html';
        
        let quote = campaign.quoteText || '';
        let content = campaign.contentTemplate || '';

        if (shouldObfuscate) {
            quote = obfuscateLinks(quote);
            content = obfuscateLinks(content);
        }

        if (campaign.type === 'quote') {
            const spunQuote = spinContent(quote);
            const spunText = spinContent(content);
            // Sử dụng HTML parseMode và thẻ blockquote cho Quote
            finalMessage = `<blockquote>${spunQuote}</blockquote>\n${spunText}`;
            currentParseMode = 'html';
        } else {
            finalMessage = spinContent(content);
        }

        // Apply AI Rewrite if enabled
        if (campaign.useAI) {
            try {
                const s = await GlobalSetting.findOne({ type: 'global_app_settings' });
                if (s && s.openaiApiKey) {
                    console.log(`[AutoPost] Requesting AI rewrite for campaign: ${campaign.name}`);
                    finalMessage = await rewriteTextWithAI(finalMessage, s);
                } else {
                    console.warn(`[AutoPost] AI Rewrite is enabled but openaiApiKey is not configured in settings.`);
                }
            } catch (aiErr) {
                console.error(`[AutoPost] AI Rewrite error:`, aiErr.message);
            }
        }

        let messageForDelivery = '';
        let replyMarkup = undefined;

        if (shouldObfuscate) {
            messageForDelivery = appendObfuscatedActionLinks(finalMessage, campaign.actionButtons);
            replyMarkup = undefined;
        } else {
            const messageWithActionLinks = appendActionLinks(finalMessage, campaign.actionButtons, currentParseMode);
            messageForDelivery = campaign.sendViaBot ? finalMessage : messageWithActionLinks;
            replyMarkup = buildReplyMarkup(campaign.actionButtons);
        }
        
        const logBase = { campaign, accountId, target, action: 'post', contentPreview: messageForDelivery };

        try {
            if (campaign.sendViaBot) {
                const bot = getBot();
                if (!bot) {
                    throw new Error('BOT_NOT_INITIALIZED');
                }

                let resMsg;
                const extra = {
                    parse_mode: currentParseMode === 'html' ? 'HTML' : 'Markdown',
                    reply_markup: replyMarkup ? { inline_keyboard: (campaign.actionButtons || []).filter((button) => button?.text && button?.url).slice(0, 2).map((button) => [{ text: button.text, url: button.url }]) } : undefined,
                    disable_web_page_preview: true,
                    message_thread_id: target.topicId || undefined,
                };

                const shouldSendPhoto = campaign.imagePaths && campaign.imagePaths.length > 0 && !target.photoFallbackOnly;
                if (shouldSendPhoto) {
                    try {
                        resMsg = await bot.telegram.sendPhoto(target.chatId, campaign.imagePaths[0], {
                            caption: messageForDelivery,
                            ...extra,
                        });
                    } catch (photoErr) {
                        if (!isPhotoSendForbiddenError(photoErr) || isTemporaryAntiRaidError(photoErr)) throw photoErr;
                        target.photoFallbackOnly = true;
                        target.nextRunAt = new Date(Date.now() + getRandomInt(10 * 60_000, 20 * 60_000));
                        target.lastError = getTelegramErrorMessage(photoErr).substring(0, 180);
                        await campaign.save();
                        throw new Error(`PHOTO_FORBIDDEN_TEXT_FALLBACK_DELAYED: ${target.lastError}`);
                    }
                } else {
                    resMsg = await bot.telegram.sendMessage(target.chatId, messageForDelivery, extra);
                }

                const sentIds = resMsg?.message_id ? [resMsg.message_id] : [];
                if (sentIds.length === 0) {
                    throw new Error('BOT_SEND_RETURNED_NO_MESSAGE_ID');
                }
                console.log(`[AutoPost] Bot send success for ${target.name}: ${sentIds.join(', ')}`);
                await this.logAction({ ...logBase, status: 'success', sentMessageIds: sentIds });
                return;
            }

            const res = await telegramService.withAccount(accountId, async (client) => {
                let sentIds = [];
                const entity = await telegramService.resolveEntity(client, target.chatId);
                
                // Anti-Spam: simulate reading group history
                await telegramService.simulateHumanActivity(client, entity);
                await sleep(1000 + Math.random() * 1000);

                // Anti-Spam: simulate typing status
                const isPhoto = campaign.imagePaths && campaign.imagePaths.length > 0 && !target.photoFallbackOnly;
                await telegramService.simulateTyping(client, entity, isPhoto ? 'photo' : 'text');

                if (isPhoto) {
                    try {
                        const resMsg = await client.sendFile(entity, {
                            file: campaign.imagePaths,
                            caption: messageForDelivery,
                            replyTo: target.topicId || undefined,
                            parseMode: currentParseMode,
                            buttons: replyMarkup,
                        });
                        if (Array.isArray(resMsg)) resMsg.forEach(m => { if(m&&m.id) sentIds.push(m.id) });
                        else if (resMsg && resMsg.id) sentIds.push(resMsg.id);
                    } catch (photoErr) {
                        if (!isPhotoSendForbiddenError(photoErr) || isTemporaryAntiRaidError(photoErr)) throw photoErr;
                        target.photoFallbackOnly = true;
                        target.nextRunAt = new Date(Date.now() + getRandomInt(10 * 60_000, 20 * 60_000));
                        target.lastError = getTelegramErrorMessage(photoErr).substring(0, 180);
                        await campaign.save();
                        throw new Error(`PHOTO_FORBIDDEN_TEXT_FALLBACK_DELAYED: ${target.lastError}`);
                    }
                } else {
                    const resMsg = await client.sendMessage(entity, {
                        message: messageForDelivery,
                        replyTo: target.topicId || undefined,
                        linkPreview: false,
                        parseMode: currentParseMode,
                        buttons: replyMarkup,
                    });
                    if (resMsg && resMsg.id) sentIds.push(resMsg.id);
                }
                return { success: true, sentIds };
            });

            if (!Array.isArray(res.sentIds) || res.sentIds.length === 0) {
                throw new Error('USER_SEND_RETURNED_NO_MESSAGE_ID');
            }
            console.log(`[AutoPost] User send success for ${target.name}: ${res.sentIds.join(', ')}`);
            await this.logAction({ ...logBase, status: 'success', sentMessageIds: res.sentIds });
        } catch (err) {
            const errMsg = err.message || '';
            await this.logAction({ ...logBase, status: 'fail', errorMessage: errMsg });
            if (errMsg.includes('PHOTO_FORBIDDEN_TEXT_FALLBACK_DELAYED')) {
                notifyAdmin(`⚠️ *AUTO POST CHUYỂN SANG TEXT*\nChiến dịch: [${campaign.name}]\nTarget: ${target.name}\nLỗi gửi ảnh: \`${target.lastError}\`\n👉 Không gửi text ngay để tránh anti-raid. Sẽ thử lại bằng text sau 10-20 phút.`);
                return;
            }
            if (await this.applySafetyError(err, campaign, target, accountId, targetKey)) {
                throw err;
            }
            
            if (errMsg.includes('CHAT_SEND_WEBPAGE_FORBIDDEN') || errMsg.includes('ALLOW_PAYMENT_REQUIRED') || errMsg.includes('USER_BANNED_IN_CHANNEL')) {
                console.log(`[AutoPost] Auto-disabling target ${target.name} due to fatal restriction.`);
                target.isDisabled = true;
                target.lastError = errMsg.includes('CHAT_SEND_WEBPAGE_FORBIDDEN') ? 'CHAT_SEND_WEBPAGE_FORBIDDEN' : errMsg.includes('ALLOW_PAYMENT_REQUIRED') ? 'ALLOW_PAYMENT_REQUIRED' : 'USER_BANNED_IN_CHANNEL';
                await campaign.save();
                
                notifyAdmin(`⚠️ *CẢNH BÁO AUTO POST*\nChiến dịch: [${campaign.name}]\nTarget: ${target.name}\nLỗi trầm trọng: \`${target.lastError}\`\n👉 Đã cấu hình TỰ ĐỘNG BLOCK mục tiêu này!`);
            }
            throw err;
        }
    }

    async sendNow(payload) {
        const campaign = {
            _id: 'send-now',
            name: payload.name || 'Send now',
            type: payload.type || 'text',
            forwardSource: payload.forwardSource || null,
            quoteText: payload.quoteText || '',
            contentTemplate: payload.contentTemplate || '',
            imagePaths: Array.isArray(payload.imagePaths) ? payload.imagePaths : [],
            actionButtons: Array.isArray(payload.actionButtons) ? payload.actionButtons : [],
            sendViaBot: !!payload.sendViaBot,
            useAI: !!payload.useAI,
            obfuscateLinks: !!payload.obfuscateLinks,
        };

        const target = {
            chatId: payload.target?.chatId,
            name: payload.target?.name || payload.target?.chatId || 'Target',
            topicId: payload.target?.topicId || undefined,
        };

        const beforeLogs = await PostLog.find({ campaignId: campaign._id }).lean();
        const beforeLogIds = new Set(beforeLogs.map((log) => log._id));

        try {
            const accountId = payload.accountId || 'bot';
            const runner = campaign.type === 'forward' && campaign.forwardSource
                ? this.executeForward.bind(this)
                : this.executePost.bind(this);
            await runner(campaign, target, accountId);
        } catch (err) {
            return {
                success: false,
                error: err.message || 'SEND_NOW_FAILED',
            };
        }

        const logs = await PostLog.find({ campaignId: campaign._id }).lean();
        logs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const latestLog = logs.find((log) => log.targetId === (target.chatId || '') && !beforeLogIds.has(log._id))
            || logs.find((log) => log.targetId === (target.chatId || ''));

        if (latestLog?.status === 'fail') {
            return {
                success: false,
                error: latestLog.errorMessage || 'SEND_NOW_FAILED',
            };
        }

        if (!latestLog || latestLog.status !== 'success' || !Array.isArray(latestLog.sentMessageIds) || latestLog.sentMessageIds.length === 0) {
            return {
                success: false,
                error: 'SEND_NOW_NO_DELIVERY_CONFIRMATION',
            };
        }

        return {
            success: true,
            sentMessageIds: latestLog?.sentMessageIds || [],
        };
    }

    async generateAutoPostContent(payload) {
        return generateAutoPostContentDraft(payload);
    }

    getProgress() {
        const progress = [];
        for (const [key, nextRun] of this.nextRunTimes.entries()) {
            const parts = key.split(':');
            if (parts.length >= 4) {
                const [campaignId, chatId, topicId, accountId] = parts;
                progress.push({
                    campaignId,
                    chatId,
                    topicId,
                    accountId,
                    nextRunAt: nextRun
                });
            }
        }
        return progress;
    }
}

module.exports = new AutoPostManager();

