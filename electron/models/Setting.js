const { get, run } = require("../db");

class GlobalSetting {
  constructor(data = {}) {
    this.type = data.type || "global_app_settings";
    this.telegramBotToken = data.telegramBotToken || "";
    this.telegramAdminChatId = data.telegramAdminChatId || "";
    this.telegramPairToken = data.telegramPairToken || "";
    this.telegramBotUsername = data.telegramBotUsername || "";
    this.telegramWebhookUrl =
      data.telegramWebhookUrl || "https://d5x1qljf-3000.asse.devtunnels.ms/";
    this.updatedAt = data.updatedAt || new Date().toISOString();
    this.createdAt = data.createdAt || new Date().toISOString();
  }

  async save() {
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
      updatedAt: this.updatedAt,
      createdAt: this.createdAt,
    };
  }

  static async findOne(filter = {}) {
    const type = filter.type || "global_app_settings";
    const row = await get(`SELECT data FROM settings WHERE type = ?`, [type]);
    return row ? new GlobalSetting(JSON.parse(row.data)) : null;
  }
}

module.exports = GlobalSetting;
