const { randomUUID } = require("crypto");
const { all, get, run } = require("../db");

function normalizeItem(data = {}) {
  const now = new Date().toISOString();
  return {
    _id: data._id || `${data.accountId || ""}:${data.senderId || randomUUID()}`,
    accountId: String(data.accountId || ""),
    senderId: String(data.senderId || ""),
    senderName: data.senderName || "Unknown user",
    chatId: data.chatId ? String(data.chatId) : "",
    sourceType: data.sourceType || "group",
    score: Number(data.score || 0),
    riskScore: Number(data.riskScore || 0),
    reason: data.reason || "AI score below limit",
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now,
  };
}

function parseRowData(row) {
  if (!row || !String(row.data || "").trim()) return null;
  try {
    return JSON.parse(row.data);
  } catch (err) {
    console.warn("[AiLeadBlacklist] Invalid JSON row skipped:", err.message);
    return null;
  }
}

function rowToItem(row) {
  const data = parseRowData(row);
  return data ? normalizeItem(data) : null;
}

class AiLeadBlacklist {
  static async upsert(data = {}) {
    const existing = data.accountId && data.senderId
      ? await this.findOne(data.accountId, data.senderId)
      : null;
    const item = normalizeItem({ ...existing, ...data, _id: existing?._id });
    await run(
      `INSERT INTO ai_lead_blacklist (id, accountId, senderId, senderName, chatId, sourceType, score, riskScore, reason, createdAt, updatedAt, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(accountId, senderId) DO UPDATE SET
         senderName = excluded.senderName,
         chatId = excluded.chatId,
         sourceType = excluded.sourceType,
         score = excluded.score,
         riskScore = excluded.riskScore,
         reason = excluded.reason,
         updatedAt = excluded.updatedAt,
         data = excluded.data`,
      [
        item._id,
        item.accountId,
        item.senderId,
        item.senderName,
        item.chatId,
        item.sourceType,
        item.score,
        item.riskScore,
        item.reason,
        item.createdAt,
        item.updatedAt,
        JSON.stringify(item),
      ],
    );
    return item;
  }

  static async findOne(accountId, senderId) {
    return rowToItem(
      await get(`SELECT data FROM ai_lead_blacklist WHERE accountId = ? AND senderId = ? LIMIT 1`, [String(accountId), String(senderId)]),
    );
  }

  static async findRecent(limit = 500) {
    const rows = await all(`SELECT data FROM ai_lead_blacklist ORDER BY updatedAt DESC LIMIT ?`, [limit]);
    return rows.map(rowToItem).filter(Boolean);
  }

  static async findBlacklistPaged({
    page = 1,
    limit = 10,
    search = '',
    accountId = '',
    sourceType = '',
    sortBy = 'updatedAt',
    sortOrder = 'DESC',
  } = {}) {
    const offset = (Math.max(1, page) - 1) * limit;
    const conditions = [];
    const params = [];

    if (search) {
      conditions.push(`(senderName LIKE ? OR senderId LIKE ? OR reason LIKE ?)`);
      const searchLike = `%${search}%`;
      params.push(searchLike, searchLike, searchLike);
    }
    if (accountId) {
      conditions.push(`accountId = ?`);
      params.push(String(accountId));
    }
    if (sourceType) {
      conditions.push(`sourceType = ?`);
      params.push(String(sourceType));
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    const allowedSortFields = ['updatedAt', 'createdAt', 'score', 'riskScore', 'senderName'];
    const resolvedSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'updatedAt';
    const resolvedSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const countRow = await get(`SELECT COUNT(*) as total FROM ai_lead_blacklist ${whereClause}`, params);
    const total = countRow ? countRow.total : 0;

    const query = `
      SELECT data FROM ai_lead_blacklist 
      ${whereClause} 
      ORDER BY ${resolvedSortBy} ${resolvedSortOrder} 
      LIMIT ? OFFSET ?
    `;
    const rows = await all(query, [...params, limit, offset]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      items: rows.map(rowToItem).filter(Boolean),
    };
  }

  static async delete(accountId, senderId) {
    const result = await run(`DELETE FROM ai_lead_blacklist WHERE accountId = ? AND senderId = ?`, [String(accountId), String(senderId)]);
    return result.changes > 0;
  }
}

module.exports = AiLeadBlacklist;
