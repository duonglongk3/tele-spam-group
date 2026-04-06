const telegramService = require('./telegramService');
const PostLog = require('./models/PostLog');
const PostCampaign = require('./models/PostCampaign');
const { notifyAdmin } = require('./botService');
const cron = require('node-cron');

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
                const globalSchedule = parseSchedule(camp.schedule);
                const accountIds = camp.accounts && camp.accounts.length > 0 ? camp.accounts : [];
                let needsSave = false;

                for (const accId of accountIds) {
                    for (const target of camp.targets) {
                        if (target.isDisabled) continue;
                        const targetKey = `${camp._id}:${target.chatId}:${target.topicId || '0'}:${accId}`;
                        activeTargetKeys.add(targetKey);

                        let sched = globalSchedule;
                        if (target.scheduleType === 'random' && target.customSchedule) {
                            sched = parseSchedule(target.customSchedule) || globalSchedule;
                        } else if (target.scheduleType === 'fixed' && target.customSchedule) {
                            sched = parseSchedule(target.customSchedule) || globalSchedule;
                        }

                        if (!sched) continue;

                        if (!target.nextRunAt) {
                            if (sched.type === 'fixed') {
                                target.nextRunAt = getNextFixedTime(sched.times, new Date());
                                console.log(`[AutoPost] Initialized FIXED schedule for ${target.name} at ${target.nextRunAt}`);
                                needsSave = true;
                                this.nextRunTimes.set(targetKey, target.nextRunAt.getTime());
                            } else if (sched.type === 'random') {
                                // First run init dispatcher to prevent Spikes
                                const targetIndex = camp.targets.findIndex(t => t.chatId === target.chatId && t.topicId === target.topicId);
                                if (camp.firstRunMode === 'immediate' || !camp.firstRunMode) {
                                    // Spread immediately with 2 mins interval
                                    target.nextRunAt = new Date(Date.now() + (targetIndex * 2 * 60000));
                                    console.log(`[AutoPost] Initialized IMMEDIATE spike-guard for ${target.name} in ${targetIndex * 2} mins.`);
                                } else {
                                    // Scatter completely randomly following schedule bounds
                                    const delayMinutes = Math.floor(Math.random() * (sched.max - sched.min + 1)) + sched.min;
                                    target.nextRunAt = new Date(Date.now() + delayMinutes * 60000);
                                    console.log(`[AutoPost] Initialized RANDOM schedule for ${target.name} in ${delayMinutes} mins.`);
                                }
                                needsSave = true;
                                this.nextRunTimes.set(targetKey, target.nextRunAt.getTime());
                            }
                        }

                        // Persistent schedule check via DB target.nextRunAt
                        let nextRunTimestamp = target.nextRunAt.getTime();

                        if (Date.now() >= nextRunTimestamp) {
                            // Time to execute (includes missed runs!)
                            
                            // Spike Guard: Delay execution if multiple missed
                            setTimeout(() => {
                                this.executeJob(camp, target, accId, targetKey).catch(() => {});
                            }, executionDelayOffset);
                            executionDelayOffset += 4000; // Add 4 seconds delay for the NEXT immediate job
                            
                            // Schedule next execution
                            if (sched.type === 'fixed') {
                                target.nextRunAt = getNextFixedTime(sched.times, new Date());
                                console.log(`[AutoPost] Scheduled next FIXED post for ${target.name} at ${target.nextRunAt}`);
                            } else if (sched.type === 'random') {
                                const rangeMin = sched.min;
                                const rangeMax = sched.max;
                                const delayMinutes = Math.floor(Math.random() * (rangeMax - rangeMin + 1)) + rangeMin;
                                target.nextRunAt = new Date(Date.now() + delayMinutes * 60 * 1000);
                                console.log(`[AutoPost] Scheduled next RANDOM post for ${target.name} in ${delayMinutes} mins.`);
                            }
                            needsSave = true;
                            
                            // Update memory map too for UI progress rendering
                            this.nextRunTimes.set(targetKey, target.nextRunAt.getTime());
                        } else if (!this.nextRunTimes.has(targetKey)) {
                            // Keep memory map populated for UI progress if not executing yet
                            this.nextRunTimes.set(targetKey, nextRunTimestamp);
                        }
                    }
                }
                
                if (needsSave) {
                    await camp.save(); // Sync the new nextRunAt to MongoDB persistently
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
        
        try {
            const res = await telegramService.withAccount(accountId, async (client) => {
                let sentIds = [];
                const toEntity = await client.getEntity(target.chatId);
                const resArray = await client.forwardMessages(toEntity, {
                    messages: source.messageIds,
                    fromPeer: await client.getEntity(source.fromChatId)
                });
                // Trích xuất list msg ID gửi thành công
                if (Array.isArray(resArray)) resArray.forEach(m => { if(m&&m.id) sentIds.push(m.id) });
                else if (resArray && resArray.id) sentIds.push(resArray.id);

                return { success: true, sentIds };
            });

            await this.logAction({ ...logBase, status: 'success', sentMessageIds: res.sentIds });
        } catch (err) {
            const errMsg = err.message || '';
            await this.logAction({ ...logBase, status: 'fail', errorMessage: errMsg });
            
            // Auto Disable on fatal restrictions
            if (errMsg.includes('CHAT_SEND_WEBPAGE_FORBIDDEN') || errMsg.includes('ALLOW_PAYMENT_REQUIRED')) {
                console.log(`[AutoPost] Auto-disabling target ${target.name} due to fatal restriction.`);
                target.isDisabled = true;
                target.lastError = errMsg.includes('CHAT_SEND_WEBPAGE_FORBIDDEN') ? 'CHAT_SEND_WEBPAGE_FORBIDDEN' : 'ALLOW_PAYMENT_REQUIRED';
                await campaign.save();
                
                notifyAdmin(`⚠️ *CẢNH BÁO AUTO POST*\nChiến dịch: [${campaign.name}]\nTarget: ${target.name}\nLỗi trầm trọng: \`${target.lastError}\`\n👉 Đã cấu hình TỰ ĐỘNG BLOCK mục tiêu này!`);
            }
        }
    }

    async executePost(campaign, target, accountId) {
        let finalMessage = '';
        let currentParseMode = 'md';
        
        if (campaign.type === 'quote') {
            const spunQuote = spinContent(campaign.quoteText || '');
            const spunText = spinContent(campaign.contentTemplate || '');
            // Sử dụng HTML parseMode và thẻ blockquote cho Quote
            finalMessage = `<blockquote>${escapeHtml(spunQuote)}</blockquote>\n${escapeHtml(spunText)}`;
            currentParseMode = 'html';
        } else {
            finalMessage = spinContent(campaign.contentTemplate);
        }
        
        const logBase = { campaign, accountId, target, action: 'post', contentPreview: finalMessage };

        try {
            const res = await telegramService.withAccount(accountId, async (client) => {
                let sentIds = [];
                const entity = await client.getEntity(target.chatId);
                
                if (campaign.imagePaths && campaign.imagePaths.length > 0) {
                    const resMsg = await client.sendFile(entity, {
                        file: campaign.imagePaths,
                        caption: finalMessage,
                        replyTo: target.topicId || undefined,
                        parseMode: currentParseMode,
                    });
                    if (Array.isArray(resMsg)) resMsg.forEach(m => { if(m&&m.id) sentIds.push(m.id) });
                    else if (resMsg && resMsg.id) sentIds.push(resMsg.id);
                } else {
                    const resMsg = await client.sendMessage(entity, {
                        message: finalMessage,
                        replyTo: target.topicId || undefined,
                        linkPreview: false,
                        parseMode: currentParseMode,
                    });
                    if (resMsg && resMsg.id) sentIds.push(resMsg.id);
                }
                return { success: true, sentIds };
            });

            await this.logAction({ ...logBase, status: 'success', sentMessageIds: res.sentIds });
        } catch (err) {
            const errMsg = err.message || '';
            await this.logAction({ ...logBase, status: 'fail', errorMessage: errMsg });
            
            if (errMsg.includes('CHAT_SEND_WEBPAGE_FORBIDDEN') || errMsg.includes('ALLOW_PAYMENT_REQUIRED')) {
                console.log(`[AutoPost] Auto-disabling target ${target.name} due to fatal restriction.`);
                target.isDisabled = true;
                target.lastError = errMsg.includes('CHAT_SEND_WEBPAGE_FORBIDDEN') ? 'CHAT_SEND_WEBPAGE_FORBIDDEN' : 'ALLOW_PAYMENT_REQUIRED';
                await campaign.save();
                
                notifyAdmin(`⚠️ *CẢNH BÁO AUTO POST*\nChiến dịch: [${campaign.name}]\nTarget: ${target.name}\nLỗi trầm trọng: \`${target.lastError}\`\n👉 Đã cấu hình TỰ ĐỘNG BLOCK mục tiêu này!`);
            }
        }
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
