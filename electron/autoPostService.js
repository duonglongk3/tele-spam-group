const telegramService = require('./telegramService');
const PostLog = require('./models/PostLog');
const PostCampaign = require('./models/PostCampaign');
const { notifyAdmin, getBot } = require('./botService');
const cron = require('node-cron');
const { Button } = require('telegram/tl/custom/button');
const axios = require('axios');

async function rewriteTextWithAI(text, apiKey) {
  if (!apiKey || !text) return text;
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Bạn là trợ lý giúp viết lại nội dung bài đăng bán hàng/marketing để tránh bộ lọc spam của mạng xã hội. Hãy viết lại nội dung được cung cấp bằng tiếng Việt sao cho khác đi nhưng giữ nguyên ý nghĩa, giữ nguyên các icon/emoji, và đặc biệt là giữ nguyên các liên kết (URL) và thẻ tag (@username) nếu có. Hãy phản hồi CHỈ bằng nội dung đã viết lại, không thêm lời chào, không thêm phần giải thích hay đóng khung.'
          },
          {
            role: 'user',
            content: text
          }
        ],
        temperature: 0.8
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );
    const result = response.data?.choices?.[0]?.message?.content?.trim();
    if (result) {
      console.log(`[AI-Rewrite] Successfully rewrote content.`);
      return result;
    }
  } catch (err) {
    console.error(`[AI-Rewrite] Error:`, err.response?.data || err.message);
  }
  return text;
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

class AutoPostManager {
    constructor() {
        this.timers = new Map(); // key: targetKey (campaignId:targetId:accountId)
        this.nextRunTimes = new Map();
        this.cronJob = null;
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
            let executionDelayOffset = 0; // Spike guard for missed targets

            for (const camp of activeCampaigns) {
                const maxPosts = (typeof camp.maxPostsPerDay === 'number' && camp.maxPostsPerDay > 0) ? camp.maxPostsPerDay : 3;
                let needsSave = false;

                const validTargets = camp.targets.filter(t => !t.isDisabled);
                if (validTargets.length === 0) continue;

                // 1. Heal and sort the belt
                validTargets.sort((a, b) => {
                    const timeA = a.nextRunAt ? new Date(a.nextRunAt).getTime() : 0;
                    const timeB = b.nextRunAt ? new Date(b.nextRunAt).getTime() : 0;
                    return timeA - timeB;
                });

                let beltTime = Date.now();
                for (const t of validTargets) {
                    const currentRunTime = t.nextRunAt ? new Date(t.nextRunAt).getTime() : 0;
                    if (currentRunTime < beltTime) {
                        t.nextRunAt = new Date(beltTime);
                        needsSave = true;
                    }
                    beltTime = new Date(t.nextRunAt).getTime() + (getDelayMins(camp.delayBetweenPosts) * 60000);
                }

                // 2. Execute & Slide
                for (const target of validTargets) {
                    const accId = target.accountId || (camp.accounts && camp.accounts.length > 0 ? camp.accounts[0] : 'bot');
                    const targetKey = `${camp._id}:${target.chatId}:${target.topicId || '0'}:${accId}`;
                    activeTargetKeys.add(targetKey);

                    // Allow 5-second drift
                    if (new Date(target.nextRunAt).getTime() <= Date.now() + 5000) {
                        // Check daily limits
                        const todayStr = new Date().toISOString().split('T')[0];
                        if (target.dailySentDate !== todayStr) {
                            target.dailySentCount = 0;
                            target.dailySentDate = todayStr;
                            needsSave = true;
                        }

                        if (target.dailySentCount >= maxPosts) {
                            // Hit limit, schedule for tomorrow
                            const tomorrow = new Date();
                            tomorrow.setDate(tomorrow.getDate() + 1);
                            tomorrow.setHours(0, 0, 0, 0);

                            let maxTomorrow = tomorrow.getTime();
                            for (const o of validTargets) {
                                if (o !== target && o.nextRunAt) {
                                    const oTime = new Date(o.nextRunAt).getTime();
                                    if (oTime >= tomorrow.getTime()) {
                                        maxTomorrow = Math.max(maxTomorrow, oTime);
                                    }
                                }
                            }
                            target.nextRunAt = new Date(maxTomorrow + getDelayMins(camp.delayBetweenPosts) * 60000);
                            needsSave = true;
                            console.log(`[AutoPost] Target ${target.name} reached daily limit (${maxPosts}). Scheduled tomorrow at ${target.nextRunAt}`);
                        } else {
                            // Execute Job
                            setTimeout(() => {
                                this.executeJob(camp, target, accId, targetKey).catch(() => {});
                            }, executionDelayOffset);
                            executionDelayOffset += 4000;
                            
                            target.dailySentCount++;
                            needsSave = true;

                            // Re-append to back of TODAY's belt
                            let maxToday = Date.now();
                            const todayEnd = new Date();
                            todayEnd.setHours(23, 59, 59, 999);

                            for (const o of validTargets) {
                                if (o !== target && o.nextRunAt) {
                                    const oTime = new Date(o.nextRunAt).getTime();
                                    if (oTime <= todayEnd.getTime()) {
                                        maxToday = Math.max(maxToday, oTime);
                                    }
                                }
                            }
                            target.nextRunAt = new Date(maxToday + getDelayMins(camp.delayBetweenPosts) * 60000);
                            console.log(`[AutoPost] Scheduled next post for ${target.name} at ${target.nextRunAt} (Sent today: ${target.dailySentCount}/${maxPosts})`);
                        }
                    }

                    this.nextRunTimes.set(targetKey, new Date(target.nextRunAt).getTime());
                }

                if (needsSave) {
                    await camp.save(); 
                }
            }

            // Cleanup inactive targets
            for (const key of this.nextRunTimes.keys()) {
                if (!activeTargetKeys.has(key)) {
                    this.nextRunTimes.delete(key);
                }
            }

        } catch (err) {
            console.error('[AutoPost] Cron loop errored:', err);
        }
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
            await this.executeForward(campaign, target, accountId);
        } else {
            await this.executePost(campaign, target, accountId);
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

    async executeForward(campaign, target, accountId) {
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
                                    const GlobalSetting = require('./models/Setting');
                                    const s = await GlobalSetting.findOne({ type: 'global_app_settings' });
                                    if (s && s.openaiApiKey) {
                                        console.log(`[AutoPost] Requesting Fallback AI rewrite for campaign: ${campaign.name}`);
                                        text = await rewriteTextWithAI(text, s.openaiApiKey);
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

    async executePost(campaign, target, accountId) {
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
        let currentParseMode = 'md';
        
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
            finalMessage = `<blockquote>${escapeHtml(spunQuote)}</blockquote>\n${escapeHtml(spunText)}`;
            currentParseMode = 'html';
        } else {
            finalMessage = spinContent(content);
        }

        // Apply AI Rewrite if enabled
        if (campaign.useAI) {
            try {
                const GlobalSetting = require('./models/Setting');
                const s = await GlobalSetting.findOne({ type: 'global_app_settings' });
                if (s && s.openaiApiKey) {
                    console.log(`[AutoPost] Requesting AI rewrite for campaign: ${campaign.name}`);
                    finalMessage = await rewriteTextWithAI(finalMessage, s.openaiApiKey);
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

                if (campaign.imagePaths && campaign.imagePaths.length > 0) {
                    resMsg = await bot.telegram.sendPhoto(target.chatId, campaign.imagePaths[0], {
                        caption: messageForDelivery,
                        ...extra,
                    });
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
                const isPhoto = campaign.imagePaths && campaign.imagePaths.length > 0;
                await telegramService.simulateTyping(client, entity, isPhoto ? 'photo' : 'text');

                if (isPhoto) {
                    const resMsg = await client.sendFile(entity, {
                        file: campaign.imagePaths,
                        caption: messageForDelivery,
                        replyTo: target.topicId || undefined,
                        parseMode: currentParseMode,
                        buttons: replyMarkup,
                    });
                    if (Array.isArray(resMsg)) resMsg.forEach(m => { if(m&&m.id) sentIds.push(m.id) });
                    else if (resMsg && resMsg.id) sentIds.push(resMsg.id);
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
