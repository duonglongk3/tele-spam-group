const { randomUUID } = require("crypto");
const { all, get, run } = require("../db");

function normalizeItem(data = {}) {
  const now = new Date().toISOString();
  return {
    _id: data._id || randomUUID(),
    status: data.status || "pending",
    accountId: String(data.accountId || ""),
    chatId: String(data.chatId || ""),
    messageId: String(data.messageId || ""),
    sentMessageId: data.sentMessageId ? String(data.sentMessageId) : "",
    senderId: data.senderId ? String(data.senderId) : "",
    senderName: data.senderName || "Unknown user",
    chatTitle: data.chatTitle || "Unknown chat",
    sourceType: data.sourceType || "group",
    category: data.category || "soft_opportunity",
    score: Number(data.score || 0),
    riskScore: Number(data.riskScore || 0),
    reason: data.reason || "",
    originalText: data.originalText || "",
    suggestedReply: data.suggestedReply || "",
    followUpToQueueId: data.followUpToQueueId || "",
    autoSendAt: data.autoSendAt || "",
    autoSendScheduledAt: data.autoSendScheduledAt || "",
    autoSendAttempts: Number(data.autoSendAttempts || 0),
    autoSendError: data.autoSendError || "",
    adminNotifiedAt: data.adminNotifiedAt || "",
    adminNotifyCount: Number(data.adminNotifyCount || 0),
    sentAt: data.sentAt || "",
    skippedAt: data.skippedAt || "",
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now,
  };
}

function parseRowData(row) {
  if (!row || !String(row.data || "").trim()) return null;
  try {
    return JSON.parse(row.data);
  } catch (err) {
    console.warn("[AILeadQueue] Invalid JSON row skipped:", err.message);
    return null;
  }
}

function rowToItem(row) {
  const data = parseRowData(row);
  return data ? normalizeItem(data) : null;
}

class AiLeadQueue {
  static async create(data) {
    const item = normalizeItem(data);
    await run(
      `INSERT OR REPLACE INTO ai_lead_queue (id, status, accountId, chatId, messageId, senderId, createdAt, updatedAt, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item._id,
        item.status,
        item.accountId,
        item.chatId,
        item.messageId,
        item.senderId,
        item.createdAt,
        item.updatedAt,
        JSON.stringify(item),
      ],
    );
    return item;
  }

  static async findById(id) {
    return rowToItem(await get(`SELECT data FROM ai_lead_queue WHERE id = ?`, [id]));
  }

  static async findByMessage(accountId, chatId, messageId) {
    return rowToItem(
      await get(
        `SELECT data FROM ai_lead_queue WHERE accountId = ? AND chatId = ? AND messageId = ? ORDER BY createdAt DESC LIMIT 1`,
        [String(accountId), String(chatId), String(messageId)],
      ),
    );
  }

  static async findRecent(filter = {}, limit = 10) {
    const status = filter.status;
    const rows = status
      ? await all(`SELECT data FROM ai_lead_queue WHERE status = ? ORDER BY createdAt DESC LIMIT ?`, [status, limit])
      : await all(`SELECT data FROM ai_lead_queue ORDER BY createdAt DESC LIMIT ?`, [limit]);
    return rows.map(rowToItem).filter(Boolean);
  }

  static async findRecentPaged(filter = {}, options = {}) {
    const status = filter.status;
    const limit = Math.max(1, Math.min(Number(options.limit || 20), 100));
    const page = Math.max(1, Number(options.page || 1));
    const offset = (page - 1) * limit;
    const rows = status
      ? await all(`SELECT data FROM ai_lead_queue WHERE status = ?`, [status])
      : await all(`SELECT data FROM ai_lead_queue`);
    const categoryFilter = filter.category;

    let groups = [];
    try {
      const settingsRow = await get(`SELECT data FROM settings WHERE type = 'global_app_settings'`);
      if (settingsRow) {
        const settings = JSON.parse(settingsRow.data);
        groups = settings.aiLeadEngagementGroups || [];
      }
    } catch (e) {
      console.error("[AiLeadQueue] Error loading settings for filter:", e.message);
    }

    const sorted = rows
      .map(rowToItem)
      .filter(Boolean)
      .filter(item => {
        if (!categoryFilter || categoryFilter === 'all') return true;
        const groupConfig = groups.find(
          (g) => String(g.accountId) === String(item.accountId) && String(g.chatId) === String(item.chatId)
        );
        const isBulkBuyingGroup = groupConfig?.purpose === "bulk_buying";
        const isBuyingStream = (item.sourceType === "private") || isBulkBuyingGroup;

        if (categoryFilter === 'buying') return isBuyingStream;
        if (categoryFilter === 'engagement') return !isBuyingStream;
        return true;
      })
      .sort((a, b) => {
        const aSendAt = Date.parse(a.autoSendAt || "");
        const bSendAt = Date.parse(b.autoSendAt || "");
        const aHasSendAt = a.status === "pending" && Number.isFinite(aSendAt);
        const bHasSendAt = b.status === "pending" && Number.isFinite(bSendAt);
        if (aHasSendAt !== bHasSendAt) return aHasSendAt ? -1 : 1;
        if (aHasSendAt && bHasSendAt && aSendAt !== bSendAt) return aSendAt - bSendAt;

        const aQueued = a.status === "pending" && Boolean(a.autoSendScheduledAt || a.autoSendAt);
        const bQueued = b.status === "pending" && Boolean(b.autoSendScheduledAt || b.autoSendAt);
        if (aQueued !== bQueued) return aQueued ? -1 : 1;

        const aCreated = Date.parse(a.createdAt || "") || 0;
        const bCreated = Date.parse(b.createdAt || "") || 0;
        return bCreated - aCreated;
      });
    const total = sorted.length;
    return {
      items: sorted.slice(offset, offset + limit),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  static async findPaged(filter = {}, options = {}) {
    const status = filter.status;
    const limit = Math.max(1, Math.min(Number(options.limit || 20), 100));
    const page = Math.max(1, Number(options.page || 1));
    const offset = (page - 1) * limit;
    const where = status ? `WHERE status = ?` : "";
    const params = status ? [status] : [];
    const totalRow = await get(`SELECT COUNT(*) AS total FROM ai_lead_queue ${where}`, params);
    const total = Number(totalRow?.total || 0);
    const rows = await all(
      `SELECT data FROM ai_lead_queue ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const totalPages = Math.max(1, Math.ceil(total / limit));
    return {
      items: rows.map(rowToItem).filter(Boolean),
      total,
      page: Math.min(page, totalPages),
      limit,
      totalPages,
    };
  }

  static async findBySentMessage(accountId, chatId, sentMessageId) {
    const rows = await all(
      `SELECT data FROM ai_lead_queue WHERE accountId = ? AND chatId = ? AND status = 'sent' ORDER BY updatedAt DESC LIMIT 50`,
      [String(accountId), String(chatId)],
    );
    return rows.map(rowToItem).filter(Boolean).find((item) => item.sentMessageId === String(sentMessageId)) || null;
  }

  static async findLastSentByChatUser(accountId, chatId, senderId) {
    return rowToItem(
      await get(
        `SELECT data FROM ai_lead_queue WHERE accountId = ? AND chatId = ? AND senderId = ? AND status = 'sent' ORDER BY updatedAt DESC LIMIT 1`,
        [String(accountId), String(chatId), String(senderId || "")],
      ),
    );
  }

  static async findRecentSentByChat(accountId, chatId, limit = 10) {
    const rows = await all(
      `SELECT data FROM ai_lead_queue WHERE accountId = ? AND chatId = ? AND status = 'sent' ORDER BY createdAt DESC LIMIT ?`,
      [String(accountId), String(chatId), limit],
    );
    return rows.map(rowToItem).filter(Boolean).reverse();
  }

  static async findRecentConversationByChat(accountId, chatId, limit = 10) {
    const rows = await all(
      `SELECT data FROM ai_lead_queue WHERE accountId = ? AND chatId = ? AND status IN ('pending', 'sent') ORDER BY createdAt DESC LIMIT ?`,
      [String(accountId), String(chatId), limit],
    );
    return rows.map(rowToItem).filter(Boolean).reverse();
  }

  static async findRecentByAccountSender(accountId, senderId, limit = 20) {
    const rows = await all(
      `SELECT data FROM ai_lead_queue WHERE accountId = ? AND senderId = ? ORDER BY createdAt DESC LIMIT ?`,
      [String(accountId), String(senderId || ""), limit],
    );
    return rows.map(rowToItem).filter(Boolean);
  }

  static async update(id, patch = {}) {
    const current = await this.findById(id);
    if (!current) return null;
    const next = normalizeItem({ ...current, ...patch, _id: current._id, updatedAt: new Date().toISOString() });
    await run(
      `UPDATE ai_lead_queue SET status = ?, updatedAt = ?, data = ? WHERE id = ?`,
      [next.status, next.updatedAt, JSON.stringify(next), id],
    );
    return next;
  }
}

module.exports = AiLeadQueue;

