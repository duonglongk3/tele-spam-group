const { get, run } = require("../db");

class AiLeadGroupCursor {
  static async getMessageId(accountId, chatId) {
    const row = await get(
      `SELECT messageId FROM ai_lead_group_cursors WHERE accountId = ? AND chatId = ?`,
      [String(accountId), String(chatId)],
    );
    const messageId = Number(row?.messageId || 0);
    return Number.isSafeInteger(messageId) && messageId > 0 ? messageId : 0;
  }

  static async advance(accountId, chatId, messageId) {
    const nextMessageId = Number(messageId || 0);
    if (!Number.isSafeInteger(nextMessageId) || nextMessageId <= 0) return 0;
    const currentMessageId = await this.getMessageId(accountId, chatId);
    const finalMessageId = Math.max(currentMessageId, nextMessageId);
    await run(
      `INSERT INTO ai_lead_group_cursors (accountId, chatId, messageId, updatedAt)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(accountId, chatId) DO UPDATE SET
         messageId = excluded.messageId,
         updatedAt = excluded.updatedAt`,
      [
        String(accountId),
        String(chatId),
        finalMessageId,
        new Date().toISOString(),
      ],
    );
    return finalMessageId;
  }
}

module.exports = AiLeadGroupCursor;
