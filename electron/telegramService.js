const AI_LEAD_GROUP_BUFFER_BATCH_SIZE = 3;
const AI_LEAD_GROUP_FAIR_FLUSH_INTERVAL_MS = 60000;
const AI_LEAD_GROUP_FAIR_FLUSH_FAST_MS = 5000;
const AI_LEAD_GROUP_MAX_PARALLEL_FLUSHES = 5;
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');
const { NewMessage } = require('telegram/events');
const TelegramAccount = require('./models/TelegramAccount');

function getTelegramApiId() {
    return Number(process.env.TELEGRAM_API_ID || 2040);
}

function getTelegramApiHash() {
    return process.env.TELEGRAM_API_HASH || 'b18441a1ff607e10a989891a5462e627';
}

function getClientOptions(overrides = {}) {
    return {
        connectionRetries: 5,
        deviceModel: process.env.TELEGRAM_DEVICE_MODEL || 'Desktop',
        systemVersion: process.env.TELEGRAM_SYSTEM_VERSION || 'Windows 10',
        appVersion: process.env.TELEGRAM_APP_VERSION || 'Telegram Desktop 6.9.3 x64',
        langCode: process.env.TELEGRAM_LANG_CODE || 'en',
        systemLangCode: process.env.TELEGRAM_SYSTEM_LANG_CODE || 'en-US',
        ...overrides,
    };
}

class TelegramMultiClient {
    constructor() {
        this.clients = new Map();   // Map<accountId, TelegramClient>
        this.accounts = new Map();  // Map<accountId, info>
        this.pendingAuth = new Map(); // Map<phone, { client, phoneCodeHash, createdAt }>
        this.loginCooldowns = new Map(); // Map<phone, retryAt>
        this.aiLeadPrivateScanTimer = null;
        this.aiLeadPrivateScanRunning = false;
        this.privateDebounceTimers = new Map();
        this.aiLeadGroupBuffers = new Map();
        this.aiLeadGroupFlushTimers = new Map();
        this.aiLeadGroupFlushRunning = new Set();
        this.aiLeadGroupFairFlushTimer = null;
        this.aiLeadGroupFairFlushDueAt = 0;
        this.aiLeadGroupLastFlushAt = new Map();
    }

    getLoginCooldown(phone) {
        const retryAt = this.loginCooldowns.get(phone) || 0;
        if (retryAt <= Date.now()) {
            this.loginCooldowns.delete(phone);
            return 0;
        }
        return retryAt;
    }

    rememberLoginCooldown(phone, err) {
        const msg = err?.message || String(err || '');
        const flood = msg.match(/(?:FLOOD_WAIT|PHONE_NUMBER_FLOOD|PHONE_PASSWORD_FLOOD)_(\d+)?/);
        if (!flood && !msg.includes('PHONE_NUMBER_FLOOD') && !msg.includes('PHONE_PASSWORD_FLOOD')) return;
        const seconds = Number(flood?.[1]) || 300;
        this.loginCooldowns.set(phone, Date.now() + Math.max(seconds, 60) * 1000);
    }

    async cleanupPendingAuth(phone) {
        const pending = this.pendingAuth.get(phone);
        this.pendingAuth.delete(phone);
        if (pending?.client) {
            try { await pending.client.disconnect(); } catch (_) {}
        }
    }

    registerIncomingHandlers(client, accountId, me) {
        client.addEventHandler(async (event) => {
            try {
                const msg = event.message;
                if (!msg || msg.out) return;

                const isPrivate = msg.isPrivate || msg.peerId?.userId;

                if (isPrivate) {
                    const privateChatId = msg.peerId?.userId?.toString?.() || msg.senderId?.toString?.() || msg.sender?.id?.toString?.() || msg.chatId?.toString?.() || '';
                    if (!privateChatId) {
                        console.log('[AILead] Realtime private message ignored. Reason: missing_private_chat_id', { accountId, messageId: msg.id });
                    } else {
                        const debounceKey = `${accountId}:${privateChatId}`;
                        const existingTimer = this.privateDebounceTimers.get(debounceKey);
                        if (existingTimer) clearTimeout(existingTimer);
                        const timer = setTimeout(() => {
                            this.privateDebounceTimers.delete(debounceKey);
                            this.processPrivateConversation({ accountId, client, chatId: privateChatId })
                                .catch((err) => console.error(`[AILead] Realtime private debounce ${privateChatId} error:`, err.message));
                        }, 60000);
                        this.privateDebounceTimers.set(debounceKey, timer);
                        console.log('[AILead] Realtime private message debounced:', { accountId, chatId: privateChatId, messageId: msg.id, waitMs: 60000 });
                    }
                } else {
                    this.enqueueAiLeadGroupMessage({ accountId, client, message: msg });
                }

                if (msg.mentioned) {
                    const text = msg.message || '[Có đính kèm file/ảnh]';
                    const senderName = msg.sender ? (msg.sender.firstName || msg.sender.username || 'Ai đó') : 'Khách';
                    let groupName = 'Nhóm/Chat Cá Nhân';
                    if (msg.chat && msg.chat.title) groupName = msg.chat.title;

                    let messageLink = '';
                    if (msg.chat && msg.chat.username) {
                        messageLink = `\n👉 Link tin nhắn: https://t.me/${msg.chat.username}/${msg.id}`;
                    } else if (msg.chatId) {
                        let cleanId = msg.chatId.toString().replace('-100', '');
                        messageLink = `\n👉 Link (Private): https://t.me/c/${cleanId}/${msg.id}`;
                    }

                    const alertText = `🚨 Có khách Hú/Reply kìa sếp!\n\n👤 Từ: ${senderName}\n🏢 Group: ${groupName}\n💬 Trạm gửi: ${me.firstName}\n\n📝 Bình luận: "${text}"${messageLink}`;

                    const botService = require('./botService');
                    botService.notifyAdmin(alertText, null);
                }
            } catch(e) { console.error('Inbox Monitor Error:', e); }
        }, new NewMessage({ incoming: true }));
    }

    getAiLeadGroupBufferKey(accountId, message) {
        const chatId = message?.chatId?.toString?.() || message?.peerId?.channelId?.toString?.() || message?.peerId?.chatId?.toString?.() || '';
        return `${accountId}:${chatId || 'unknown'}`;
    }

    getAiLeadGroupBufferOrder(bufferKey, settings) {
        const [accountId, ...chatParts] = String(bufferKey || '').split(':');
        const chatId = chatParts.join(':');
        const normalize = (value) => String(value || '').replace(/^-100/, '');
        const groups = Array.isArray(settings?.aiLeadEngagementGroups) ? settings.aiLeadEngagementGroups : [];
        const idx = groups.findIndex((group) =>
            String(group.accountId) === String(accountId) && normalize(group.chatId) === normalize(chatId)
        );
        return idx >= 0 ? idx : Number.MAX_SAFE_INTEGER;
    }

    takeAiLeadGroupBufferItems(bufferKey) {
        const buffer = this.aiLeadGroupBuffers.get(bufferKey) || [];
        const items = buffer.splice(0, AI_LEAD_GROUP_BUFFER_BATCH_SIZE);
        if (buffer.length > 0) this.aiLeadGroupBuffers.set(bufferKey, buffer);
        else this.aiLeadGroupBuffers.delete(bufferKey);
        return { items, remaining: buffer.length };
    }

    enqueueAiLeadGroupMessage({ accountId, client, message }) {
        if (!message || message.out) return;
        const bufferKey = this.getAiLeadGroupBufferKey(accountId, message);
        const buffer = this.aiLeadGroupBuffers.get(bufferKey) || [];
        buffer.push({ accountId, client, message, queuedAt: Date.now() });
        this.aiLeadGroupBuffers.set(bufferKey, buffer);
        const chat = message.chat || {};
        const sender = message.sender || {};
        const text = (message.message || message.text || '').trim();
        console.log('[AILead] Group message buffered:', {
            accountId,
            chatId: message.chatId?.toString?.() || '',
            chatTitle: chat.title || chat.firstName || chat.username || '',
            chatUsername: chat.username ? `@${chat.username}` : '',
            messageId: message.id,
            senderId: message.senderId?.toString?.() || sender.id?.toString?.() || '',
            senderName: [sender.firstName, sender.lastName].filter(Boolean).join(' ') || sender.title || sender.username || '',
            senderUsername: sender.username ? `@${sender.username}` : '',
            text: text.slice(0, 300),
            buffered: buffer.length,
            bufferKey,
        });

        this.scheduleAiLeadGroupFairFlush(
            buffer.length >= AI_LEAD_GROUP_BUFFER_BATCH_SIZE
                ? 'count_batch_limit'
                : 'timer_60s',
            buffer.length >= AI_LEAD_GROUP_BUFFER_BATCH_SIZE
                ? AI_LEAD_GROUP_FAIR_FLUSH_FAST_MS
                : AI_LEAD_GROUP_FAIR_FLUSH_INTERVAL_MS,
        );
    }

    scheduleAiLeadGroupFairFlush(reason = 'timer_60s', delayMs = AI_LEAD_GROUP_FAIR_FLUSH_INTERVAL_MS) {
        const dueAt = Date.now() + Math.max(0, delayMs);
        if (this.aiLeadGroupFairFlushTimer) {
            if (this.aiLeadGroupFairFlushDueAt && this.aiLeadGroupFairFlushDueAt <= dueAt) return;
            clearTimeout(this.aiLeadGroupFairFlushTimer);
            this.aiLeadGroupFairFlushTimer = null;
        }
        this.aiLeadGroupFairFlushDueAt = dueAt;
        this.aiLeadGroupFairFlushTimer = setTimeout(() => {
            this.aiLeadGroupFairFlushTimer = null;
            this.aiLeadGroupFairFlushDueAt = 0;
            this.flushAiLeadGroupBuffersFair(reason).catch((err) => {
                console.error('[AILead] Group buffer fair flush error:', err.message);
            });
        }, Math.max(0, delayMs));
    }

    async flushAiLeadGroupBuffersFair(reason = 'timer_60s') {
        const settings = await require('./models/Setting').findOne({ type: 'global_app_settings' }).catch(() => null);
        const keys = Array.from(this.aiLeadGroupBuffers.keys())
            .filter((key) => {
                const buffer = this.aiLeadGroupBuffers.get(key) || [];
                return buffer.length > 0 && !this.aiLeadGroupFlushRunning.has(key);
            })
            .sort((a, b) => {
                const orderDiff = this.getAiLeadGroupBufferOrder(a, settings) - this.getAiLeadGroupBufferOrder(b, settings);
                if (orderDiff !== 0) return orderDiff;
                return (this.aiLeadGroupLastFlushAt.get(a) || 0) - (this.aiLeadGroupLastFlushAt.get(b) || 0);
            });

        if (!keys.length) return { success: true, reason, groups: 0, results: [] };

        const selected = [];
        for (const key of keys) {
            this.aiLeadGroupFlushRunning.add(key);
            const { items, remaining } = this.takeAiLeadGroupBufferItems(key);
            if (items.length) {
                selected.push({ key, items, remaining });
            } else {
                this.aiLeadGroupFlushRunning.delete(key);
            }
        }

        const mergedItems = selected.flatMap((entry) => entry.items);
        if (!mergedItems.length) return { success: true, reason, groups: 0, results: [] };

        try {
            const aiLeadService = require('./aiLeadService');
            console.log('[AILead] Fair flushing group buffers:', {
                reason,
                groups: selected.length,
                items: mergedItems.length,
                groupItems: selected.map((entry) => ({ bufferKey: entry.key, items: entry.items.length, remaining: entry.remaining })),
            });
            const result = await aiLeadService.processBufferedGroupMessages({ items: mergedItems, reason: `${reason}_fair_merged` });
            console.log('[AILead] Fair group buffers flushed:', JSON.stringify({ groups: selected.length, ...result }, null, 2));
            const now = Date.now();
            for (const entry of selected) this.aiLeadGroupLastFlushAt.set(entry.key, now);
            return { success: true, reason, groups: selected.length, results: [result] };
        } finally {
            for (const entry of selected) this.aiLeadGroupFlushRunning.delete(entry.key);
            const remainingKeys = Array.from(this.aiLeadGroupBuffers.keys()).filter((key) => {
                const buffer = this.aiLeadGroupBuffers.get(key) || [];
                return buffer.length > 0;
            });
            if (remainingKeys.length > 0) {
                const hasFullBuffer = remainingKeys.some((key) => (this.aiLeadGroupBuffers.get(key) || []).length >= AI_LEAD_GROUP_BUFFER_BATCH_SIZE);
                this.scheduleAiLeadGroupFairFlush(
                    hasFullBuffer ? 'fair_followup_batch_limit' : 'fair_followup_timer',
                    hasFullBuffer ? AI_LEAD_GROUP_FAIR_FLUSH_FAST_MS : AI_LEAD_GROUP_FAIR_FLUSH_INTERVAL_MS,
                );
            }
        }
    }

    async flushAiLeadGroupBuffer(reason = 'manual', bufferKey = '') {
        if (!bufferKey) {
            return this.flushAiLeadGroupBuffersFair(reason);
        }

        if (this.aiLeadGroupFlushRunning.has(bufferKey)) return { success: false, reason: 'already_running', bufferKey };
        const timer = this.aiLeadGroupFlushTimers.get(bufferKey);
        if (timer) {
            clearTimeout(timer);
            this.aiLeadGroupFlushTimers.delete(bufferKey);
        }

        const buffer = this.aiLeadGroupBuffers.get(bufferKey) || [];
        const items = buffer.splice(0, AI_LEAD_GROUP_BUFFER_BATCH_SIZE);
        if (buffer.length > 0) this.aiLeadGroupBuffers.set(bufferKey, buffer);
        else this.aiLeadGroupBuffers.delete(bufferKey);
        if (!items.length) return { success: true, reason: 'empty', bufferKey };

        this.aiLeadGroupFlushRunning.add(bufferKey);
        try {
            const aiLeadService = require('./aiLeadService');
            console.log('[AILead] Flushing group buffer:', { reason, bufferKey, items: items.length, remaining: buffer.length });
            const result = await aiLeadService.processBufferedGroupMessages({ items, reason });
            console.log('[AILead] Group buffer flushed:', JSON.stringify({ bufferKey, ...result }, null, 2));
            this.aiLeadGroupLastFlushAt.set(bufferKey, Date.now());
            return result;
        } finally {
            this.aiLeadGroupFlushRunning.delete(bufferKey);
            const nextBuffer = this.aiLeadGroupBuffers.get(bufferKey) || [];
            if (nextBuffer.length > 0) {
                this.scheduleAiLeadGroupFairFlush(
                    nextBuffer.length >= AI_LEAD_GROUP_BUFFER_BATCH_SIZE
                        ? 'count_batch_limit_followup'
                        : 'timer_60s_followup',
                    nextBuffer.length >= AI_LEAD_GROUP_BUFFER_BATCH_SIZE
                        ? AI_LEAD_GROUP_FAIR_FLUSH_FAST_MS
                        : AI_LEAD_GROUP_FAIR_FLUSH_INTERVAL_MS,
                );
            }
        }
    }
    async checkSelfBannedInChannel(client, chatId) {
        try {
            const channel = await this.resolveEntity(client, chatId);
            const me = await client.getMe();
            const info = await client.invoke(new Api.channels.GetParticipant({
                channel,
                participant: me,
            }));
            const participant = info?.participant;
            const className = participant?.className || '';
            if (className === 'ChannelParticipantBanned' || className === 'ChannelParticipantKicked') {
                return { isBanned: true };
            }
            return { isBanned: false };
        } catch (err) {
            const msg = err?.message || '';
            if (msg.includes('USER_BANNED_IN_CHANNEL')) return { isBanned: true };
            if (msg.includes('USER_NOT_PARTICIPANT')) return { notParticipant: true };
            return { error: msg };
        }
    }

    async simulateHumanActivity(client, peer) {
        try {
            const entity = await this.resolveEntity(client, peer);
            await client.getMessages(entity, { limit: 3 });
            console.log(`[AccountSafety] Warmed entity cache for peer: ${peer}`);
        } catch (e) {
            console.log(`[AccountSafety] warm entity log (non-fatal): ${e.message}`);
        }
    }

    async simulateTyping(client, peer, actionType = 'text') {
        try {
            const entity = await this.resolveEntity(client, peer);
            let action = new Api.SendMessageTypingAction();
            if (actionType === 'photo' || actionType === 'media') {
                action = new Api.SendMessageUploadPhotoAction({ progress: 50 });
            }
            await client.invoke(new Api.messages.SetTyping({
                peer: entity,
                action
            }));
            const delay = 1500 + Math.random() * 2000; // 1.5s to 3.5s delay
            await new Promise(r => setTimeout(r, delay));
            console.log(`[Anti-Spam] Simulated typing for peer: ${peer} (${actionType})`);
        } catch (e) {
            console.log(`[Anti-Spam] simulateTyping log (non-fatal): ${e.message}`);
        }
    }


    /**
     * Resolve a chatId to an entity, trying common ID format variations.
     * Fails fast if entity can't be found — no aggressive retries.
     */
    async resolveEntity(client, chatId) {
        if (!chatId) throw new Error('chatId is required');

        const rawId = chatId.toString().replace(/^-100/, '');
        const numericId = Number(rawId);

        // Try 1: Direct with original chatId
        try {
            return await client.getEntity(chatId);
        } catch (_) {}

        if (!isNaN(numericId)) {
            // Try 2: With -100 prefix (string)
            try {
                return await client.getEntity(`-100${rawId}`);
            } catch (_) {}

            // Try 3: With -100 prefix (BigInt)
            try {
                return await client.getEntity(BigInt(`-100${rawId}`));
            } catch (_) {}

            // Try 4: PeerChannel constructor
            try {
                const peer = new Api.PeerChannel({ channelId: BigInt(rawId) });
                return await client.getEntity(peer);
            } catch (_) {}
        }

        throw new Error(`Could not resolve entity for chatId: ${chatId}. Make sure this account has joined the group/channel.`);
    }

    async init(store) {
        this.store = store; // Keep store ref if needed elsewhere, but mostly obsolete
        try {
            const savedAccounts = await TelegramAccount.find();
            // Không dùng await để block việc render app
            for (const accDoc of savedAccounts) {
                const acc = {
                    id: accDoc.accountId,
                    sessionString: accDoc.sessionString,
                    firstName: accDoc.firstName,
                    lastName: accDoc.lastName,
                    username: accDoc.username,
                    phone: accDoc.phone,
                    about: accDoc.about || '',
                    connected: 'loading'
                };
                this.accounts.set(acc.id, acc);
                this.connectAccount(acc).catch(console.error);
            }
            const GlobalSetting = require("./models/Setting");
            const settings = await GlobalSetting.findOne({ type: "global_app_settings" }).catch(() => null);
            if (settings && settings.aiLeadUserReplyEnabled === true && settings.openaiApiKey) {
                this.startAiLeadPrivateInboxWatcher().catch((err) => console.error('[AILead] Watcher start error:', err.message));
            } else {
                console.log('[AILead] Private inbox watcher is disabled or OpenAI API key is missing. Skipping watcher start.');
            }
        } catch(err) {
            console.error('[TelegramService] DB Init error:', err);
        }
    }

    async connectAccount(account) {
        const session = new StringSession(account.sessionString);
        const client = new TelegramClient(session, getTelegramApiId(), getTelegramApiHash(), getClientOptions());
        client.setLogLevel('none'); // KHÔNG IN LOG RÁC CỦA GRAMJS RA CONSOLE

        try {
            await client.connect();
            // Đợi 1.5s để GramJS hoàn tất đồng bộ thời gian (timeOffset) với máy chủ Telegram
            await new Promise(r => setTimeout(r, 1500));
            
            // Thử lấy thông tin GetMe với cơ chế retry nếu gặp lỗi MSGID_DECREASE_RETRY hoặc 500
            let me;
            let getMeAttempts = 3;
            for (let i = 1; i <= getMeAttempts; i++) {
                try {
                    me = await client.getMe();
                    break;
                } catch (getMeErr) {
                    if ((getMeErr.message?.includes('MSGID_DECREASE_RETRY') || getMeErr.message?.includes('500') || getMeErr.code === 500) && i < getMeAttempts) {
                        console.warn(`[Telegram] getMe attempt ${i} transient failure: ${getMeErr.message}. Retrying in 1s...`);
                        await new Promise(r => setTimeout(r, 1000));
                        continue;
                    }
                    throw getMeErr;
                }
            }

            this.clients.set(account.id, client);
            this.registerIncomingHandlers(client, account.id, me);
            
            let about = '';
            try {
                // Thử GetFullUser với cơ chế retry
                let fullMe;
                for (let i = 1; i <= 3; i++) {
                    try {
                        fullMe = await client.invoke(new Api.users.GetFullUser({ id: 'me' }));
                        break;
                    } catch (fullMeErr) {
                        if ((fullMeErr.message?.includes('MSGID_DECREASE_RETRY') || fullMeErr.message?.includes('500') || fullMeErr.code === 500) && i < 3) {
                            await new Promise(r => setTimeout(r, 1000));
                            continue;
                        }
                        throw fullMeErr;
                    }
                }
                about = fullMe?.fullUser?.about || '';
            } catch (e) {}

            const accInfo = {
                id: account.id,
                sessionString: account.sessionString,
                firstName: me.firstName,
                lastName: me.lastName,
                username: me.username,
                phone: me.phone,
                about: about,
                connected: true,
            };
            this.accounts.set(account.id, accInfo);
            console.log(`[Telegram] Connected: ${me.firstName} (@${me.username})`);
            this._saveAccounts();

            // Pre-populate entity cache in background (non-blocking)
            client.getDialogs({ limit: 500 }).then(() => {
                console.log(`[Telegram] Entity cache populated for ${me.firstName}`);
            }).catch(() => {});

            setTimeout(() => {
                this.scanUnreadPrivateMessages({ accountIds: [account.id], dialogLimit: 100, messageLimit: 5, source: 'startup' })
                    .then((res) => {
                        if (res?.scanned || res?.queued || res?.sent) console.log('[AILead] Startup private unread scan:', res);
                    })
                    .catch((err) => console.error('[AILead] Startup private unread scan error:', err.message));
            }, 5000);

            return accInfo;
        } catch (err) {
            console.error(`[Telegram] Failed to connect ${account.id}:`, err.message);
            this.accounts.set(account.id, { ...account, connected: false, error: err.message });
            return { error: err.message };
        }
    }

    async _saveAccounts() {
        try {
            // Upsert all accounts in memory to SQLite
            for (const account of this.accounts.values()) {
                await TelegramAccount.findOneAndUpdate(
                    { accountId: account.id },
                    {
                        sessionString: account.sessionString,
                        firstName: account.firstName,
                        lastName: account.lastName,
                        username: account.username,
                        phone: account.phone,
                        about: account.about || ''
                    },
                    { upsert: true, returnDocument: 'after' }
                );
            }
        } catch (err) {
            console.error('[Telegram] Error saving accounts:', err);
        }
    }

    getAccounts() {
        return Array.from(this.accounts.values());
    }

    // ─── LOGIN: OTP Flow ───────────────────────────────
    async requestLoginCode(phone) {
        const retryAt = this.getLoginCooldown(phone);
        if (retryAt) {
            return {
                success: false,
                error: `LOGIN_COOLDOWN:${Math.ceil((retryAt - Date.now()) / 1000)}`,
            };
        }

        await this.cleanupPendingAuth(phone);

        const session = new StringSession('');
        const client = new TelegramClient(session, getTelegramApiId(), getTelegramApiHash(), getClientOptions({ connectionRetries: 3 }));
        client.setLogLevel('none');

        try {
            await client.connect();
            const res = await client.sendCode(
                { apiId: getTelegramApiId(), apiHash: getTelegramApiHash() },
                phone
            );
            this.pendingAuth.set(phone, {
                client,
                phoneCodeHash: res.phoneCodeHash,
                createdAt: Date.now(),
            });
            return { success: true, phoneCodeHash: res.phoneCodeHash };
        } catch (err) {
            this.rememberLoginCooldown(phone, err);
            try { await client.disconnect(); } catch (_) {}
            return { success: false, error: err.message };
        }
    }

    async submitLoginCode(phone, code, phoneCodeHash, password = '') {
        const retryAt = this.getLoginCooldown(phone);
        if (retryAt) {
            return {
                success: false,
                error: `LOGIN_COOLDOWN:${Math.ceil((retryAt - Date.now()) / 1000)}`,
            };
        }

        let pending = this.pendingAuth.get(phone);
        if (!pending || pending.phoneCodeHash !== phoneCodeHash || Date.now() - pending.createdAt > 10 * 60 * 1000) {
            return { success: false, error: 'AUTH_SESSION_EXPIRED' };
        }

        const client = pending.client;
        try {
            if (password) {
                const { computeCheck } = require('telegram/Password');
                const passwordParams = await client.invoke(new Api.account.GetPassword());
                const checkPwd = await computeCheck(passwordParams, password);
                await client.invoke(new Api.auth.CheckPassword({ password: checkPwd }));
            } else {
                try {
                    await client.invoke(new Api.auth.SignIn({
                        phoneNumber: phone,
                        phoneCodeHash,
                        phoneCode: code,
                    }));
                } catch (err) {
                    if ((err.message || '').includes('SESSION_PASSWORD_NEEDED')) {
                        return { success: false, error: 'SESSION_PASSWORD_NEEDED' };
                    }
                    throw err;
                }
            }

            const me = await client.getMe();
            const accountId = me.id.toString();
            const sessionString = client.session.save();

            if (this.clients.has(accountId)) {
                try { await this.clients.get(accountId).disconnect(); } catch (_) {}
            }

            let about = '';
            try {
                const fullMe = await client.invoke(new Api.users.GetFullUser({ id: 'me' }));
                about = fullMe.fullUser.about || '';
            } catch (e) {}

            this.clients.set(accountId, client);
            this.accounts.set(accountId, {
                id: accountId,
                sessionString,
                firstName: me.firstName,
                lastName: me.lastName,
                username: me.username,
                phone: me.phone,
                about,
                connected: true,
            });
            this.registerIncomingHandlers(client, accountId, me);
            this.pendingAuth.delete(phone);
            await this._saveAccounts();
            return { success: true, account: this.accounts.get(accountId) };
        } catch (err) {
            this.rememberLoginCooldown(phone, err);
            return { success: false, error: err.message };
        }
    }

    // ─── LOGIN: Import Session String ──────────────────
    async importSession(sessionString) {
        let session;
        try {
            session = new StringSession(sessionString);
        } catch (err) {
            return { success: false, error: "Định dạng Session không hợp lệ (Not a valid string). Vui lòng copy chính xác." };
        }
        
        // Để connectionRetries là 3 để GramJS có cơ hội tự động tái đồng bộ timeOffset nếu máy chủ lệch giờ
        const client = new TelegramClient(session, getTelegramApiId(), getTelegramApiHash(), getClientOptions({ connectionRetries: 3 }));
        client.setLogLevel('none'); // Tắt log rác hiển thị ra terminal

        try {
            await client.connect();
            // Đợi 1.5s để GramJS hoàn tất đồng bộ thời gian (timeOffset) với máy chủ Telegram
            await new Promise(r => setTimeout(r, 1500));
            
            // Lấy thông tin GetMe với retry nếu gặp lỗi đồng bộ thời gian MSGID_DECREASE_RETRY hoặc 500
            let me;
            let getMeAttempts = 3;
            for (let i = 1; i <= getMeAttempts; i++) {
                try {
                    me = await client.getMe();
                    break;
                } catch (getMeErr) {
                    if ((getMeErr.message?.includes('MSGID_DECREASE_RETRY') || getMeErr.message?.includes('500') || getMeErr.code === 500) && i < getMeAttempts) {
                        console.warn(`[Telegram] Import getMe attempt ${i} transient failure: ${getMeErr.message}. Retrying in 1s...`);
                        await new Promise(r => setTimeout(r, 1000));
                        continue;
                    }
                    throw getMeErr;
                }
            }

            const accountId = me.id.toString();

            if (this.clients.has(accountId)) {
                try { await this.clients.get(accountId).disconnect(); } catch (_) {}
            }

            let about = '';
            try {
                // Lấy GetFullUser với retry
                let fullMe;
                for (let i = 1; i <= 3; i++) {
                    try {
                        fullMe = await client.invoke(new Api.users.GetFullUser({ id: 'me' }));
                        break;
                    } catch (fullMeErr) {
                        if ((fullMeErr.message?.includes('MSGID_DECREASE_RETRY') || fullMeErr.message?.includes('500') || fullMeErr.code === 500) && i < 3) {
                            await new Promise(r => setTimeout(r, 1000));
                            continue;
                        }
                        throw fullMeErr;
                    }
                }
                about = fullMe?.fullUser?.about || '';
            } catch (e) {}

            this.clients.set(accountId, client);
            this.accounts.set(accountId, {
                id: accountId, sessionString,
                firstName: me.firstName, lastName: me.lastName,
                username: me.username, phone: me.phone, about, connected: true,
            });
            this.registerIncomingHandlers(client, accountId, me);
            this._saveAccounts();
            return { success: true, account: this.accounts.get(accountId) };
        } catch (err) {
            try { await client.disconnect(); } catch (_) {}
            return { success: false, error: err.message };
        }
    }

    async removeAccount(accountId) {
        let client = this.clients.get(accountId);
        let tempClient = null;

        if (!client) {
            const account = this.accounts.get(accountId) || await TelegramAccount.findOne({ accountId });
            if (account?.sessionString) {
                try {
                    const session = new StringSession(account.sessionString);
                    tempClient = new TelegramClient(session, getTelegramApiId(), getTelegramApiHash(), getClientOptions({ connectionRetries: 1 }));
                    tempClient.setLogLevel('none');
                    await tempClient.connect();
                    client = tempClient;
                } catch (err) {
                    console.warn(`[Telegram] Could not reconnect ${accountId} before logout:`, err.message);
                }
            }
        }

        if (client) {
            try {
                await client.invoke(new Api.auth.LogOut());
            } catch (err) {
                console.warn(`[Telegram] Logout failed for ${accountId}:`, err.message);
            }
            try { await client.disconnect(); } catch (_) {}
            this.clients.delete(accountId);
        }
        this.accounts.delete(accountId);
        try {
            await TelegramAccount.findOneAndDelete({ accountId });
        } catch (err) {
            console.error(err);
        }
        return { success: true, loggedOut: !!client };
    }

    async withAccount(accountId, action) {
        const client = this.clients.get(accountId);
        if (!client) throw new Error("Account not connected");
        return action(client);
    }

    // ─── DIALOGS: Groups/Channels ──────────────────────
    async joinChatWithAllAccounts(link) {
        let results = [];
        let hash = '';
        let publicUsername = '';

        if (link.includes('+')) hash = link.split('+')[1].split('?')[0];
        else if (link.includes('joinchat/')) hash = link.split('joinchat/')[1].split('?')[0];
        else if (link.includes('t.me/')) publicUsername = link.split('t.me/')[1].split('/')[0].split('?')[0];
        else publicUsername = link.replace('@', ''); 

        for (const [accountId, client] of this.clients.entries()) {
            if (!this.accounts.get(accountId).connected) continue;

            const accName = this.accounts.get(accountId).firstName;
            try {
                let targetPeer = publicUsername;
                if (hash) {
                    const res = await client.invoke(new Api.messages.ImportChatInvite({ hash }));
                    if (res && res.chats && res.chats.length > 0) {
                        targetPeer = res.chats[0].id.toString();
                    }
                } else if (publicUsername) {
                    await client.invoke(new Api.channels.JoinChannel({ channel: publicUsername }));
                }
                
                if (targetPeer) {
                    await new Promise(r => setTimeout(r, 1000 + Math.random() * 1500));
                    await this.simulateHumanActivity(client, targetPeer);
                }
                results.push(`🟢 [${accName}]: Vào thành công`);
            } catch (err) {
                 if (err.message.includes('USER_ALREADY_PARTICIPANT')) {
                     results.push(`🔵 [${accName}]: Đã nằm vùng từ trước`);
                 } else if (err.message.includes('INVITE_HASH_EXPIRED')) {
                     results.push(`🔴 Link đã hết hạn! Ngưng chạy tiếp.`);
                     break; 
                 } else {
                     results.push(`🔴 [${accName}]: Lỗi - ${err.message}`);
                 }
            }
        }
        return results;
    }

    async getDialogs(accountId) {
        return this.withAccount(accountId, async (client) => {
            const dialogs = await client.getDialogs();
            return dialogs
                .filter(d => d.isGroup || d.isChannel)
                .map(d => {
                    const entity = d.entity || {};
                    const isForum = !!entity.forum;
                    const isCreator = !!entity.creator;
                    let isAdmin = false;
                    if (isCreator || entity.adminRights) {
                        isAdmin = true;
                    }

                    let defaultBannedRights = null;
                    if (entity.defaultBannedRights) {
                        const rights = entity.defaultBannedRights;
                        defaultBannedRights = {
                            sendMessages: rights.sendMessages,
                            sendMedia: rights.sendMedia,
                            sendStickers: rights.sendStickers,
                            sendGifs: rights.sendGifs,
                            sendGames: rights.sendGames,
                            sendInline: rights.sendInline,
                            embedLinks: rights.embedLinks,
                            sendPolls: rights.sendPolls,
                            changeInfo: rights.changeInfo,
                            inviteUsers: rights.inviteUsers,
                            pinMessages: rights.pinMessages,
                        };
                    }

                    return {
                        id: d.id.toString(),
                        title: d.title,
                        username: entity.username || '',
                        isGroup: d.isGroup,
                        isChannel: d.isChannel,
                        isForum,
                        isCreator,
                        isAdmin,
                        participantsCount: entity.participantsCount || null,
                        defaultBannedRights
                    };
                });
        });
    }

    async writeAiLeadScanLog(summary, source = 'manual') {
        try {
            const PostLog = require('./models/PostLog');
            await PostLog.create({
                campaignId: 'ai-lead',
                campaignName: 'AI Lead',
                accountId: summary.accountIds?.join(', ') || '',
                accountName: `${summary.accounts || 0} connected account(s)`,
                targetName: 'Private inbox',
                action: `ai_lead_inbox_scan:${source}`,
                status: summary.success ? 'success' : 'fail',
                contentPreview: `dialogs=${summary.dialogs || 0}, scanned=${summary.scanned || 0}, queued=${summary.queued || 0}, sent=${summary.sent || 0}, ignored=${summary.ignored || 0}${summary.ignoredReasons ? ', reasons=' + JSON.stringify(summary.ignoredReasons) : ''}`,
                errorMessage: Array.isArray(summary.errors) && summary.errors.length ? summary.errors.map((err) => err.error || String(err)).join('; ') : '',
            });
        } catch (err) {
            console.error('[AILead] Failed to write scan log:', err.message);
        }
    }

    async startAiLeadPrivateInboxWatcher(intervalMs = 60000) {
        const settings = await require('./models/Setting').findOne({ type: 'global_app_settings' });
        if (settings?.aiLeadUserReplyEnabled === false) {
            this.stopAiLeadPrivateInboxWatcher();
            console.log('[AILead] Private inbox watcher disabled: user reply is off');
            return { success: false, running: false, reason: 'AI user reply is disabled' };
        }
        if (!settings?.openaiApiKey) {
            this.stopAiLeadPrivateInboxWatcher();
            console.log('[AILead] Private inbox watcher disabled: missing AI API key');
            return { success: false, running: false, reason: 'Missing AI API key' };
        }

        if (this.aiLeadPrivateScanTimer) {
            return { success: true, running: true, reason: 'already_running' };
        }

        this.aiLeadPrivateScanTimer = setInterval(() => {
            if (this.aiLeadPrivateScanRunning) return;
            this.aiLeadPrivateScanRunning = true;
            this.scanUnreadPrivateMessages({ dialogLimit: 100, messageLimit: 5, source: 'background', writeLog: false })
                .then((res) => {
                    if (res?.scanned || res?.queued || res?.sent || res?.errors?.length) {
                        console.log('[AILead] Background private unread scan:', res);
                        return this.writeAiLeadScanLog(res, 'background');
                    }
                    return null;
                })
                .catch((err) => console.error('[AILead] Background private unread scan error:', err.message))
                .finally(() => { this.aiLeadPrivateScanRunning = false; });
        }, intervalMs);

        console.log(`[AILead] Private inbox watcher started, interval ${intervalMs}ms`);
        return { success: true, running: true };
    }

    stopAiLeadPrivateInboxWatcher() {
        if (this.aiLeadPrivateScanTimer) clearInterval(this.aiLeadPrivateScanTimer);
        this.aiLeadPrivateScanTimer = null;
        return { success: true, running: false };
    }

    async processPrivateConversation({ accountId, client, chatId }) {
        const aiLeadService = require('./aiLeadService');
        try {
            const entity = await this.resolveEntity(client, chatId);
            if (!entity) return;

            const dialogs = await client.getDialogs({ limit: 50 });
            const dialog = dialogs.find(d => d.entity && String(d.entity.id) === String(chatId));
            const unreadCount = dialog ? Number(dialog.unreadCount || dialog.unread_count || 0) : 1;
            
            const unreadLimit = Math.max(1, Math.min(unreadCount || 1, 20));
            const limit = Math.max(unreadLimit, 20);
            const messages = await client.getMessages(entity, { limit });
            
            const chronologicalMessages = messages.slice().reverse();
            const recentPrivateContext = chronologicalMessages
                .filter(msg => msg && (msg.message || msg.text || '').trim())
                .slice(-20)
                .map(msg => `${msg.out ? 'Buyer' : 'Customer'}: ${(msg.message || msg.text || '').trim()}`)
                .join('\n');
            const lastOutgoingIndex = chronologicalMessages.map(msg => Boolean(msg?.out)).lastIndexOf(true);
            const messagesAfterLastReply = chronologicalMessages.slice(lastOutgoingIndex + 1);
            const validMessages = messagesAfterLastReply.filter(msg => msg && !msg.out && (msg.message || msg.text || '').trim());
            if (!validMessages.length) {
                console.log(`[AILead] Debounced private conversation ${chatId} ignored. Reason: no_valid_private_messages`);
                return;
            }

            const lastMsg = validMessages[validMessages.length - 1];
            const combinedText = validMessages.map(msg => (msg.message || msg.text || '').trim()).filter(Boolean).join('\n');
            if (!combinedText) {
                console.log('[AILead] Debounced private conversation ignored. Reason: empty_private_text', {
                    accountId,
                    chatId,
                    messages: validMessages.length,
                    messageIds: validMessages.map(msg => msg.id).slice(-5),
                });
                return;
            }

            console.log(`[AILead] Debounced private messages combined from ${chatId} (${validMessages.length} msgs): "${combinedText.replace(/\n/g, ' | ')}"`);

            const privateMessage = {
                id: lastMsg.id,
                message: combinedText,
                text: combinedText,
                out: lastMsg.out,
                media: lastMsg.media,
                sender: lastMsg.sender || entity,
                senderId: lastMsg.senderId || entity.id,
                chat: entity,
                chatId: lastMsg.chatId || entity.id,
                peerId: lastMsg.peerId,
                isPrivate: true,
                replyToMsgId: lastMsg.replyToMsgId,
                replyTo: lastMsg.replyTo,
                recentPrivateContext,
            };

            const result = await aiLeadService.handleIncoming({ accountId, client, message: privateMessage });
            if (result && result.status && result.status !== 'ignored') {
                console.log(`[AILead] Debounced private conversation ${chatId} processed status: ${result.status}`);
            } else if (result && result.status === 'ignored') {
                console.log(`[AILead] Debounced private conversation ${chatId} ignored. Reason: ${result.reason}`);
            }
        } catch (err) {
            console.error(`[AILead] Error in processPrivateConversation for ${chatId}:`, err.message);
        }
    }

    async scanUnreadPrivateMessages({ accountIds = [], dialogLimit = 100, messageLimit = 5, source = 'manual', writeLog = true } = {}) {
        const aiLeadService = require('./aiLeadService');
        const settings = await require('./models/Setting').findOne({ type: 'global_app_settings' });
        if (settings?.aiLeadUserReplyEnabled === false) {
            return { success: false, error: 'Trả lời tin nhắn user đang tắt.' };
        }
        if (!settings.openaiApiKey) {
            return { success: false, error: 'Thiếu AI API Key trong Settings.' };
        }
        const targetAccountIds = Array.isArray(accountIds) && accountIds.length > 0
            ? accountIds.map(String)
            : Array.isArray(settings.aiLeadAccountIds) && settings.aiLeadAccountIds.length > 0
                ? settings.aiLeadAccountIds.map(String)
            : Array.from(this.clients.keys());
        const summary = {
            success: true,
            source,
            accountIds: targetAccountIds,
            accounts: 0,
            dialogs: 0,
            scanned: 0,
            queued: 0,
            sent: 0,
            ignored: 0,
            ignoredReasons: {},
            errors: [],
        };

        console.log('[AILead] Private unread scan started:', { source, accounts: targetAccountIds.length });
        for (const accountId of targetAccountIds) {
            const client = this.clients.get(accountId);
            if (!client) {
                summary.errors.push({ accountId, error: 'Account not connected' });
                console.log('[AILead] Private scan skipped account:', { accountId, reason: 'Account not connected' });
                continue;
            }
            summary.accounts += 1;

            try {
                const dialogs = await client.getDialogs({ limit: Number(dialogLimit) || 100 });
                const privateDialogs = dialogs.filter((dialog) => {
                    const entity = dialog.entity || {};
                    const unreadCount = Number(dialog.unreadCount || dialog.unread_count || 0);
                    const isUser = dialog.isUser || entity.className === 'User';
                    return isUser && unreadCount > 0 && !entity.bot && !entity.self;
                });

                summary.dialogs += privateDialogs.length;
                if (!privateDialogs.length) console.log('[AILead] No unread private dialogs for account:', { accountId, totalDialogs: dialogs.length });
                for (const dialog of privateDialogs) {
                    const entity = dialog.entity;
                    const unreadCount = Number(dialog.unreadCount || dialog.unread_count || 0);
                    const unreadLimit = Math.max(1, Math.min(Number(messageLimit) || 5, unreadCount || 1, 20));
                    const limit = Math.max(unreadLimit, 20);
                    const messages = await client.getMessages(entity, { limit });

                    const chronologicalMessages = messages.slice().reverse();
                    const lastOutgoingIndex = chronologicalMessages.map(msg => !!msg.out).lastIndexOf(true);
                    const unansweredMessages = chronologicalMessages
                        .slice(lastOutgoingIndex + 1)
                        .filter(msg => msg && !msg.out && (msg.message || msg.text || '').trim());
                    const validMessages = unansweredMessages.length > 0
                        ? unansweredMessages
                        : chronologicalMessages.filter(msg => msg && !msg.out && (msg.message || msg.text || '').trim()).slice(-unreadLimit);
                    if (validMessages.length > 0) {
                        const lastMsg = validMessages[validMessages.length - 1];
                        const lastMsgDateMs = (lastMsg.date || 0) * 1000;
                        const elapsedMs = Date.now() - lastMsgDateMs;
                        if (elapsedMs < 60000) {
                            console.log('[AILead] Skip private conversation unread scan because customer might be still typing:', {
                                chatId: entity.id?.toString?.() || String(entity.id || ''),
                                elapsedSeconds: Math.round(elapsedMs / 1000),
                            });
                            continue;
                        }

                        console.log('[AILead] Private unread conversation found:', { accountId, chatId: entity.id?.toString?.() || String(entity.id || ''), unreadCount, validMessages: validMessages.length });
                        const recentPrivateContext = chronologicalMessages
                            .filter(msg => msg && (msg.message || msg.text || '').trim())
                            .slice(-20)
                            .map(msg => `${msg.out ? 'Buyer' : 'Customer'}: ${(msg.message || msg.text || '').trim()}`)
                            .join('\\n');
                        const combinedText = validMessages.map(msg => (msg.message || msg.text || '').trim()).filter(Boolean).join('\n');

                        if (!combinedText) {
                            summary.scanned += 1;
                            summary.ignored += 1;
                            summary.ignoredReasons.empty_private_text = (summary.ignoredReasons.empty_private_text || 0) + 1;
                            console.log('[AILead] Private conversation ignored:', {
                                accountId,
                                chatId: entity.id?.toString?.() || String(entity.id || ''),
                                messageId: lastMsg.id,
                                reason: 'empty_private_text',
                                validMessages: validMessages.length,
                            });
                            continue;
                        }

                        const privateMessage = {
                            id: lastMsg.id,
                            message: combinedText,
                            text: combinedText,
                            out: lastMsg.out,
                            media: lastMsg.media,
                            sender: lastMsg.sender || entity,
                            senderId: lastMsg.senderId || entity.id,
                            chat: entity,
                            chatId: lastMsg.chatId || entity.id,
                            peerId: lastMsg.peerId,
                            isPrivate: true,
                            replyToMsgId: lastMsg.replyToMsgId,
                            replyTo: lastMsg.replyTo,
                            recentPrivateContext,
                        };

                        const result = await aiLeadService.handleIncoming({ accountId, client, message: privateMessage });
                        summary.scanned += 1;
                        if (result?.status === 'queued') {
                            summary.queued += 1;
                            console.log(`[AILead] Private conversation ${entity.id} queued. Category: ${result.item?.category}`);
                        }
                        else if (result?.status === 'sent') {
                            summary.sent += 1;
                            console.log(`[AILead] Private conversation ${entity.id} sent response.`);
                        }
                        else if (result?.status === 'error') {
                            summary.success = false;
                            summary.errors.push({ accountId, messageId: lastMsg.id, error: result.error || 'AI handler error' });
                            console.error(`[AILead] Private conversation ${entity.id} error:`, result.error);
                        }
                        else {
                            summary.ignored += 1;
                            const reason = result?.reason || 'unknown';
                            summary.ignoredReasons[reason] = (summary.ignoredReasons[reason] || 0) + 1;
                            console.log('[AILead] Private conversation ignored:', {
                                accountId,
                                chatId: entity.id?.toString?.() || String(entity.id || ''),
                                messageId: lastMsg.id,
                                senderId: privateMessage.senderId?.toString?.() || String(privateMessage.senderId || ''),
                                reason,
                                decision: result?.decision || null,
                                textPreview: combinedText.slice(0, 180),
                            });
                        }
                    }
                }
            } catch (err) {
                summary.success = false;
                summary.errors.push({ accountId, error: err.message });
            }
        }

        console.log('[AILead] Private unread scan finished:', summary);
        if (writeLog) await this.writeAiLeadScanLog(summary, source);
        return summary;
    }

    // ─── FORUM TOPICS ──────────────────────────────────
    async getForumTopics(accountId, chatId) {
        return this.withAccount(accountId, async (client) => {
            try {
                const entity = await this.resolveEntity(client, chatId);
                const result = await client.invoke(new Api.channels.GetForumTopics({
                    channel: entity,
                    limit: 100,
                    offsetDate: 0,
                    offsetId: 0,
                    offsetTopic: 0,
                }));
                return (result.topics || []).map(t => ({
                    id: t.id,
                    title: t.title,
                    iconColor: t.iconColor,
                    iconEmojiId: t.iconEmojiId?.toString(),
                }));
            } catch (err) {
                console.error('[Telegram] getForumTopics error:', err.message);
                return [];
            }
        });
    }

    // ─── MESSAGES: Browse recent messages ──────────────
    async getMessages(accountId, chatId, limit = 30, topicId = null) {
        return this.withAccount(accountId, async (client) => {
            const entity = await this.resolveEntity(client, chatId);
            const options = { limit };
            if (topicId) options.replyTo = Number(topicId);
            const messages = await client.getMessages(entity, options);
            return messages.map(m => {
                let replyMarkup = null;
                if (m.replyMarkup && m.replyMarkup.rows) {
                    replyMarkup = {
                        rows: m.replyMarkup.rows.map(row => ({
                            buttons: (row.buttons || []).map(btn => {
                                let dataBase64 = null;
                                if (btn.data) {
                                    dataBase64 = Buffer.isBuffer(btn.data)
                                        ? btn.data.toString('base64')
                                        : btn.data.toString();
                                }
                                return {
                                    className: btn.className,
                                    text: btn.text,
                                    url: btn.url || null,
                                    data: dataBase64
                                };
                            })
                        }))
                    };
                }
                return {
                    id: m.id,
                    text: m.text || '',
                    date: m.date,
                    hasMedia: !!m.media,
                    mediaType: m.media?.className || null,
                    fromId: m.fromId?.userId?.toString() || null,
                    senderUsername: m.sender?.username ? `@${m.sender.username}` : '',
                    senderName: m.sender
                        ? [m.sender.firstName, m.sender.lastName].filter(Boolean).join(' ')
                        : '',
                    replyMarkup
                };
            });
        });
    }

    async getMessageMedia(accountId, chatId, messageId) {
        return this.withAccount(accountId, async (client) => {
            const entity = await this.resolveEntity(client, chatId);
            const messages = await client.getMessages(entity, { ids: [messageId] });
            if (!messages || messages.length === 0 || !messages[0].media) {
                return { success: false, error: 'No media found' };
            }
            
            const buffer = await client.downloadMedia(messages[0], { workers: 1 });
            if (!buffer) return { success: false, error: 'Download failed' };

            let mimeType = 'image/jpeg';
            if (messages[0].media.className === 'MessageMediaDocument') {
                const doc = messages[0].media.document;
                if (doc && doc.mimeType) mimeType = doc.mimeType;
            }

            return { 
                success: true, 
                base64: `data:${mimeType};base64,${buffer.toString('base64')}` 
            };
        });
    }

    // ─── DIAGNOSTICS & SECURITY ────────────────────────
    async scanGroupSecurity(accountId, chatId) {
        return this.withAccount(accountId, async (client) => {
            try {
                const entity = await this.resolveEntity(client, chatId);
                const result = {
                    adminBots: [],
                    messagesScanned: 0,
                    normalUserLinks: 0,
                    normalUserTags: 0,
                    normalUserForwards: 0,
                    success: true
                };

                // 1. Scan Admins for Bots
                const adminIds = new Set();
                try {
                    if (entity.className === 'Channel') {
                        const participants = await client.invoke(
                            new Api.channels.GetParticipants({
                                channel: entity,
                                filter: new Api.ChannelParticipantsAdmins(),
                                offset: 0,
                                limit: 100,
                                hash: BigInt(0),
                            })
                        );
                        if (participants && participants.users) {
                            for (let u of participants.users) {
                                adminIds.add(u.id.toString());
                                if (u.bot) {
                                    result.adminBots.push(`@${u.username || u.firstName}`);
                                }
                            }
                        }
                    } else if (entity.className === 'Chat') {
                        const fullChatRes = await client.invoke(new Api.messages.GetFullChat({ chatId: entity.id }));
                        const chatParticipants = fullChatRes.fullChat?.participants?.participants || [];
                        const users = fullChatRes.users || [];
                        
                        const admins = chatParticipants.filter(p => p.className === 'ChatParticipantCreator' || p.className === 'ChatParticipantAdmin');
                        for (let p of admins) {
                            adminIds.add(p.userId.toString());
                            const user = users.find(u => u.id.toString() === p.userId.toString());
                            if (user && user.bot) {
                                result.adminBots.push(`@${user.username || user.firstName}`);
                            }
                        }
                    }
                    
                    // 2. Data mine recent messages
                    const messages = await client.getMessages(entity, { limit: 100 });
                    result.messagesScanned = messages.length;

                    for (let m of messages) {
                        const senderId = m.fromId?.userId?.toString() || m.peerId?.userId?.toString();
                        if (!senderId || adminIds.has(senderId)) continue; // Skip admins or unknown
                        
                        if (m.fwdFrom) {
                            result.normalUserForwards++;
                        }

                        const text = m.text || '';
                        if (!text) continue;

                        if (text.includes('http://') || text.includes('https://') || text.includes('t.me/')) {
                            result.normalUserLinks++;
                        }
                        if (text.includes('@')) {
                            result.normalUserTags++;
                        }
                    }
                } catch (err) {
                    console.error('[TelegramService] scanGroupSecurity error:', err);
                    if (err.message.includes('CHAT_ADMIN_REQUIRED')) {
                         // Fallback or warning
                         result.warning = "Không có quyền xem Admins. Dữ liệu tin nhắn có thể không chính xác.";
                    } else {
                        throw err;
                    }
                }
                return result;
            } catch (err) {
                return { success: false, error: err.message };
            }
        });
    }

    // ─── FORWARD / SHARE ───────────────────────────────  
    async forwardMessages(accountId, fromChatId, messageIds, toChatIds) {
        return this.withAccount(accountId, async (client) => {
            const fromEntity = await this.resolveEntity(client, fromChatId);
            const results = [];
            for (const toChatId of toChatIds) {
                try {
                    const toEntity = await this.resolveEntity(client, toChatId);
                    await client.forwardMessages(toEntity, {
                        messages: messageIds,
                        fromPeer: fromEntity,
                    });
                    results.push({ toChatId, success: true });
                } catch (err) {
                    results.push({ toChatId, success: false, error: err.message });
                }
            }
            return results;
        });
    }

    // ─── CAMPAIGN PRE-FLIGHT VALIDATION ───────────────
    async validateCampaign(accountId, campaignPayload, targetsCache) {
        return this.withAccount(accountId, async (client) => {
            const result = {
                content: { hasLinks: false, hasTags: false, hasMedia: false },
                targets: []
            };

            try {
                // 1. Phân Tích Nội Dung (Content Parser)
                if (campaignPayload.type === 'forward') {
                    const source = campaignPayload.forwardSource;
                    if (source && source.fromChatId && source.messageIds && source.messageIds.length > 0) {
                        const fromEntity = await this.resolveEntity(client, source.fromChatId);
                        const messages = await client.getMessages(fromEntity, { ids: source.messageIds });
                        for (const msg of messages) {
                            if (!msg) continue;
                            if (msg.media) result.content.hasMedia = true;
                            if (msg.entities) {
                                for (const ent of msg.entities) {
                                    if (ent.className === 'MessageEntityUrl' || ent.className === 'MessageEntityTextUrl') {
                                        result.content.hasLinks = true;
                                    }
                                    if (ent.className === 'MessageEntityMention' || ent.className === 'MessageEntityMentionName') {
                                        result.content.hasTags = true;
                                    }
                                }
                            }
                            if (msg.message && (msg.message.includes('http') || msg.message.includes('www.'))) result.content.hasLinks = true;
                            if (msg.message && msg.message.includes('@')) result.content.hasTags = true;
                        }
                    }
                } else {
                    // Type: Text / Photo
                    if (campaignPayload.type === 'photo') result.content.hasMedia = true;
                    if (campaignPayload.imagePaths && campaignPayload.imagePaths.length > 0) result.content.hasMedia = true;
                    
                    const text = campaignPayload.contentTemplate || '';
                    if (text.includes('http') || text.includes('www.')) result.content.hasLinks = true;
                    if (text.includes('@')) result.content.hasTags = true;
                }

                // 2. Định Vị Điểm Chặn (Target Rules Engine)
                for (const target of targetsCache) {
                    const report = {
                        chatId: target.chatId,
                        name: target.name,
                        status: 'SAFE',
                        reasons: []
                    };

                    const rights = target.defaultBannedRights || {};

                    // Kiểm tra tài khoản cụ thể (account đang chạy) có bị Mute/Ban/Kick không
                    let isBanned = false;
                    let notParticipant = false;
                    let resolveError = '';
                    try {
                        const entity = await this.resolveEntity(client, target.chatId);
                        if (entity && entity.className === 'Channel') {
                            if (entity.broadcast && !entity.megagroup) {
                                // Đây là kênh Channel (Broadcast 1 chiều)
                                if (!entity.creator && (!entity.adminRights || !entity.adminRights.postMessages)) {
                                    isBanned = true;
                                    resolveError = 'Tài khoản không phải Admin nên không thể gửi bài vào Kênh (Broadcast Channel).';
                                }
                            } else {
                                // Là SuperGroup
                                try {
                                    const p = await client.invoke(new Api.channels.GetParticipant({ channel: entity, participant: 'me' }));
                                    if (p && p.participant && p.participant.className === 'ChannelParticipantBanned') {
                                        if (p.participant.bannedRights) {
                                            // Nếu cấm sendMessages hoặc cấm readMessages thì coi như ban
                                            if (p.participant.bannedRights.sendMessages || p.participant.bannedRights.viewMessages) {
                                                isBanned = true;
                                            }
                                        }
                                    } else if (p && p.participant && p.participant.className === 'ChannelParticipantLeft') {
                                        notParticipant = true;
                                    }
                                } catch (pErr) {
                                    if (pErr.message.includes('USER_NOT_PARTICIPANT')) {
                                        notParticipant = true;
                                    } else if (pErr.message.includes('USER_BANNED_IN_CHANNEL')) {
                                        isBanned = true;
                                    } else {
                                        throw pErr;
                                    }
                                }
                            }
                        } else if (entity && entity.className === 'Chat') {
                            // Basic Group - thường nếu bị kích/ban sẽ văng lỗi ngay ở resolveEntity
                            if (entity.left || entity.kicked) {
                                notParticipant = true;
                            }                    }
                    } catch (err) {
                        const msg = err.message || '';
                        if (msg.includes('CHANNEL_PRIVATE') || msg.includes('USER_BANNED_IN_CHANNEL')) {
                            isBanned = true;
                        } else if (msg.includes('USER_NOT_PARTICIPANT') || msg.includes('Could not resolve entity')) {
                            notParticipant = true;
                        } else {
                            notParticipant = true;
                            resolveError = msg;
                        }
                    }

                    if (isBanned) {
                        report.status = 'ERROR';
                        report.reasons.push('Lỗi: Tài khoản chạy chiến dịch này đã bị Khóa/Cấm chat trong nhóm này!');
                        result.targets.push(report);
                        continue;
                    }
                    if (notParticipant) {
                        report.status = 'ERROR';
                        report.reasons.push(`Lỗi truy cập: Tài khoản chưa tham gia nhóm này hoặc đã bị kick ra ngoài${resolveError ? ` (${resolveError})` : ''}.`);
                        result.targets.push(report);
                        continue;
                    }

                    // Cấm toàn tập
                    if (rights.sendMessages) {
                        report.status = 'ERROR';
                        report.reasons.push('Nhóm khóa Chat (Không cho phép gửi bất cứ tin nhắn nào).');
                    } else {
                        // Kiểm tra đa phương tiện
                        if (result.content.hasMedia && rights.sendMedia) {
                            report.status = 'ERROR';
                            report.reasons.push('Xung đột: Nội dung có gắn Media (Ảnh/Video), nhưng nhóm cấm gửi Media.');
                        }
                        
                        // Kiểm tra Links
                        if (result.content.hasLinks) {
                            if (rights.embedLinks) {
                                if (report.status !== 'ERROR') report.status = 'WARNING';
                                report.reasons.push('Hạn chế: Nhóm cấm hiển thị Link Preview. Web URL vẫn sẽ được gửi dạng text nhưng không bung ảnh thumbnail ra ngoài.');
                            }
                        }

                        // Kiểm tra Bot Inline
                        if (rights.sendInline) {
                            if (campaignPayload.actionButtons && campaignPayload.actionButtons.length > 0) {
                                report.status = 'ERROR';
                                report.reasons.push('Xung đột: Chiến dịch sử dụng Nút Bấm Hành Động (Action Buttons), nhưng nhóm cấm Bot Inline (không thể gửi nút bấm).');
                            } else if (result.content.hasTags || result.content.hasLinks) {
                                if (report.status !== 'ERROR') report.status = 'WARNING';
                                report.reasons.push('Cảnh báo: Nhóm chặn Bot Inline, có thể bị lỗi nếu dùng bot để tạo phím bấm/share.');
                            }
                        }

                        // Kiểm tra Forward chống Anti-Spam Bot
                        if (campaignPayload.type === 'forward') {
                            try {
                                const entity = await this.resolveEntity(client, target.chatId);
                                const msgs = await client.getMessages(entity, { limit: 60 });
                                let fwdCount = 0;
                                for (let m of msgs) {
                                    if (m.fwdFrom) fwdCount++;
                                }
                                if (fwdCount === 0 && msgs.length > 20) {
                                    report.status = 'ERROR';
                                    report.reasons.push('Khóa Forward: Không tìm thấy tin Forward nào tồn tại trong lịch sử. Hệ thống cho rằng nhóm này sử dụng Bot Xóa Forward tự động!');
                                }
                            } catch (e) {
                                console.error('[Validation FWD check error]', e.message);
                            }                    }
                    }

                    if (report.reasons.length === 0) {
                        report.reasons.push('Tuyệt vời! Không phát hiện Luật cản cản trở thao tác này.');
                    }

                    result.targets.push(report);
                }

                return { success: true, result };

            } catch (err) {
                console.error('[Validation] Error:', err);
                return { success: false, error: err.message };
            }
        });
    }

    // ─── GROUP MANAGEMENT ──────────────────────────────
    async leaveGroup(accountId, chatId) {
        return this.withAccount(accountId, async (client) => {
            try {
                const entity = await this.resolveEntity(client, chatId);
                if (entity.className === 'Channel') {
                    await client.invoke(new Api.channels.LeaveChannel({ channel: entity }));
                } else if (entity.className === 'Chat') {
                    await client.invoke(new Api.messages.DeleteChatUser({ chatId: entity.id, userId: 'me' }));
                } else {
                    return { success: false, error: 'Không phải là nhóm hoặc kênh (Not a group/channel)' };
                }
                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });
    }
    async addMember(accountId, groupId, userId) {
        return this.withAccount(accountId, async (client) => {
            const channel = await this.resolveEntity(client, groupId);
            const user = await this.resolveEntity(client, userId);

            await this.simulateHumanActivity(client, channel);
            await new Promise(r => setTimeout(r, 1000 + Math.random() * 1500));

            await client.invoke(new Api.channels.InviteToChannel({ channel, users: [user] }));
            return { success: true };
        });
    }

    async removeMember(accountId, groupId, userId) {
        return this.withAccount(accountId, async (client) => {
            const channel = await this.resolveEntity(client, groupId);
            const user = await this.resolveEntity(client, userId);
            await client.invoke(new Api.channels.EditBanned({
                channel,
                participant: user,
                bannedRights: new Api.ChatBannedRights({ untilDate: 0, viewMessages: true, sendMessages: true }),
            }));
            return { success: true };
        });
    }

    // ─── PROFILE & AVATAR ──────────────────────────────
    async getPhoto(accountId, peerId) {
        return this.withAccount(accountId, async (client) => {
            try {
                const peer = peerId ? await this.resolveEntity(client, peerId) : 'me';
                const buffer = await client.downloadProfilePhoto(peer, { isBig: false });
                if (buffer && buffer.length > 0) {
                    return { success: true, photoBase64: buffer.toString('base64') };
                }
                return { success: false, error: 'No photo' };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });
    }

    async updateProfile(accountId, { firstName, lastName, about }) {
        return this.withAccount(accountId, async (client) => {
            try {
                if (firstName !== undefined || lastName !== undefined || about !== undefined) {
                    await client.invoke(new Api.account.UpdateProfile({
                        firstName: firstName !== undefined ? firstName : '',
                        lastName: lastName !== undefined ? lastName : '',
                        about: about !== undefined ? about : ''
                    }));
                }
                
                const me = await client.getMe();
                let newAbout = '';
                try {
                    const fullMe = await client.invoke(new Api.users.GetFullUser({ id: 'me' }));
                    newAbout = fullMe.fullUser.about || '';
                } catch (e) {}

                const account = this.accounts.get(accountId);
                if (account) {
                    account.firstName = me.firstName;
                    account.lastName = me.lastName;
                    account.about = newAbout;
                    this.accounts.set(accountId, account);
                    this._saveAccounts();
                }
                return { success: true, account: this.accounts.get(accountId) };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });
    }

    async updateUsername(accountId, username) {
        return this.withAccount(accountId, async (client) => {
            try {
                await client.invoke(new Api.account.UpdateUsername({ username }));
                const me = await client.getMe();
                const account = this.accounts.get(accountId);
                if (account) {
                    account.username = me.username;
                    this.accounts.set(accountId, account);
                    this._saveAccounts();
                }
                return { success: true, username: me.username };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });
    }

    async uploadProfilePhoto(accountId, base64Image) {
        return this.withAccount(accountId, async (client) => {
            try {
                const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");
                const buffer = Buffer.from(base64Data, 'base64');
                const { CustomFile } = require('telegram/client/uploads');
                const file = await client.uploadFile({
                    file: new CustomFile("avatar.jpg", buffer.length, "avatar.jpg", buffer),
                    workers: 1
                });
                await client.invoke(new Api.photos.UploadProfilePhoto({ file }));
                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });
    }

    async deleteProfilePhoto(accountId) {
        return this.withAccount(accountId, async (client) => {
            try {
                const photos = await client.invoke(new Api.photos.GetUserPhotos({
                    userId: 'me',
                    offset: 0,
                    limit: 1,
                    maxId: 0
                }));
                if (photos && photos.photos && photos.photos.length > 0) {
                    const photo = photos.photos[0];
                    await client.invoke(new Api.photos.DeletePhotos({
                        id: [new Api.InputPhoto({ id: photo.id, accessHash: photo.accessHash })]
                    }));
                    return { success: true };
                }
                return { success: false, error: 'No profile photo found' };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });
    }

    async setPrivacySettings(accountId, rules) {
        return this.withAccount(accountId, async (client) => {
            try {
                const { statusRule, phoneRule } = rules;
                const mapRule = (ruleStr) => {
                    if (ruleStr === 'contacts') return new Api.InputPrivacyValueAllowContacts();
                    if (ruleStr === 'all') return new Api.InputPrivacyValueAllowAll();
                    return new Api.InputPrivacyValueDisallowAll();
                };

                if (statusRule) {
                    await client.invoke(new Api.account.SetPrivacy({
                        key: new Api.InputPrivacyKeyStatusTimestamp(),
                        rules: [mapRule(statusRule)]
                    }));
                }
                if (phoneRule) {
                    await client.invoke(new Api.account.SetPrivacy({
                        key: new Api.InputPrivacyKeyPhoneNumber(),
                        rules: [mapRule(phoneRule)]
                    }));
                }
                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });
    }

    async manageContacts(accountId, action, payload) {
        return this.withAccount(accountId, async (client) => {
            try {
                if (action === 'get') {
                    const contacts = await client.invoke(new Api.contacts.GetContacts({ hash: BigInt(0) }));
                    const users = (contacts.users || []).map(u => ({
                        id: u.id.toString(),
                        firstName: u.firstName || '',
                        lastName: u.lastName || '',
                        username: u.username || '',
                        phone: u.phone || '',
                        mutual: u.mutualContact || false
                    }));
                    return { success: true, contacts: users };
                } else if (action === 'add') {
                    const { phone, firstName, lastName } = payload;
                    const res = await client.invoke(new Api.contacts.ImportContacts({
                        contacts: [
                            new Api.InputPhoneContact({
                                clientId: BigInt(Date.now()),
                                phone,
                                firstName: firstName || '',
                                lastName: lastName || ''
                            })
                        ]
                    }));
                    return { success: true, result: res };
                } else if (action === 'delete') {
                    const { userId } = payload;
                    const user = await client.getEntity(userId);
                    await client.invoke(new Api.contacts.DeleteContacts({
                        id: [user.id]
                    }));
                    return { success: true };
                }
                return { success: false, error: 'Invalid action' };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });
    }

    async createChat(accountId, title, users, isMega, about) {
        return this.withAccount(accountId, async (client) => {
            try {
                const resolvedUsers = [];
                for (const u of users) {
                    try {
                        const ent = await client.getEntity(u);
                        resolvedUsers.push(ent);
                    } catch (_) {}
                }

                if (isMega) {
                    const res = await client.invoke(new Api.channels.CreateChannel({
                        title,
                        about: about || '',
                        megagroup: true
                    }));
                    return { success: true, chat: res };
                } else {
                    const res = await client.invoke(new Api.messages.CreateChat({
                        users: resolvedUsers,
                        title
                    }));
                    return { success: true, chat: res };
                }
            } catch (err) {
                return { success: false, error: err.message };
            }
        });
    }

    async editBanned(accountId, chatId, usernameOrId, action) {
        return this.withAccount(accountId, async (client) => {
            try {
                const channel = await this.resolveEntity(client, chatId);
                const participant = await client.getEntity(usernameOrId);
                
                let rights;
                if (action === 'ban') {
                    rights = new Api.ChatBannedRights({
                        untilDate: 0,
                        viewMessages: true,
                        sendMessages: true,
                        sendMedia: true,
                        sendStickers: true,
                        sendGifs: true,
                        embedLinks: true
                    });
                } else if (action === 'kick') {
                    rights = new Api.ChatBannedRights({
                        untilDate: 0,
                        viewMessages: true,
                        sendMessages: true
                    });
                } else if (action === 'mute') {
                    rights = new Api.ChatBannedRights({
                        untilDate: 0,
                        viewMessages: false,
                        sendMessages: true
                    });
                } else if (action === 'unban' || action === 'unmute') {
                    rights = new Api.ChatBannedRights({
                        untilDate: 0,
                        viewMessages: false,
                        sendMessages: false,
                        sendMedia: false,
                        sendStickers: false,
                        sendGifs: false,
                        embedLinks: false
                    });
                }

                await client.invoke(new Api.channels.EditBanned({
                    channel,
                    participant,
                    bannedRights: rights
                }));
                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });
    }

    async createForumTopic(accountId, chatId, title) {
        return this.withAccount(accountId, async (client) => {
            try {
                const channel = await this.resolveEntity(client, chatId);
                const res = await client.invoke(new Api.channels.CreateForumTopic({
                    channel,
                    title
                }));
                return { success: true, topic: res };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });
    }

    async editForumTopic(accountId, chatId, topicId, title, closed) {
        return this.withAccount(accountId, async (client) => {
            try {
                const channel = await this.resolveEntity(client, chatId);
                await client.invoke(new Api.channels.EditForumTopic({
                    channel,
                    id: Number(topicId),
                    title: title || undefined,
                    closed: closed !== undefined ? closed : undefined
                }));
                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });
    }

    async executeQuickAction(accountId, chatId, actionType, payload) {
        return this.withAccount(accountId, async (client) => {
            try {
                const target = await this.resolveEntity(client, chatId);
                if (actionType === 'send_text') {
                    await this.simulateTyping(client, target, 'text');
                    await client.sendMessage(target, {
                        message: payload.message,
                        parseMode: payload.parseMode || 'html'
                    });
                } else if (actionType === 'send_photo') {
                    const base64Data = payload.image.replace(/^data:image\/\w+;base64,/, "");
                    const buffer = Buffer.from(base64Data, 'base64');
                    const { CustomFile } = require('telegram/client/uploads');
                    const file = new CustomFile("photo.jpg", buffer.length, "photo.jpg", buffer);
                    await this.simulateTyping(client, target, 'photo');
                    await client.sendFile(target, {
                        file,
                        caption: payload.caption,
                        parseMode: payload.parseMode || 'html'
                    });
                } else if (actionType === 'send_location') {
                    await this.simulateHumanActivity(client, target);
                    await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
                    await this.simulateTyping(client, target, 'text');
                    await client.invoke(new Api.messages.SendMedia({
                        peer: target,
                        media: new Api.InputMediaGeoPoint({
                            geoPoint: new Api.InputGeoPoint({
                                lat: Number(payload.lat),
                                long: Number(payload.long)
                            })
                        }),
                        message: ""
                    }));
                } else if (actionType === 'send_poll') {
                    const pollQuestion = typeof Api.TextWithEntities === 'function'
                        ? new Api.TextWithEntities({ text: payload.question, entities: [] })
                        : payload.question;

                    const pollAnswers = payload.options.map((opt, idx) => {
                        const textObj = typeof Api.TextWithEntities === 'function'
                            ? new Api.TextWithEntities({ text: opt, entities: [] })
                            : opt;
                        return new Api.PollAnswer({
                            text: textObj,
                            option: Buffer.from(idx.toString())
                        });
                    });

                    await this.simulateHumanActivity(client, target);
                    await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
                    await this.simulateTyping(client, target, 'text');
                    await client.invoke(new Api.messages.SendMedia({
                        peer: target,
                        media: new Api.InputMediaPoll({
                            poll: new Api.Poll({
                                id: BigInt(Date.now()),
                                question: pollQuestion,
                                answers: pollAnswers,
                                closed: false,
                                multipleChoice: false
                            })
                        }),
                        message: ""
                    }));
                } else if (actionType === 'forward') {
                    const fromPeer = await this.resolveEntity(client, payload.fromChatId);
                    await this.simulateHumanActivity(client, target);
                    await new Promise(r => setTimeout(r, 1000 + Math.random() * 1500));
                    await client.forwardMessages(target, {
                        messages: payload.messageIds,
                        fromPeer
                    });
                } else if (actionType === 'pin') {
                    await client.pinMessage(target, payload.messageId, {
                        notify: payload.notify || false
                    });
                } else if (actionType === 'unpin') {
                    await client.unpinMessage(target, payload.messageId);
                } else if (actionType === 'reaction') {
                    await client.invoke(new Api.messages.SendReaction({
                        peer: target,
                        msgId: payload.messageId,
                        reaction: [new Api.ReactionEmoji({ emoticon: payload.emoticon })]
                    }));
                } else if (actionType === 'edit_message') {
                    await client.editMessage(target, {
                        message: payload.messageId,
                        text: payload.text
                    });
                } else if (actionType === 'delete_message') {
                    await client.deleteMessages(target, [payload.messageId], {
                        revoke: payload.revoke !== undefined ? payload.revoke : true
                    });
                } else {
                    return { success: false, error: 'Unknown action type: ' + actionType };
                }
                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });
    }

    async searchGlobalChats(accountId, query) {
        return this.withAccount(accountId, async (client) => {
            try {
                const result = await client.invoke(new Api.contacts.Search({
                    q: query,
                    limit: 20
                }));
                const chats = (result.chats || []).map(c => {
                    let type = 'Group';
                    if (c.className === 'Channel') {
                        type = c.broadcast ? 'Channel' : 'Group';
                    }
                    return {
                        id: c.id.toString(),
                        title: c.title,
                        username: c.username || '',
                        participantsCount: c.participantsCount || null,
                        type
                    };
                });
                // Sắp xếp các nhóm có nhiều thành viên hơn lên đầu
                chats.sort((a, b) => (b.participantsCount || 0) - (a.participantsCount || 0));
                return { success: true, chats };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });
    }

    async getParticipants(accountId, chatId, limit = 100, offset = 0) {
        return this.withAccount(accountId, async (client) => {
            try {
                const entity = await this.resolveEntity(client, chatId);
                if (entity.className === 'Channel') {
                    const res = await client.invoke(new Api.channels.GetParticipants({
                        channel: entity,
                        filter: new Api.ChannelParticipantsRecent(),
                        offset: Number(offset) || 0,
                        limit: Number(limit) || 100,
                        hash: BigInt(0)
                    }));
                    const users = (res.users || []).map(u => ({
                        id: u.id.toString(),
                        firstName: u.firstName || '',
                        lastName: u.lastName || '',
                        username: u.username || '',
                        phone: u.phone || '',
                        bot: u.bot || false
                    }));
                    return { success: true, participants: users };
                } else if (entity.className === 'Chat') {
                    const res = await client.invoke(new Api.messages.GetFullChat({
                        chatId: entity.id
                    }));
                    const users = (res.users || []).map(u => ({
                        id: u.id.toString(),
                        firstName: u.firstName || '',
                        lastName: u.lastName || '',
                        username: u.username || '',
                        phone: u.phone || '',
                        bot: u.bot || false
                    }));
                    return { success: true, participants: users };
                } else {
                    return { success: false, error: 'Không phải là nhóm hoặc kênh (Not a group/channel)' };
                }
            } catch (err) {
                return { success: false, error: err.message };
            }
        });
    }

    async updateGroupProfile(accountId, chatId, { title, about, base64Photo }) {
        return this.withAccount(accountId, async (client) => {
            try {
                const entity = await this.resolveEntity(client, chatId);
                
                // 1. Update Title
                if (title !== undefined && title.trim() !== '') {
                    if (entity.className === 'Channel') {
                        await client.invoke(new Api.channels.EditTitle({ channel: entity, title }));
                    } else if (entity.className === 'Chat') {
                        await client.invoke(new Api.messages.EditChatTitle({ chatId: entity.id, title }));
                    }
                }
                
                // 2. Update Description
                if (about !== undefined) {
                    await client.invoke(new Api.messages.EditChatAbout({ peer: entity, about }));
                }

                // 3. Update Photo
                if (base64Photo) {
                    const base64Data = base64Photo.replace(/^data:image\/\w+;base64,/, "");
                    const buffer = Buffer.from(base64Data, 'base64');
                    const { CustomFile } = require('telegram/client/uploads');
                    const file = await client.uploadFile({
                        file: new CustomFile("group_avatar.jpg", buffer.length, "group_avatar.jpg", buffer),
                        workers: 1
                    });
                    
                    if (entity.className === 'Channel') {
                        await client.invoke(new Api.channels.EditPhoto({
                            channel: entity,
                            photo: new Api.InputChatUploadedPhoto({ file })
                        }));
                    } else if (entity.className === 'Chat') {
                        await client.invoke(new Api.messages.EditChatPhoto({
                            chatId: entity.id,
                            photo: new Api.InputChatUploadedPhoto({ file })
                        }));
                    }
                }

                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });
    }

    async editAdmin(accountId, chatId, userId, adminRights, rank) {
        return this.withAccount(accountId, async (client) => {
            try {
                const channel = await this.resolveEntity(client, chatId);
                const user = await client.getEntity(userId);

                if (channel.className !== 'Channel') {
                    return { success: false, error: 'Chức năng bổ nhiệm Admin nâng cao chỉ hỗ trợ Siêu nhóm (Supergroup) và Kênh (Channel)' };
                }

                const rights = new Api.ChatAdminRights({
                    changeInfo: adminRights.changeInfo !== undefined ? !!adminRights.changeInfo : true,
                    postMessages: adminRights.postMessages !== undefined ? !!adminRights.postMessages : true,
                    editMessages: adminRights.editMessages !== undefined ? !!adminRights.editMessages : true,
                    deleteMessages: adminRights.deleteMessages !== undefined ? !!adminRights.deleteMessages : true,
                    banUsers: adminRights.banUsers !== undefined ? !!adminRights.banUsers : true,
                    inviteUsers: adminRights.inviteUsers !== undefined ? !!adminRights.inviteUsers : true,
                    pinMessages: adminRights.pinMessages !== undefined ? !!adminRights.pinMessages : true,
                    addAdmins: adminRights.addAdmins !== undefined ? !!adminRights.addAdmins : false,
                    anonymous: adminRights.anonymous !== undefined ? !!adminRights.anonymous : false,
                    manageCall: adminRights.manageCall !== undefined ? !!adminRights.manageCall : true,
                    other: adminRights.other !== undefined ? !!adminRights.other : true
                });

                await client.invoke(new Api.channels.EditAdmin({
                    channel,
                    userId: user,
                    adminRights: rights,
                    rank: rank || ''
                }));
                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });
    }

    async clickBotButton(accountId, chatId, messageId, buttonData) {
        return this.withAccount(accountId, async (client) => {
            try {
                const peer = await this.resolveEntity(client, chatId);
                const data = Buffer.from(buttonData, 'base64');
                const res = await client.invoke(new Api.messages.GetBotCallbackAnswer({
                    peer,
                    msgId: Number(messageId),
                    data: data
                }));
                return { success: true, answer: res };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });
    }

    async joinChat(accountId, linkOrUsername) {
        return this.withAccount(accountId, async (client) => {
            try {
                let hash = '';
                let publicUsername = '';
                const link = linkOrUsername.trim();

                if (link.includes('+')) hash = link.split('+')[1].split('?')[0];
                else if (link.includes('joinchat/')) hash = link.split('joinchat/')[1].split('?')[0];
                else if (link.includes('t.me/')) publicUsername = link.split('t.me/')[1].split('/')[0].split('?')[0];
                else publicUsername = link.replace('@', '');

                let targetPeer = publicUsername;
                if (hash) {
                    const res = await client.invoke(new Api.messages.ImportChatInvite({ hash }));
                    if (res && res.chats && res.chats.length > 0) {
                        targetPeer = res.chats[0].id.toString();
                    }
                } else if (publicUsername) {
                    await client.invoke(new Api.channels.JoinChannel({ channel: publicUsername }));
                } else {
                    throw new Error('Đường dẫn hoặc username không hợp lệ');
                }

                if (targetPeer) {
                    await new Promise(r => setTimeout(r, 1000 + Math.random() * 1500));
                    await this.simulateHumanActivity(client, targetPeer);
                }

                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });
    }

    async getInviteLink(accountId, chatId) {
        return this.withAccount(accountId, async (client) => {
            try {
                const entity = await this.resolveEntity(client, chatId);
                let fullChat;
                if (entity.className === 'Channel') {
                    const res = await client.invoke(new Api.channels.GetFullChannel({ channel: entity }));
                    fullChat = res.fullChat;
                } else if (entity.className === 'Chat') {
                    const res = await client.invoke(new Api.messages.GetFullChat({ chatId: entity.id }));
                    fullChat = res.fullChat;
                } else {
                    return { success: false, error: 'Không hỗ trợ loại chat này' };
                }

                if (fullChat && fullChat.exportedInvite && fullChat.exportedInvite.link) {
                    return { success: true, link: fullChat.exportedInvite.link };
                }

                // Try to export a new invite link if it doesn't exist
                try {
                    const res = await client.invoke(new Api.messages.ExportChatInvite({
                        peer: entity
                    }));
                    if (res && res.link) {
                        return { success: true, link: res.link };
                    }
                } catch (e) {
                    console.error('[Export Invite Link Error]', e.message);
                }

                return { success: false, error: 'Không thể lấy link mời. Bạn cần có quyền Quản trị viên mời thành viên.' };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });
    }
}

module.exports = new TelegramMultiClient();






