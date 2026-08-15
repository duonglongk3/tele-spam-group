const { get, run } = require("../db");

const TELEGRAM_CLIENT_DEFAULTS = {
  telegramApiId: process.env.TELEGRAM_API_ID || "2040",
  telegramApiHash:
    process.env.TELEGRAM_API_HASH || "b18441a1ff607e10a989891a5462e627",
  telegramDeviceModel: process.env.TELEGRAM_DEVICE_MODEL || "Desktop",
  telegramSystemVersion: process.env.TELEGRAM_SYSTEM_VERSION || "Windows 10",
  telegramAppVersion:
    process.env.TELEGRAM_APP_VERSION || "Telegram Desktop 6.9.3 x64",
  telegramLangCode: process.env.TELEGRAM_LANG_CODE || "en",
  telegramSystemLangCode: process.env.TELEGRAM_SYSTEM_LANG_CODE || "en-US",
};

function applyTelegramClientEnv(settings = {}) {
  const values = {
    ...TELEGRAM_CLIENT_DEFAULTS,
    ...settings,
  };
  process.env.TELEGRAM_API_ID = String(values.telegramApiId || TELEGRAM_CLIENT_DEFAULTS.telegramApiId);
  process.env.TELEGRAM_API_HASH = values.telegramApiHash || TELEGRAM_CLIENT_DEFAULTS.telegramApiHash;
  process.env.TELEGRAM_DEVICE_MODEL = values.telegramDeviceModel || TELEGRAM_CLIENT_DEFAULTS.telegramDeviceModel;
  process.env.TELEGRAM_SYSTEM_VERSION = values.telegramSystemVersion || TELEGRAM_CLIENT_DEFAULTS.telegramSystemVersion;
  process.env.TELEGRAM_APP_VERSION = values.telegramAppVersion || TELEGRAM_CLIENT_DEFAULTS.telegramAppVersion;
  process.env.TELEGRAM_LANG_CODE = values.telegramLangCode || TELEGRAM_CLIENT_DEFAULTS.telegramLangCode;
  process.env.TELEGRAM_SYSTEM_LANG_CODE = values.telegramSystemLangCode || TELEGRAM_CLIENT_DEFAULTS.telegramSystemLangCode;
}

class GlobalSetting {
  constructor(data = {}) {
    this.type = data.type || "global_app_settings";
    this.telegramBotToken = data.telegramBotToken || "";
    this.telegramAdminChatId = data.telegramAdminChatId || "";
    this.telegramPairToken = data.telegramPairToken || "";
    this.telegramBotUsername = data.telegramBotUsername || "";
    this.telegramWebhookUrl = data.telegramWebhookUrl || "https://d5x1qljf-3000.asse.devtunnels.ms";
    this.openaiApiKey = data.openaiApiKey || "";
    this.aiApiUrl = "https://api.openai.com/v1";
    this.aiModel = "gpt-4o-mini";
    this.telegramApiId = String(data.telegramApiId || TELEGRAM_CLIENT_DEFAULTS.telegramApiId);
    this.telegramApiHash = data.telegramApiHash || TELEGRAM_CLIENT_DEFAULTS.telegramApiHash;
    this.telegramDeviceModel =
      data.telegramDeviceModel || TELEGRAM_CLIENT_DEFAULTS.telegramDeviceModel;
    this.telegramSystemVersion =
      data.telegramSystemVersion || TELEGRAM_CLIENT_DEFAULTS.telegramSystemVersion;
    this.telegramAppVersion =
      data.telegramAppVersion || TELEGRAM_CLIENT_DEFAULTS.telegramAppVersion;
    this.telegramLangCode =
      data.telegramLangCode || TELEGRAM_CLIENT_DEFAULTS.telegramLangCode;
    this.telegramSystemLangCode =
      data.telegramSystemLangCode || TELEGRAM_CLIENT_DEFAULTS.telegramSystemLangCode;
    this.aiLeadEnabled =
      typeof data.aiLeadEnabled === "boolean" ? data.aiLeadEnabled : false;
    this.aiLeadMode = ["suggest", "auto"].includes(data.aiLeadMode)
      ? data.aiLeadMode
      : "auto";
    this.aiLeadUserReplyEnabled =
      typeof data.aiLeadUserReplyEnabled === "boolean"
        ? data.aiLeadUserReplyEnabled
        : false;
    this.aiLeadMentionDmEnabled =
      typeof data.aiLeadMentionDmEnabled === "boolean"
        ? data.aiLeadMentionDmEnabled
        : true;
    this.aiLeadAccountIds = Array.isArray(data.aiLeadAccountIds)
      ? data.aiLeadAccountIds
      : [];
    this.aiLeadMinScore = Number.isFinite(Number(data.aiLeadMinScore))
      ? Number(data.aiLeadMinScore)
      : 85;
    this.aiLeadMaxRepliesPerDay = Number.isFinite(Number(data.aiLeadMaxRepliesPerDay))
      ? Number(data.aiLeadMaxRepliesPerDay)
      : 500;
    this.aiLeadMaxRepliesPerGroupPerDay = Number.isFinite(Number(data.aiLeadMaxRepliesPerGroupPerDay))
      ? Number(data.aiLeadMaxRepliesPerGroupPerDay)
      : 200;
    this.aiLeadMaxRepliesPerGroupPerHour = Number.isFinite(Number(data.aiLeadMaxRepliesPerGroupPerHour))
      ? Number(data.aiLeadMaxRepliesPerGroupPerHour)
      : 0;
    this.aiLeadCooldownMinutes = Number.isFinite(Number(data.aiLeadCooldownMinutes))
      ? Number(data.aiLeadCooldownMinutes)
      : 0;
    this.aiLeadAutoSendDelayMinutes = Number.isFinite(Number(data.aiLeadAutoSendDelayMinutes))
      ? Number(data.aiLeadAutoSendDelayMinutes)
      : 15;
    this.aiLeadAutoSendMinDelayMinutes = Number.isFinite(Number(data.aiLeadAutoSendMinDelayMinutes))
      ? Number(data.aiLeadAutoSendMinDelayMinutes)
      : this.aiLeadAutoSendDelayMinutes || 15;
    this.aiLeadAutoSendMaxDelayMinutes = Number.isFinite(Number(data.aiLeadAutoSendMaxDelayMinutes))
      ? Number(data.aiLeadAutoSendMaxDelayMinutes)
      : Math.max(this.aiLeadAutoSendMinDelayMinutes, 30);
    this.aiLeadEngagementGroups = Array.isArray(data.aiLeadEngagementGroups)
      ? data.aiLeadEngagementGroups
      : [];
    this.aiLeadEngagementSampleLimit = Number.isFinite(Number(data.aiLeadEngagementSampleLimit))
      ? Number(data.aiLeadEngagementSampleLimit)
      : 40;
    this.aiLeadIgnoreBotLikeUsers =
      typeof data.aiLeadIgnoreBotLikeUsers === "boolean"
        ? data.aiLeadIgnoreBotLikeUsers
        : false;
    this.aiLeadPrompt =
      data.aiLeadPrompt ||
      "You are a professional aged Gmail collector and unlimited-volume buyer sourcing direct wholesale suppliers on Telegram. Every reply must clearly communicate that you collect aged Gmail continuously every day, have no daily or per-order quantity limit, can take all available qualified wholesale stock, and seek a stable long-term supplier rather than a one-time purchase. Never mention fixed quantity tiers such as 100+, 500+, or 1,000+, and never ask for pricing at a fixed quantity. Ask for the seller's maximum daily capacity, available years, best wholesale rate for continuous purchasing, direct-supplier status, stable restocking, and replacement terms. Only reply to sellers who clearly show large wholesale inventory, recurring bulk supply, or stable restocking. Ignore generic Gmail offers, small batches, retail sellers, unclear capacity, buyers, all other products, and general chatter. Move qualified sellers to private chat and require a 1-2 account quality test before payment. Match the seller's dominant language except Vietnamese is completely forbidden. If the source is Vietnamese, contains Vietnamese diacritics, or is ambiguous, reply entirely in English. End the first reply with a seller-language translation of \"Scammers stay away,\" but keep it in English for Vietnamese or ambiguous source text. Never self-identify as a bot, AI, automation, script, or tool.";
    this.updatedAt = data.updatedAt || new Date().toISOString();
    this.createdAt = data.createdAt || new Date().toISOString();
  }

  async save() {
    this.aiApiUrl = "https://api.openai.com/v1";
    this.aiModel = "gpt-4o-mini";
    this.updatedAt = new Date().toISOString();
    await run(
      `INSERT INTO settings (type, data, createdAt, updatedAt)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(type) DO UPDATE SET
         data = excluded.data,
         updatedAt = excluded.updatedAt`,
      [this.type, JSON.stringify(this.toObject()), this.createdAt, this.updatedAt],
    );
    return this;
  }

  toObject() {
    return {
      type: this.type,
      telegramBotToken: this.telegramBotToken,
      telegramAdminChatId: this.telegramAdminChatId,
      telegramPairToken: this.telegramPairToken,
      telegramBotUsername: this.telegramBotUsername,
      telegramWebhookUrl: this.telegramWebhookUrl,
      openaiApiKey: this.openaiApiKey,
      aiApiUrl: this.aiApiUrl,
      aiModel: this.aiModel,
      telegramApiId: this.telegramApiId,
      telegramApiHash: this.telegramApiHash,
      telegramDeviceModel: this.telegramDeviceModel,
      telegramSystemVersion: this.telegramSystemVersion,
      telegramAppVersion: this.telegramAppVersion,
      telegramLangCode: this.telegramLangCode,
      telegramSystemLangCode: this.telegramSystemLangCode,
      aiLeadEnabled: this.aiLeadEnabled,
      aiLeadMode: this.aiLeadMode,
      aiLeadUserReplyEnabled: this.aiLeadUserReplyEnabled,
      aiLeadMentionDmEnabled: this.aiLeadMentionDmEnabled,
      aiLeadAccountIds: this.aiLeadAccountIds,
      aiLeadMinScore: this.aiLeadMinScore,
      aiLeadMaxRepliesPerDay: this.aiLeadMaxRepliesPerDay,
      aiLeadMaxRepliesPerGroupPerDay: this.aiLeadMaxRepliesPerGroupPerDay,
      aiLeadMaxRepliesPerGroupPerHour: this.aiLeadMaxRepliesPerGroupPerHour,
      aiLeadCooldownMinutes: this.aiLeadCooldownMinutes,
      aiLeadAutoSendDelayMinutes: this.aiLeadAutoSendDelayMinutes,
      aiLeadAutoSendMinDelayMinutes: this.aiLeadAutoSendMinDelayMinutes,
      aiLeadAutoSendMaxDelayMinutes: this.aiLeadAutoSendMaxDelayMinutes,
      aiLeadEngagementGroups: this.aiLeadEngagementGroups,
      aiLeadEngagementSampleLimit: this.aiLeadEngagementSampleLimit,
      aiLeadIgnoreBotLikeUsers: this.aiLeadIgnoreBotLikeUsers,
      aiLeadPrompt: this.aiLeadPrompt,
      updatedAt: this.updatedAt,
      createdAt: this.createdAt,
    };
  }

  static async findOne(filter = {}) {
    const type = filter.type || "global_app_settings";
    const row = await get(`SELECT data FROM settings WHERE type = ?`, [type]);
    if (!row) return null;
    const raw = String(row.data || "").trim();
    if (!raw) {
      console.warn(`[Setting] Empty settings JSON for type ${type}, using defaults.`);
      return new GlobalSetting({ type });
    }
    try {
      return new GlobalSetting(JSON.parse(raw));
    } catch (err) {
      console.warn(`[Setting] Invalid settings JSON for type ${type}, using defaults:`, err.message);
      return new GlobalSetting({ type });
    }
  }
}

GlobalSetting.TELEGRAM_CLIENT_DEFAULTS = TELEGRAM_CLIENT_DEFAULTS;
GlobalSetting.applyTelegramClientEnv = applyTelegramClientEnv;

module.exports = GlobalSetting;



