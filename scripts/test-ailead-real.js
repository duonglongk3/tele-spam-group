const { connectDB } = require('../electron/db');
const GlobalSetting = require('../electron/models/Setting');
const TelegramAccount = require('../electron/models/TelegramAccount');
const AiLeadQueue = require('../electron/models/AiLeadQueue');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

function getTelegramApiId() {
  return Number(process.env.TELEGRAM_API_ID || 2040);
}

function getTelegramApiHash() {
  return process.env.TELEGRAM_API_HASH || 'b18441a1ff607e10a989891a5462e627';
}

function toText(message) {
  return String(message?.message || message?.text || '').trim();
}

function normalizeMessage(message, group) {
  const sender = message.sender || {};
  const chatId = String(group.chatId || group.id || message.chatId?.toString?.() || '');
  return {
    id: message.id,
    message: toText(message),
    text: toText(message),
    out: !!message.out,
    media: message.media || null,
    chatId,
    chat: { title: group.title, username: group.username || '' },
    senderId: message.senderId?.toString?.() || message.fromId?.userId?.toString?.() || sender.id?.toString?.() || '',
    sender: {
      id: sender.id?.toString?.() || '',
      username: sender.username || '',
      firstName: sender.firstName || '',
      lastName: sender.lastName || '',
      bot: !!sender.bot,
    },
    peerId: {},
  };
}

async function main() {
  await connectDB();

  const settings = await GlobalSetting.findOne({ type: 'global_app_settings' });
  if (!settings?.openaiApiKey) throw new Error('Missing AI API key in settings');

  const groups = Array.isArray(settings.aiLeadEngagementGroups) ? settings.aiLeadEngagementGroups : [];
  if (!groups.length) throw new Error('No aiLeadEngagementGroups configured');

  const account = await TelegramAccount.findOne({ accountId: process.argv[2] || groups[0].accountId });
  if (!account?.sessionString) throw new Error('No saved Telegram account/session found');

  const limitPerGroup = Number(process.argv[3] || 25);
  const maxGroups = Number(process.argv[4] || Math.min(groups.length, 5));

  const client = new TelegramClient(
    new StringSession(account.sessionString),
    getTelegramApiId(),
    getTelegramApiHash(),
    {
      connectionRetries: 5,
      deviceModel: process.env.TELEGRAM_DEVICE_MODEL || 'Desktop',
      systemVersion: process.env.TELEGRAM_SYSTEM_VERSION || 'Windows 10',
      appVersion: process.env.TELEGRAM_APP_VERSION || 'Telegram Desktop 6.9.3 x64',
      langCode: process.env.TELEGRAM_LANG_CODE || 'en',
      systemLangCode: process.env.TELEGRAM_SYSTEM_LANG_CODE || 'en-US',
    },
  );

  await client.connect();

  const originalFindOne = GlobalSetting.findOne.bind(GlobalSetting);
  GlobalSetting.findOne = async (...args) => {
    const current = await originalFindOne(...args);
    if (!current) return current;
    current.aiLeadMode = 'manual';
    current.aiLeadCooldownMinutes = 0;
    current.aiLeadMaxRepliesPerDay = Math.max(Number(current.aiLeadMaxRepliesPerDay || 0), 999);
    current.aiLeadMaxRepliesPerGroupPerDay = Math.max(Number(current.aiLeadMaxRepliesPerGroupPerDay || 0), 999);
    return current;
  };

  try {
    const aiLeadService = require('../electron/aiLeadService');
    const dialogs = await client.getDialogs({ limit: 500 });
    const byId = new Map(dialogs.map((dialog) => [dialog.id?.toString?.(), dialog]));
    const targetGroups = groups.filter((group) => String(group.accountId) === String(account.accountId)).slice(0, maxGroups);
    const beforePending = (await AiLeadQueue.findRecent({ status: 'pending' }, 500)).length;

    const final = {
      accountId: account.accountId,
      accountName: [account.firstName, account.username ? `@${account.username}` : ''].filter(Boolean).join(' '),
      groupsTried: 0,
      received: 0,
      eligible: 0,
      queued: 0,
      sent: 0,
      ignored: 0,
      ignoredReasons: {},
      errors: [],
    };

    for (const group of targetGroups) {
      const dialog = byId.get(String(group.chatId));
      if (!dialog) {
        final.errors.push({ group: group.title, chatId: group.chatId, error: 'Not found in current dialogs' });
        continue;
      }

      const messages = await client.getMessages(dialog.entity, { limit: limitPerGroup });
      const items = messages
        .map((message) => normalizeMessage(message, group))
        .filter((message) => message.message && !message.out);

      console.log('[AILeadTest] Group sample:', {
        title: group.title,
        chatId: group.chatId,
        fetched: messages.length,
        textMessages: items.length,
        previews: items.slice(0, 5).map((item) => item.message.slice(0, 120)),
      });

      const result = await aiLeadService.processBufferedGroupMessages({
        items: items.map((message) => ({ accountId: account.accountId, message, queuedAt: Date.now() })),
        reason: 'manual_test_script',
      });

      final.groupsTried += 1;
      final.received += result.received || 0;
      final.eligible += result.eligible || 0;
      final.queued += result.queued || 0;
      final.sent += result.sent || 0;
      final.ignored += result.ignored || 0;
      for (const [key, value] of Object.entries(result.ignoredReasons || {})) {
        final.ignoredReasons[key] = (final.ignoredReasons[key] || 0) + value;
      }
      if (Array.isArray(result.errors)) final.errors.push(...result.errors);
      console.log('[AILeadTest] Group result:', { title: group.title, result });
    }

    const afterPending = (await AiLeadQueue.findRecent({ status: 'pending' }, 500)).length;
    final.newPending = Math.max(0, afterPending - beforePending);
    console.log('[AILeadTest] Final summary:', JSON.stringify(final, null, 2));
  } finally {
    await client.disconnect().catch(() => {});
  }
}

main().catch((error) => {
  console.error('[AILeadTest] Failed:', error);
  process.exit(1);
});
