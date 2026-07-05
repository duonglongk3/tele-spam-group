const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const https = require('https');
const GlobalSetting = require('./models/Setting');
const PostCampaign = require('./models/PostCampaign');
const PostLog = require('./models/PostLog');

let bot = null;
let adminChatId = undefined;
let aiLeadPendingBacklogNotified = false;
const wizardSessions = new Map();

function renderWizard(ctx) {
   const payload = wizardSessions.get(ctx.chat.id.toString());
   if (!payload) return;
   
   let info = `🛠 BẢN NHÁP CHIẾN DỊCH
Loại: ${payload.type}
Tên CD: ${payload.name || 'Bot_Camp_...'}
Tốc độ: ${payload.schedule}
Acc: ${payload.accounts?.length || 0} | Target: ${payload.targets?.length || 0}
Số lượng Ảnh đính kèm: ${payload.imagePaths?.length || 0}`;

   const buttons = [
      [Markup.button.callback('✏️ Đổi Tên Chiến Dịch', 'wizard_rename')],
      [Markup.button.callback('🔗 Kế thừa Target từ CD Khác', 'wizard_inherit')],
      [Markup.button.callback('🌍 Quét Toàn Bộ Group hiện có', 'wizard_auto_all')],
      [Markup.button.callback('⏱ Đổi Tốc Độ Gửi (Delay)', 'wizard_speed')]
   ];

   if (payload.targets && payload.targets.length > 0) {
      buttons.push([Markup.button.callback('✅ CHỐT: Tạo Chiến Dịch Này', 'wizard_create')]);
   }

   ctx.reply(info, Markup.inlineKeyboard(buttons));
}


function formatAiLeadPendingCard(item) {
  return [
    'AI Lead pending backlog',
    `ID: ${item._id}`,
    `Tên nhóm: ${item.chatTitle}`,
    `Người gửi: ${item.senderName}`,
    `Score: ${item.score} | Category: ${item.category}`,
    '',
    `Nội dung gửi:\n${String(item.originalText || '').slice(0, 700)}`,
    '',
    `Nội dung bot định trả lời:\n${item.suggestedReply}`,
  ].join('\n');
}

function aiLeadApprovalButtons(item) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Đồng ý', callback_data: `ailead:send:${item._id}` },
          { text: 'Từ chối', callback_data: `ailead:skip:${item._id}` },
        ],
      ],
    },
  };
}

function notifyAiLeadPendingBacklog(limit = 20) {
  if (aiLeadPendingBacklogNotified) return;
  aiLeadPendingBacklogNotified = true;
  setTimeout(async () => {
    try {
      const AiLeadQueue = require('./models/AiLeadQueue');
      const pending = (await AiLeadQueue.findRecent({ status: 'pending' }, limit * 3))
        .filter((item) => !item.adminNotifiedAt && !item.autoSendAt && !item.autoSendScheduledAt)
        .slice(0, limit);
      if (!pending.length) return;
      console.log(`[AILead] Re-notifying ${pending.length} unnotified pending approval rows to admin bot`);
      for (const item of pending) {
        const ok = await notifyAdmin(formatAiLeadPendingCard(item), null, aiLeadApprovalButtons(item));
        if (ok) {
          await AiLeadQueue.update(item._id, {
            adminNotifiedAt: new Date().toISOString(),
            adminNotifyCount: Number(item.adminNotifyCount || 0) + 1,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    } catch (err) {
      console.error('[AILead] pending backlog notify error:', err.message);
    }
  }, 1500);
}
async function initBot(options = {}) {
  const {
    silent = false,
    setupWebhook = true,
    notifyBacklog = true,
  } = options;
  const setting = await GlobalSetting.findOne({ type: 'global_app_settings' });
  if (!setting || !setting.telegramBotToken) {
    console.log('[Telegram Bot] Bỏ qua khởi tạo vì chưa có Tham số Token');
    return null;
  }

  adminChatId = setting.telegramAdminChatId;

  if (bot) {
    try {
      bot.stop('SIGINT');
    } catch (e) {}
  }

  bot = new Telegraf(setting.telegramBotToken);
  bot.catch((err, ctx) => {
    console.error('[Telegram Bot] handler error:', err);
    ctx?.reply?.(`Lỗi bot: ${err.message}`).catch(() => {});
  });

  // Global Auth Middleware
  bot.use(async (ctx, next) => {
    // Cho phép lệnh /start đi qua để bắt trường hợp pairing
    if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/start')) {
      return next();
    }
    // Block nếu không phải admin
    if (adminChatId && ctx.chat.id.toString() !== adminChatId) {
      return ctx.reply('⛔ Bạn không có quyền sử dụng Bot này!');
    }
    return next();
  });

  // --- Commands ---
  bot.start(async (ctx) => {
    const payload = ctx.message.text.split(' ')[1]; // Lấy token từ /start TOKEN
    const setting = await GlobalSetting.findOne({ type: 'global_app_settings' });
    
    if (payload && setting.telegramPairToken && payload === setting.telegramPairToken) {
      // Đăng ký Admin
      setting.telegramAdminChatId = ctx.chat.id.toString();
      await setting.save();
      adminChatId = setting.telegramAdminChatId;
      return ctx.reply('✅ Xác thực thành công! Bắt đầu từ bây giờ, Bot này chỉ phản hồi bạn và sẽ gửi cảnh báo từ Tool Auto Post vào đây.');
    }

    if (!adminChatId || ctx.chat.id.toString() !== adminChatId) {
      return ctx.reply('⛔ Bạn không có quyền sử dụng Bot này! Vui lòng dùng link kết nối (Pairing Link) từ ứng dụng.');
    }

    ctx.reply(`👋 Xin chào GĐ!
    
🔧 Quản lý Chiến dịch:
/campaigns - Danh sách các chiến dịch
/resume [id] - Chạy lại 1 chiến dịch
/stop [id] - Dừng 1 chiến dịch
/resume_all - Chạy toàn bộ
/pause_all - Dừng toàn bộ
/speed [id] [60-120] - Đổi tốc độ gửi

🔍 Theo dõi & Cấp cứu:
/stats - Thống kê Auto Post tổng hôm nay
/live [id] - Xem tiến độ của 1 chiến dịch
/info [id] - Chi tiết cấu hình của 1 chiến dịch
/fix_targets - Ân xá các nhóm bị lỗi (Bỏ chặn)
/accounts - Danh sách TK Telegram đang dùng
/ping - Kiểm tra hệ thống

🚀 Sát Thủ MMO Công Cụ:
/join [link] - Điều động All Account chui vào Group
👉 Forward Tin / Gửi Ảnh / Chuyển Tiếp Link: Sẽ mở lò tạo Tốc hành Chiến Dịch mới thẳng vào Database!`);
  });

  bot.command('stats', async (ctx) => {
    const today = new Date();
    today.setHours(0,0,0,0);
    const success = await PostLog.countDocuments({ status: 'success', createdAt: { $gte: today } });
    const fail = await PostLog.countDocuments({ status: 'fail', createdAt: { $gte: today } });
    const cCount = await PostCampaign.countDocuments();
    ctx.reply(`📊 Thống kê Auto Post Hôm Nay:\n\n✅ Thành công: ${success}\n❌ Thất bại: ${fail}\n🚀 Tổng số chiến dịch: ${cCount}`);
  });

  bot.command('campaigns', async (ctx) => {
    const campaigns = await PostCampaign.find().lean();
    if (!campaigns.length) return ctx.reply('Chưa có chiến dịch nào');
    const msg = campaigns.map(c => `• ${c.name} \n  ID: <code>${c._id}</code> \n  Trạng thái: ${c.isRunning ? '🟢 Đang chạy' : '🔴 Tạm dừng'} \n  (Targets: ${c.targets.length})`).join('\n\n');
    ctx.reply(`📋 Chiến dịch của bạn:\n\n${msg}\n\n👉 Dùng /stop [ID] để tạm dừng. Ví dụ: /stop 64a123...`, { parse_mode: 'HTML' });
  });

  bot.command('stop', async (ctx) => {
    const id = ctx.message.text.split(' ')[1];
    if (!id) return ctx.reply('Nhập ID chiến dịch. Ví dụ: /stop 64a...');
    try {
      const c = await PostCampaign.findById(id);
      if (!c) return ctx.reply('Không tìm thấy chiến dịch!');
      c.isRunning = false;
      await c.save();
      ctx.reply(`🔴 Đã DỪNG chiến dịch: ${c.name}`);
    } catch(e) {
      if (e.name === 'CastError') return ctx.reply('ID chiến dịch không đúng định dạng');
      ctx.reply('Lỗi: ' + e.message);
    }
  });

  bot.command('resume', async (ctx) => {
    const id = ctx.message.text.split(' ')[1];
    if (!id) return ctx.reply('Nhập ID chiến dịch. Ví dụ: /resume 64a...');
    try {
      const c = await PostCampaign.findById(id);
      if (!c) return ctx.reply('Không tìm thấy chiến dịch!');
      c.isRunning = true;
      await c.save();
      ctx.reply(`🟢 Đã CHẠY LẠI chiến dịch: ${c.name}`);
    } catch(e) {
      ctx.reply('Lỗi: ' + e.message);
    }
  });

  bot.command('pause_all', async (ctx) => {
    try {
      await PostCampaign.updateMany({}, { isRunning: false });
      ctx.reply('🔴 Đã DỪNG TOÀN BỘ chiến dịch.');
    } catch(e) { ctx.reply('Lỗi: ' + e.message); }
  });

  bot.command('resume_all', async (ctx) => {
    try {
      await PostCampaign.updateMany({}, { isRunning: true });
      ctx.reply('🟢 Đã CHẠY TOÀN BỘ chiến dịch.');
    } catch(e) { ctx.reply('Lỗi: ' + e.message); }
  });

  bot.command('speed', async (ctx) => {
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply('Nhập sai cú pháp. Ví dụ: /speed 64a... 30-60');
    const id = parts[1];
    const schedule = parts.slice(2).join(' ');
    try {
      const c = await PostCampaign.findById(id);
      if (!c) return ctx.reply('Không tìm thấy chiến dịch!');
      c.schedule = schedule;
      // Scheduler ở trạm sẽ tự động áp dụng vòng lặp random/fixed mới ở tick tiếp theo
      await c.save();
      ctx.reply(`⚡ Đã Cập Nhật tốc độ chiến dịch ${c.name} thành: ${schedule}`);
    } catch(e) {
      ctx.reply('Lỗi: ' + e.message);
    }
  });

  bot.command('live', async (ctx) => {
    const id = ctx.message.text.split(' ')[1];
    if (!id) return ctx.reply('Nhập ID chiến dịch. Ví dụ: /live 64a...');
    try {
      const c = await PostCampaign.findById(id);
      if (!c) return ctx.reply('Không tìm thấy!');
      const success = await PostLog.countDocuments({ campaignId: id, status: 'success' });
      const fail = await PostLog.countDocuments({ campaignId: id, status: 'fail' });
      const activeTargets = c.targets.filter(t => !t.isDisabled).length;
      const disabledTargets = c.targets.length - activeTargets;
      
      const text = `📡 <b>LIVE: ${c.name}</b>
Trạng thái: ${c.isRunning ? '🟢 Đang chạy' : '🔴 Tạm dừng'}
Tốc độ gốc: <code>${c.schedule}</code>
Mục tiêu Targets: ${activeTargets} đang chạy, ${disabledTargets} bị lỗi/chặn.
Nhật ký: ✅ ${success} | ❌ ${fail}`;
      ctx.reply(text, { parse_mode: 'HTML' });
    } catch(e) {
       ctx.reply('Lỗi: ' + e.message);
    }
  });

  bot.command('info', async (ctx) => {
    const id = ctx.message.text.split(' ')[1];
    if (!id) return ctx.reply('Nhập ID chiến dịch. Ví dụ: /info 64a...');
    try {
      const c = await PostCampaign.findById(id).lean();
      if (!c) return ctx.reply('Không tìm thấy!');
      
      const typeStr = c.type === 'forward' ? 'Chuyển Tiếp' : (c.type === 'photo' ? 'Có Hình Ảnh' : (c.type === 'quote' ? 'Trích Dẫn (Quote)' : 'Đoạn Text'));
      const infoText = `📋 <b>CHI TIẾT: ${c.name}</b>
ID: <code>${c._id}</code>
Loại: ${typeStr}
Account cấp phép: ${c.accounts.length}
Target số lượng: ${c.targets.length} Group/Channel
Tốc độ cấu hình: <code>${c.schedule}</code>

<i>— Mẫu nội dung —</i>
${c.contentTemplate ? c.contentTemplate.substring(0, 150) + '...' : '(Do Cấu hình Gốc/File Forward định dạng đính kèm)'}

👉 Dùng /live ${c._id} để xem tiến độ Live`;
      ctx.reply(infoText, { parse_mode: 'HTML' });
    } catch(e) {
       ctx.reply('Lỗi: ' + e.message);
    }
  });

  bot.command('fix_targets', async (ctx) => {
    try {
      const campaigns = await PostCampaign.find();
      let fixedCount = 0;
      for (const c of campaigns) {
        let changed = false;
        c.targets.forEach(t => {
          if (t.isDisabled) {
            t.isDisabled = false;
            t.lastError = '';
            changed = true;
            fixedCount++;
          }
        });
        if (changed) await c.save();
      }
      ctx.reply(`🚑 Đã ân xá và phục hồi ${fixedCount} Nhóm/Channel bị lỗi.`);
    } catch(e) { ctx.reply('Lỗi: ' + e.message); }
  });

  bot.command('accounts', async (ctx) => {
    try {
      const telegramService = require('./telegramService');
      const accounts = await telegramService.getAccounts();
      if (!accounts || accounts.length === 0) return ctx.reply('Chưa có tài khoản nào đăng nhập.');
      const msg = accounts.map((a, i) => `👤 ${i+1}. [${a.id}]: ${a.firstName} ${a.lastName || ''} (@${a.username || 'null'})`).join('\n');
      ctx.reply(`📱 Danh sách tài khoản Telegram:\n${msg}`);
    } catch(e) { ctx.reply('Lỗi: ' + e.message); }
  });

  bot.command('ai_lead', async (ctx) => {
    try {
      const parts = ctx.message.text.split(' ');
      const action = (parts[1] || 'status').toLowerCase();
      const setting = await GlobalSetting.findOne({ type: 'global_app_settings' }) || new GlobalSetting({ type: 'global_app_settings' });

      if (action === 'on' || action === 'off') {
        setting.aiLeadEnabled = action === 'on';
        await setting.save();
        return ctx.reply(`AI Lead Watcher: ${setting.aiLeadEnabled ? 'ON' : 'OFF'}`);
      }

      if (action === 'mode') {
        const mode = (parts[2] || '').toLowerCase();
        if (!['suggest', 'auto'].includes(mode)) return ctx.reply('Cú pháp: /ai_lead mode suggest|auto');
        setting.aiLeadMode = mode;
        await setting.save();
        return ctx.reply(`AI Lead mode đã đổi thành: ${mode}`);
      }

      if (action === 'accounts') {
        const raw = parts.slice(2).join(' ').trim();
        if (!raw) return ctx.reply('Cú pháp: /ai_lead accounts all hoặc /ai_lead accounts id1,id2');
        setting.aiLeadAccountIds = raw.toLowerCase() === 'all'
          ? []
          : raw.split(/[,\s]+/).map(v => v.trim()).filter(Boolean);
        await setting.save();
        return ctx.reply(setting.aiLeadAccountIds.length ? `AI Lead chỉ chạy trên account: ${setting.aiLeadAccountIds.join(', ')}` : 'AI Lead chạy trên tất cả account.');
      }

      if (action === 'score') {
        const score = Number(parts[2]);
        if (!Number.isFinite(score) || score < 1 || score > 100) return ctx.reply('Cú pháp: /ai_lead score 85');
        setting.aiLeadMinScore = score;
        await setting.save();
        return ctx.reply(`AI Lead min score: ${score}`);
      }

      if (action === 'limit') {
        const daily = Number(parts[2]);
        const group = Number(parts[3]);
        const cooldown = Number(parts[4]);
        if (![daily, group, cooldown].every(v => Number.isFinite(v) && v >= 1)) {
          return ctx.reply('Cú pháp: /ai_lead limit [dailyPerAccount] [dailyPerGroup] [cooldownMinutes]\nVí dụ: /ai_lead limit 3 1 240');
        }
        setting.aiLeadMaxRepliesPerDay = daily;
        setting.aiLeadMaxRepliesPerGroupPerDay = group;
        setting.aiLeadCooldownMinutes = cooldown;
        await setting.save();
        return ctx.reply(`AI Lead limit: ${daily}/account/day, ${group}/group/day, cooldown ${cooldown} phút.`);
      }

      if (action === 'prompt') {
        const prompt = parts.slice(2).join(' ').trim();
        if (!prompt) return ctx.reply('Cú pháp: /ai_lead prompt [system prompt mới]');
        setting.aiLeadPrompt = prompt;
        await setting.save();
        return ctx.reply('Đã cập nhật AI Lead system prompt.');
      }

      if (action === 'pending') {
        const aiLeadService = require('./aiLeadService');
        const items = await aiLeadService.listPending(10);
        if (!items.length) return ctx.reply('Không có AI Lead pending reply nào.');
        const msg = items.map((item, i) => `${i + 1}. ${item._id}
[${item.score}] ${item.category} | ${item.sourceType} | ${item.chatTitle}
User: ${item.senderName}
Msg: ${item.originalText.slice(0, 120)}
Rep: ${item.suggestedReply.slice(0, 160)}
Send: /ai_lead send ${item._id}`).join('\n\n');
        return ctx.reply(`AI Lead pending replies:\n\n${msg}`);
      }

      if (action === 'send') {
        const id = parts[2];
        if (!id) return ctx.reply('Cú pháp: /ai_lead send [id]');
        const aiLeadService = require('./aiLeadService');
        const result = await aiLeadService.sendPending(id);
        if (!result.success) return ctx.reply('Không gửi được: ' + result.error);
        return ctx.reply(`Đã gửi AI Lead reply: ${result.item._id}`);
      }

      if (action === 'skip') {
        const id = parts[2];
        if (!id) return ctx.reply('Cú pháp: /ai_lead skip [id]');
        const aiLeadService = require('./aiLeadService');
        const result = await aiLeadService.skipPending(id);
        if (!result.success) return ctx.reply('Không skip được: ' + result.error);
        return ctx.reply(`Đã skip AI Lead reply: ${result.item._id}`);
      }

      if (action === 'edit') {
        const id = parts[2];
        const text = parts.slice(3).join(' ').trim();
        if (!id || !text) return ctx.reply('Cú pháp: /ai_lead edit [id] [text rep mới]');
        const aiLeadService = require('./aiLeadService');
        const result = await aiLeadService.editPending(id, text);
        if (!result.success) return ctx.reply('Không sửa được: ' + result.error);
        return ctx.reply(`Đã sửa reply ${result.item._id}:
${result.item.suggestedReply}`);
      }

      const accounts = setting.aiLeadAccountIds?.length ? setting.aiLeadAccountIds.join(', ') : 'all';
      return ctx.reply(`AI Lead Watcher
Status: ${setting.aiLeadEnabled ? 'ON' : 'OFF'}
Mode: ${setting.aiLeadMode}
Accounts: ${accounts}
Min score: ${setting.aiLeadMinScore}
Limit: ${setting.aiLeadMaxRepliesPerDay}/account/day, ${setting.aiLeadMaxRepliesPerGroupPerDay}/group/day
Cooldown: ${setting.aiLeadCooldownMinutes} phút

Lệnh:
/ai_lead on|off
/ai_lead mode suggest|auto
/ai_lead accounts all|id1,id2
/ai_lead score 85
/ai_lead limit 3 1 240
/ai_lead prompt ...
/ai_lead pending
/ai_lead send [id]
/ai_lead skip [id]
/ai_lead edit [id] [text]`);
    } catch(e) {
      ctx.reply('Lỗi AI Lead: ' + e.message);
    }
  });

  bot.action(/ailead:(send|skip):(.+)/, async (ctx) => {
    try {
      const action = ctx.match[1];
      const id = ctx.match[2];
      const aiLeadService = require('./aiLeadService');
      console.log('[Telegram Bot] AI Lead callback received:', { action, id, chatId: ctx.chat?.id?.toString?.() });
      
      const result = action === 'send'
        ? await aiLeadService.sendPending(id)
        : await aiLeadService.skipPending(id);
      
      let finalStatus = action === 'send' ? 'sent' : 'skipped';
      
      if (!result.success) {
        console.error('[Telegram Bot] AI Lead callback failed:', { action, id, error: result.error });
        
        // Nếu lỗi do item đã được xử lý từ trước (không còn pending)
        // Chúng ta sẽ đọc trạng thái hiện tại trong DB để cập nhật đúng giao diện Telegram
        if (result.error && (result.error.includes('trạng thái') || result.error.includes('status') || result.error.includes('sent') || result.error.includes('skipped'))) {
          const AiLeadQueue = require('./models/AiLeadQueue');
          const item = await AiLeadQueue.findById(id);
          if (item) {
            finalStatus = item.status;
            await ctx.answerCbQuery(`Tin nhắn này đã được xử lý trước đó (${item.status === 'sent' ? 'Đã gửi' : 'Đã bỏ qua'})`);
          } else {
            await ctx.answerCbQuery(result.error);
            return;
          }
        } else {
          await ctx.answerCbQuery(result.error || 'Không xử lý được');
          return;
        }
      } else {
        console.log('[Telegram Bot] AI Lead callback success:', { action, id, status: result.item?.status });
        await ctx.answerCbQuery(action === 'send' ? 'Đã gửi reply' : 'Đã từ chối');
        finalStatus = result.item?.status || finalStatus;
      }
      
      const statusText = finalStatus === 'sent'
        ? `✅ <b>ĐÃ ĐỒNG Ý GỬI</b> lúc ${new Date().toLocaleTimeString('vi-VN')}`
        : `❌ <b>ĐÃ TỪ CHỐI</b> lúc ${new Date().toLocaleTimeString('vi-VN')}`;
      
      const originalText = ctx.callbackQuery.message.text || '';
      await ctx.editMessageText(`${statusText}\n\n${originalText}`, { parse_mode: 'HTML' }).catch((err) => {
        console.error('[Telegram Bot] editMessageText failed:', err.message);
      });
    } catch (e) {
      console.error('[Telegram Bot] AI Lead callback action error:', e);
      await ctx.answerCbQuery('Lỗi: ' + e.message).catch(() => {});
      await ctx.reply(`❌ Thao tác thất bại: ${e.message}`).catch(() => {});
    }
  });

  bot.command('join', async (ctx) => {
     const link = ctx.message.text.split(' ')[1];
     if (!link || !link.includes('t.me')) return ctx.reply('Cú pháp: /join https://t.me/link...');
     
     ctx.reply('⏳ Đang điều động toàn bộ Account tiến hành nhảy dù vào Group...');
     
     try {
       const telegramService = require('./telegramService');
       const results = await telegramService.joinChatWithAllAccounts(link);
       const txt = results.join('\n');
       ctx.reply(`✅ Kết quả tiến quân:\n${txt}`);
     } catch (e) {
       ctx.reply('Lỗi điều quân: ' + e.message);
     }
  });

  bot.command('ping', (ctx) => {
    ctx.reply('🏓 Pong! Hệ thống ở nhà đang hoạt động trơn tru!');
  });

  // Configure menu & command suggestions
  try {
    await bot.telegram.setMyCommands([
      { command: 'campaigns', description: 'Danh sách các chiến dịch' },
      { command: 'resume', description: 'Chạy lại 1 chiến dịch (resume [id])' },
      { command: 'stop', description: 'Dừng 1 chiến dịch (stop [id])' },
      { command: 'resume_all', description: 'Chạy toàn bộ chiến dịch' },
      { command: 'pause_all', description: 'Dừng toàn bộ chiến dịch' },
      { command: 'speed', description: 'Đổi tốc độ gửi (speed [id] [60-120])' },
      { command: 'stats', description: 'Thống kê Auto Post hôm nay' },
      { command: 'live', description: 'Xem tiến độ 1 chiến dịch (live [id])' },
      { command: 'info', description: 'Xem chi tiết 1 chiến dịch (info [id])' },
      { command: 'fix_targets', description: 'Ân xá các nhóm bị lỗi' },
      { command: 'join', description: 'Cho máy trạm vào Group (join [link])' },
      { command: 'accounts', description: 'Danh sách TK Telegram đang dùng' },
      { command: 'ai_lead', description: 'Quản lý AI Lead Watcher' },
      { command: 'ping', description: 'Kiểm tra hệ thống' }
    ]);
    await bot.telegram.setChatMenuButton({ menuButton: { type: 'commands' } });
  } catch (e) {
    console.error('[Telegram Bot] Failed to configure commands menu:', e.message);
  }

  bot.on('message', async (ctx) => {
    if (ctx.message.text && ctx.message.text.startsWith('/')) return; // Bỏ qua commands

    const chatId = ctx.chat.id.toString();
    const payload = wizardSessions.get(chatId);
    
    // Auto Join via bare link logic
    if (ctx.message.text && (ctx.message.text.includes('t.me/') || ctx.message.text.includes('telegram.me/')) && !payload) {
        if (!ctx.message.text.includes(' ')) {
           ctx.reply(`Sếp vừa gửi link Telegram: ${ctx.message.text}\nSếp có muốn điều động Lính đánh thuê (Toàn bộ Account) chui vào Group này Không?\nGõ lệnh:\n/join ${ctx.message.text}`);
           return;
        }
    }
    
    // Đang chờ đổi tốc độ
    if (payload && payload.waitingForSpeed) {
      payload.schedule = ctx.message.text;
      payload.waitingForSpeed = false;
      ctx.reply('⏱ Đã cập nhật Tốc độ xong!');
      renderWizard(ctx);
      return;
    }

    // Đang chờ đổi tên
    if (payload && payload.waitingForName) {
      payload.name = ctx.message.text;
      payload.waitingForName = false;
      ctx.reply('✏️ Đã cập nhật Tên Chiến dịch!');
      renderWizard(ctx);
      return;
    }

    // Nếu đang có Nháp và gửi thêm Ảnh -> Tự động đính kèm thêm Ảnh vào bản Draft
    if (payload && ctx.message.photo) {
      const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      try {
        const link = await ctx.telegram.getFileLink(fileId);
        const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
        const filePath = path.join(uploadsDir, `bot_${Date.now()}.jpg`);
        const fileWriter = fs.createWriteStream(filePath);
        await new Promise((resolve, reject) => {
          https.get(link, (res) => { res.pipe(fileWriter); res.on('end', resolve); }).on('error', reject);
        });
        payload.imagePaths.push(filePath);
        payload.type = 'photo'; 
        if (ctx.message.caption) {
           payload.contentTemplate = payload.contentTemplate ? payload.contentTemplate + '\n\n' + ctx.message.caption : ctx.message.caption;
        }
        ctx.reply('🖼 Đã kẹp thêm Ảnh này vào Bản nháp hiện tại!');
        renderWizard(ctx);
        return;
      } catch (e) {
        return ctx.reply('Lỗi tải ảnh đính kèm: ' + e.message);
      }
    }

    // Nếu gửi nội dung mới (Text/Forward) => Tạo Draft mới
    let draft = {
      type: 'text',
      name: '',
      contentTemplate: '',
      forwardSource: null,
      imagePaths: [],
      schedule: '60-120'
    };

    if (ctx.message.forward_origin) {
      // Fallback for MTKruto if user forwards from channel
      if (ctx.message.forward_origin.type === 'channel' || ctx.message.forward_origin.type === 'chat') {
         const fromChat = ctx.message.forward_origin.chat;
         draft.type = 'forward';
         let msgId = ctx.message.forward_origin.message_id || ctx.message.message_id; // approximate
         draft.forwardSource = {
           accountId: '', 
           fromChatId: fromChat.id.toString(),
           fromChatUsername: fromChat.username || '',
           messageIds: [msgId]
         };
         ctx.reply(` Bắt được nội dung Forward từ Nguồn: ${fromChat.title || fromChat.id}`);
      } else if (ctx.message.forward_from_chat) {
         // Older schema fallback
         const fromChat = ctx.message.forward_from_chat;
         draft.type = 'forward';
         const fwdId = ctx.message.forward_from_message_id;
         draft.forwardSource = {
           accountId: '', 
           fromChatId: fromChat.id.toString(),
           fromChatUsername: fromChat.username || '',
           messageIds: [fwdId]
         };
         ctx.reply(` Bắt được nội dung Forward từ Nguồn: ${fromChat.title || fromChat.id}`);
      } else {
         return ctx.reply('⚠ Chỉ hỗ trợ Forward từ Channel / Group public. Nguồn này không trích xuất được ID!');
      }
    } else if (ctx.message.photo) {
      draft.type = 'photo';
      draft.contentTemplate = ctx.message.caption || '';
      // Tải hình ảnh
      const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      try {
        const link = await ctx.telegram.getFileLink(fileId);
        const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
        const filePath = path.join(uploadsDir, `bot_${Date.now()}.jpg`);
        const fileWriter = fs.createWriteStream(filePath);
        await new Promise((resolve, reject) => {
          https.get(link, (res) => { res.pipe(fileWriter); res.on('end', resolve); }).on('error', reject);
        });
        draft.imagePaths.push(filePath);
      } catch (e) {
        return ctx.reply('Lỗi tải ảnh: ' + e.message);
      }
    } else if (ctx.message.text) {
      draft.type = 'text';
      draft.contentTemplate = ctx.message.text;
    } else {
      return ctx.reply('Chưa hỗ trợ loại tin nhắn này!');
    }

    wizardSessions.set(chatId, draft);
    renderWizard(ctx);
  });

  bot.action('wizard_inherit', async (ctx) => {
     const campaigns = await PostCampaign.find({}, 'name _id').lean();
     if (!campaigns.length) return ctx.reply('Không có chiến dịch nào để kế thừa =(');

     const buttons = campaigns.map(c => [Markup.button.callback(`👥 Lấy Target: ${c.name}`, `w_inherit_${c._id}`)]);
     buttons.push([Markup.button.callback('🔙 Kế hoạch gốc', 'wizard_back')]);
     
     ctx.editMessageText('Chọn Chiến dịch nào bạn muốn xài chung danh sách Account & Target?', Markup.inlineKeyboard(buttons));
  });

  bot.action(/w_inherit_(.+)/, async (ctx) => {
     const campId = ctx.match[1];
     const srcCamp = await PostCampaign.findById(campId).lean();
     const payload = wizardSessions.get(ctx.chat.id.toString());
     if (!payload || !srcCamp) return ctx.reply('Bản nháp không tồn tại hoặc lỗi mất nguồn.');
     
     payload.accounts = srcCamp.accounts || [];
     payload.targets = srcCamp.targets || [];
     
     if (payload.type === 'forward' && payload.forwardSource && payload.accounts.length > 0) {
        payload.forwardSource.accountId = payload.accounts[0]; // fallback default
     }
     
     ctx.answerCbQuery('Đã Clone Target thành công!');
     renderWizard(ctx);
     ctx.deleteMessage().catch(e=>e);
  });

  bot.action('wizard_auto_all', async (ctx) => {
     ctx.reply('⏳ Đang quét và rà soát toàn bộ Nhóm/Kênh từ TẤT CẢ Tài khoản. Quá trình này mất vài giây...');
     try {
       const telegramService = require('./telegramService');
       const accs = await telegramService.getAccounts();
       const payload = wizardSessions.get(ctx.chat.id.toString());
       if (!payload) return ctx.reply('Bản nháp không tồn tại.');
       
       let allAccounts = [];
       let allTargets = [];
       
       for (const acc of accs) {
           allAccounts.push(acc.id);
           try {
               const dialogs = await telegramService.getDialogs(acc.id);
               for (const d of dialogs) {
                   if (d.defaultBannedRights && d.defaultBannedRights.sendMessages) continue;
                   // Deduplication check
                   if (!allTargets.find(t => t.chatId === d.id.toString() && t.accountId === acc.id)) {
                       allTargets.push({
                           chatId: d.id.toString(),
                           name: d.title || 'Unknown',
                           isChannel: d.isChannel,
                           isForum: d.isForum || false,
                           topicId: null,
                           topicName: '',
                           accountId: acc.id,
                           scheduleType: 'fixed',
                           customSchedule: '',
                           isDisabled: false,
                           lastError: ''
                       });
                   }
               }
           } catch(err) {
               console.error('[wizard_auto_all] Error scraping account', acc.id, err.message);
           }
       }
       
       if (allAccounts.length === 0) return ctx.reply('Không có tài khoản Telegram nào đang kết nối!');
       
       payload.accounts = allAccounts;
       payload.targets = allTargets;
       if (payload.type === 'forward' && payload.forwardSource && payload.accounts.length > 0) {
          payload.forwardSource.accountId = payload.accounts[0];
       }
       
       ctx.reply(`✅ BOM ĐÃ LÊN NÒNG!\n- Huy động: <b>${allAccounts.length} Tài khoản</b>\n- Phủ sóng: <b>${allTargets.length} Nhóm/Kênh</b>\n\nSếp bấm <b>✅ CHỐT: Tạo Chiến Dịch Này</b> để khai hoả ngay!`, { parse_mode: 'HTML' });
       renderWizard(ctx);
     } catch (e) {
       ctx.reply('Lỗi lấy danh sách Nhóm: ' + e.message);
     }
  });

  bot.action('wizard_rename', (ctx) => {
     const payload = wizardSessions.get(ctx.chat.id.toString());
     if (!payload) return;
     payload.waitingForName = true;
     ctx.reply('✍️ Gõ tên chiến dịch bạn muốn thiết lập (Ví dụ: CD Kéo Sub):');
     ctx.answerCbQuery();
  });

  bot.action('wizard_speed', (ctx) => {
     const payload = wizardSessions.get(ctx.chat.id.toString());
     if (!payload) return;
     const buttons = [
        [Markup.button.callback('🚀 Tốc độ Max (10-30)', 'w_speed_10-30')],
        [Markup.button.callback('🚗 Vừa phải (60-120)', 'w_speed_60-120')],
        [Markup.button.callback('🐢 An toàn (120-240)', 'w_speed_120-240')],
        [Markup.button.callback('🔙 Nhập tay', 'w_speed_manual')]
     ];
     ctx.editMessageText('Chọn một tốc độ Delay (Khoảng giãn cách giữa các bài đăng):', Markup.inlineKeyboard(buttons));
  });

  bot.action(/w_speed_(.+)/, (ctx) => {
     const val = ctx.match[1];
     const payload = wizardSessions.get(ctx.chat.id.toString());
     if (!payload) return ctx.answerCbQuery('Lỗi!');
     if (val === 'manual') {
        payload.waitingForSpeed = true;
        ctx.reply('Gõ một tốc độ mới rồi gửi mình (ví dụ: 10-30):');
     } else {
        payload.schedule = val;
        ctx.answerCbQuery('Đã cập nhật Tốc độ!');
        ctx.deleteMessage().catch(e=>e);
        renderWizard(ctx);
     }
  });

  bot.action('wizard_create', async (ctx) => {
     const payload = wizardSessions.get(ctx.chat.id.toString());
     if (!payload) return ctx.answerCbQuery('Không tìm thấy bản nháp!');
     
     if (!payload.accounts || payload.accounts.length === 0) {
        return ctx.answerCbQuery('Vui lòng Kế thừa Target trước khi Chốt!');
     }

     const newCampName = payload.name || ('Bot_Camp_' + String(Math.floor(Math.random()*1000)).padStart(3, '0'));
     const newCamp = new PostCampaign({
        name: newCampName,
        type: payload.type,
        forwardSource: payload.forwardSource,
        accounts: payload.accounts,
        targets: payload.targets.map(t => { 
            // Reset state
            return {
                chatId: t.chatId,
                name: t.name,
                isChannel: t.isChannel,
                isForum: t.isForum,
                topicId: t.topicId,
                topicName: t.topicName,
                accountId: t.accountId,
                scheduleType: t.scheduleType,
                customSchedule: t.customSchedule,
                isDisabled: false,
                lastError: '',
                nextRunAt: undefined
            }; 
        }),
        contentTemplate: payload.contentTemplate,
        imagePaths: payload.imagePaths,
        schedule: payload.schedule,
        firstRunMode: 'immediate',
        isRunning: true
     });
     
     await newCamp.save();
     wizardSessions.delete(ctx.chat.id.toString());
     
     ctx.answerCbQuery('Thành công!');
     ctx.reply(`🎉 Tung hoa! Chiến dịch mới <b>${newCampName}</b> đã gia nhập mâm Đang Chạy!`, { parse_mode: 'HTML' });
  });

  bot.action('wizard_back', (ctx) => {
     ctx.deleteMessage().catch(e=>e);
     renderWizard(ctx);
  });

  try {
    const me = await bot.telegram.getMe();
    setting.telegramBotUsername = me.username;
    await setting.save();
  } catch (meErr) {
    console.error('Lỗi khi tải thông tin Bot', meErr);
  }

  if (setupWebhook) {
    const baseUrl = (setting.telegramWebhookUrl || '').trim().replace(/\/$/, '');
    if (baseUrl && baseUrl.startsWith('https://')) {
      const webhookUrl = `${baseUrl}/webhook`;
      await bot.telegram.setWebhook(webhookUrl);
      console.log(`[Telegram Bot] Webhook set to ${webhookUrl}`);
      startWebhookServer(3000);
      if (adminChatId && !silent) {
        bot.telegram.sendMessage(adminChatId, '🤖 Bot đã kết nối webhook qua cổng 3000.').catch(e => {});
      }
    } else {
      if (webhookServer) {
        webhookServer.close(() => { console.log('[Webhook Server] Stopped.'); });
        webhookServer = null;
      }
      await bot.telegram.deleteWebhook();
      await bot.launch();
      console.log('[Telegram Bot] Started with long polling because Webhook URL is empty.');
      if (adminChatId && !silent) {
        bot.telegram.sendMessage(adminChatId, '🤖 Bot đã khởi động bằng Long Polling vì chưa cấu hình Webhook URL.').catch(e => {});
      }
    }
  } else {
    console.log('[Telegram Bot] Initialized for webhook update handling without resetting webhook');
  }

  if (notifyBacklog) notifyAiLeadPendingBacklog();
  try {
    const aiLeadService = require('./aiLeadService');
    if (typeof aiLeadService.startAutoSendQueue === 'function') {
      aiLeadService.startAutoSendQueue().catch((err) => {
        console.error('[AILead] auto-send queue startup error:', err.message);
      });
    }
  } catch (err) {
    console.error('[AILead] auto-send queue init error:', err.message);
  }
  return bot;
}

async function notifyAdmin(message, parseMode = 'Markdown', extra = {}) {
  const notifyMeta = {
    parseMode: parseMode || 'none',
    hasInlineKeyboard: !!extra?.reply_markup?.inline_keyboard,
    preview: String(message || '').slice(0, 220),
  };
  console.log('[Telegram Bot] notifyAdmin sending:', notifyMeta);

  const sendViaFallback = async () => {
    const setting = await GlobalSetting.findOne({ type: 'global_app_settings' });
    if (!setting?.telegramBotToken || !setting?.telegramAdminChatId) {
      console.error('[Telegram Bot] notifyAdmin skipped: missing token/admin chat id');
      return false;
    }
    const payload = {
      chat_id: setting.telegramAdminChatId,
      text: message,
      ...extra,
    };
    if (parseMode) payload.parse_mode = parseMode;
    const res = await fetch(`https://api.telegram.org/bot${setting.telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.ok === false) {
      console.error('[Telegram Bot] notifyAdmin HTTP error:', body || (await res.text().catch(() => 'unknown error')));
      return false;
    }
    console.log('[Telegram Bot] notifyAdmin sent via Bot API:', {
      messageId: body?.result?.message_id,
      chatId: setting.telegramAdminChatId,
    });
    return true;
  };

  try {
    if (bot && adminChatId) {
      const opts = parseMode ? { parse_mode: parseMode, ...extra } : { ...extra };
      const sent = await bot.telegram.sendMessage(adminChatId, message, opts);
      console.log('[Telegram Bot] notifyAdmin sent via live bot:', {
        messageId: sent?.message_id,
        chatId: adminChatId,
      });
      return true;
    }
    const ok = await sendViaFallback();
    console.log('[Telegram Bot] notifyAdmin fallback result:', { ok });
    return ok;
  } catch (err) {
    console.error('[Telegram Bot] notifyAdmin live error, trying fallback:', err.message);
    try {
      const ok = await sendViaFallback();
    console.log('[Telegram Bot] notifyAdmin fallback result:', { ok });
    return ok;
    } catch (fallbackErr) {
      console.error('[Telegram Bot] notifyAdmin fallback error:', fallbackErr.message);
      return false;
    }
  }
}
function getBot() {
  return bot;
}

async function handleWebhookUpdate(update) {
  if (!bot) {
    await initBot({ silent: true, setupWebhook: false, notifyBacklog: false });
  }
  if (!bot) {
    throw new Error('BOT_NOT_INITIALIZED');
  }
  await bot.handleUpdate(update);
}

let webhookServer = null;

function startWebhookServer(port = 3000) {
  if (webhookServer) return;
  try {
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.post('/webhook', async (req, res) => {
      try {
        await handleWebhookUpdate(req.body);
        res.status(200).json({ ok: true });
      } catch (err) {
        console.error('[Webhook Server] handle error:', err);
        res.status(500).json({ ok: false, error: err.message });
      }
    });
    app.get('/webhook', (req, res) => {
      res.json({ ok: true, message: 'Telegram webhook endpoint ready (Express)' });
    });
    webhookServer = app.listen(port, () => {
      console.log(`[Webhook Server] Listening for Telegram webhooks on port ${port}`);
    });
  } catch (err) {
    console.error('[Webhook Server] Failed to start:', err.message);
  }
}

module.exports = { initBot, notifyAdmin, getBot, handleWebhookUpdate, startWebhookServer };

