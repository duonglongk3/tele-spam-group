const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');
const { NewMessage } = require('telegram/events');
const TelegramAccount = require('./models/TelegramAccount');

class TelegramMultiClient {
    constructor() {
        this.clients = new Map();   // Map<accountId, TelegramClient>
        this.accounts = new Map();  // Map<accountId, info>
    }

    async init(store) {
        this.store = store; // Keep store ref if needed elsewhere, but mostly obsolete
        try {
            const savedAccounts = await TelegramAccount.find();
            // Không dùng await để block việc render app
            for (const accDoc of savedAccounts) {
                const acc = {
                    id: accDoc.accountId,
                    apiId: accDoc.apiId,
                    apiHash: accDoc.apiHash,
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
        } catch(err) {
            console.error('[TelegramService] DB Init error:', err);
        }
    }

    async connectAccount(account) {
        const session = new StringSession(account.sessionString);
        const client = new TelegramClient(session, Number(account.apiId), account.apiHash, {
            connectionRetries: 5,
        });
        client.setLogLevel('none'); // KHÔNG IN LOG RÁC CỦA GRAMJS RA CONSOLE

        try {
            await client.connect();
            const me = await client.getMe();
            this.clients.set(account.id, client);

            // --- Inbox Monitor (Reply Catcher) ---
            client.addEventHandler(async (event) => {
                try {
                    const msg = event.message;
                    if (msg && msg.mentioned && !msg.out) {
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
            // ------------------------------------
            
            let about = '';
            try {
                const fullMe = await client.invoke(new Api.users.GetFullUser({ id: 'me' }));
                about = fullMe.fullUser.about || '';
            } catch (e) {}

            const accInfo = {
                id: account.id,
                apiId: account.apiId,
                apiHash: account.apiHash,
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
            return accInfo;
        } catch (err) {
            console.error(`[Telegram] Failed to connect ${account.id}:`, err.message);
            this.accounts.set(account.id, { ...account, connected: false, error: err.message });
            return { error: err.message };
        }
    }

    async _saveAccounts() {
        try {
            // Upsert all accounts in memory to MongoDB
            for (const account of this.accounts.values()) {
                await TelegramAccount.findOneAndUpdate(
                    { accountId: account.id },
                    {
                        apiId: account.apiId,
                        apiHash: account.apiHash,
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
    async requestLoginCode(apiId, apiHash, phone) {
        const session = new StringSession('');
        const client = new TelegramClient(session, Number(apiId), apiHash, { connectionRetries: 2 });
        client.setLogLevel('none');

        try {
            await client.connect();
            const result = await client.sendCode({ apiId: Number(apiId), apiHash }, phone);
            this._tempAuthClient = client;
            this._tempAuthPhone = phone;
            this._tempAuthPhoneCodeHash = result.phoneCodeHash;
            this._tempApiId = apiId;
            this._tempApiHash = apiHash;
            return { success: true, phoneCodeHash: result.phoneCodeHash };
        } catch (err) {
            await client.disconnect();
            return { success: false, error: err.message };
        }
    }

    async submitLoginCode(code, password = '') {
        try {
            const client = this._tempAuthClient;
            if (!client) throw new Error("No pending auth");

            if (password) {
                const { computeCheck } = require('telegram/Password');
                const passwordParams = await client.invoke(new Api.account.GetPassword());
                const checkPwd = await computeCheck(passwordParams, password);
                await client.invoke(new Api.auth.CheckPassword({ password: checkPwd }));
            } else {
                await client.invoke(new Api.auth.SignIn({
                    phoneNumber: this._tempAuthPhone,
                    phoneCodeHash: this._tempAuthPhoneCodeHash,
                    phoneCode: code
                })).catch((err) => {
                    if (err.message.includes('SESSION_PASSWORD_NEEDED')) {
                        throw new Error('SESSION_PASSWORD_NEEDED');
                    }
                    throw err;
                });
            }

            const me = await client.getMe();
            const sessionString = client.session.save();
            const accountId = me.id.toString();

            if (this.clients.has(accountId)) {
                try { await this.clients.get(accountId).disconnect(); } catch (_) {}
            }

            // --- Inbox Monitor (Reply Catcher) ---
            client.addEventHandler(async (event) => {
                try {
                    const msg = event.message;
                    // mentioned == bị tag tên HOẶC có người bấm vào nút Reply nhắn tin của Acc
                    if (msg && msg.mentioned && !msg.out) {
                        const text = msg.message || '[Có đính kèm file/ảnh]';
                        const senderName = msg.sender ? (msg.sender.firstName || msg.sender.username || 'Ai đó') : 'Khách';
                        let groupName = 'Nhóm/Chat Cá Nhân';
                        if (msg.chat && msg.chat.title) groupName = msg.chat.title;
                        
                        // Lấy Link nếu là group public
                        let messageLink = '';
                        if (msg.chat && msg.chat.username) {
                            messageLink = `\n👉 Link tin nhắn: https://t.me/${msg.chat.username}/${msg.id}`;
                        } else if (msg.chatId) {
                            // Extract raw id to create a possible fallback link
                            let cleanId = msg.chatId.toString().replace('-100', '');
                            messageLink = `\n👉 Link (Private): https://t.me/c/${cleanId}/${msg.id}`;
                        }

                        const alertText = `🚨 **Có khách Hú/Reply kìa sếp!**\n\n👤 Từ: ${senderName}\n🏢 Group: ${groupName}\n💬 Trạm gửi: ${me.firstName}\n\n📝 Bình luận: "${text}"${messageLink}`;
                        
                        const botService = require('./botService');
                        botService.notifyAdmin(alertText);
                    }
                } catch(e) {
                    console.error('Inbox Monitor Error:', e);
                }
            }, new NewMessage({ incoming: true }));
            // ------------------------------------

            let about = '';
            try {
                const fullMe = await client.invoke(new Api.users.GetFullUser({ id: 'me' }));
                about = fullMe.fullUser.about || '';
            } catch (e) {}

            this.clients.set(accountId, client);
            this.accounts.set(accountId, {
                id: accountId, apiId: this._tempApiId, apiHash: this._tempApiHash,
                sessionString, firstName: me.firstName, lastName: me.lastName,
                username: me.username, phone: me.phone, about, connected: true,
            });
            this._saveAccounts();
            return { success: true, account: this.accounts.get(accountId) };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // ─── LOGIN: Import Session String ──────────────────
    async importSession(apiId, apiHash, sessionString) {
        let session;
        try {
            session = new StringSession(sessionString);
        } catch (err) {
            return { success: false, error: "Định dạng Session không hợp lệ (Not a valid string). Vui lòng copy chính xác." };
        }
        
        // Giảm retry xuống 1 để fail nhanh nếu session rác
        const client = new TelegramClient(session, Number(apiId), apiHash, { connectionRetries: 1 });
        client.setLogLevel('none'); // Tắt log rác hiển thị ra terminal

        try {
            await client.connect();
            const me = await client.getMe();
            const accountId = me.id.toString();

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
                id: accountId, apiId, apiHash, sessionString,
                firstName: me.firstName, lastName: me.lastName,
                username: me.username, phone: me.phone, about, connected: true,
            });
            this._saveAccounts();
            return { success: true, account: this.accounts.get(accountId) };
        } catch (err) {
            try { await client.disconnect(); } catch (_) {}
            return { success: false, error: err.message };
        }
    }

    async removeAccount(accountId) {
        if (this.clients.has(accountId)) {
            try { await this.clients.get(accountId).disconnect(); } catch (_) {}
            this.clients.delete(accountId);
        }
        this.accounts.delete(accountId);
        try {
            await TelegramAccount.findOneAndDelete({ accountId });
        } catch (err) {
            console.error(err);
        }
        return { success: true };
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
                if (hash) {
                    await client.invoke(new Api.messages.ImportChatInvite({ hash }));
                } else if (publicUsername) {
                    await client.invoke(new Api.channels.JoinChannel({ channel: publicUsername }));
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
            // Delay chối chết (2s)
            await new Promise(r => setTimeout(r, 2000));
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

    // ─── FORUM TOPICS ──────────────────────────────────
    async getForumTopics(accountId, chatId) {
        return this.withAccount(accountId, async (client) => {
            try {
                const entity = await client.getEntity(chatId);
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
    async getMessages(accountId, chatId, limit = 30) {
        return this.withAccount(accountId, async (client) => {
            const entity = await client.getEntity(chatId);
            const messages = await client.getMessages(entity, { limit });
            return messages.map(m => ({
                id: m.id,
                text: m.text || '',
                date: m.date,
                hasMedia: !!m.media,
                mediaType: m.media?.className || null,
                fromId: m.fromId?.userId?.toString() || null,
            }));
        });
    }

    async getMessageMedia(accountId, chatId, messageId) {
        return this.withAccount(accountId, async (client) => {
            const entity = await client.getEntity(chatId);
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
                const entity = await client.getEntity(chatId);
                const result = {
                    adminBots: [],
                    messagesScanned: 0,
                    normalUserLinks: 0,
                    normalUserTags: 0,
                    normalUserForwards: 0,
                    success: true
                };

                // 1. Scan Admins for Bots
                try {
                    const participants = await client.invoke(
                        new Api.channels.GetParticipants({
                            channel: entity,
                            filter: new Api.ChannelParticipantsAdmins(),
                            offset: 0,
                            limit: 100,
                            hash: BigInt(0),
                        })
                    );
                    const adminIds = new Set();
                    if (participants && participants.users) {
                        for (let u of participants.users) {
                            adminIds.add(u.id.toString());
                            if (u.bot) {
                                result.adminBots.push(`@${u.username || u.firstName}`);
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
            const fromEntity = await client.getEntity(fromChatId);
            const results = [];
            for (const toChatId of toChatIds) {
                try {
                    const toEntity = await client.getEntity(toChatId);
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
                        const fromEntity = await client.getEntity(source.fromChatId);
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

                        // Kiểm tra Bot Inline (nếu cần tương lai)
                        if (rights.sendInline && (result.content.hasTags || result.content.hasLinks)) {
                            if (report.status !== 'ERROR') report.status = 'WARNING';
                            report.reasons.push('Cảnh báo: Nhóm chặn Bot Inline, có thể bị lỗi nếu dùng bot để tạo phím bấm/share.');
                        }

                        // Kiểm tra Forward chống Anti-Spam Bot
                        if (campaignPayload.type === 'forward') {
                            try {
                                const entity = await client.getEntity(target.chatId);
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
                            }
                        }
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
    async addMember(accountId, groupId, userId) {
        return this.withAccount(accountId, async (client) => {
            const channel = await client.getEntity(groupId);
            const user = await client.getEntity(userId);
            await client.invoke(new Api.channels.InviteToChannel({ channel, users: [user] }));
            return { success: true };
        });
    }

    async removeMember(accountId, groupId, userId) {
        return this.withAccount(accountId, async (client) => {
            const channel = await client.getEntity(groupId);
            const user = await client.getEntity(userId);
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
                const peer = peerId ? await client.getEntity(peerId) : 'me';
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
}

module.exports = new TelegramMultiClient();
