const { all, get, run } = require("../db");

function mapRow(row) {
  if (!row) return null;
  return {
    accountId: row.id,
    apiId: row.apiId,
    apiHash: row.apiHash,
    sessionString: row.sessionString,
    firstName: row.firstName,
    lastName: row.lastName,
    username: row.username,
    phone: row.phone,
    about: row.about || "",
    createdAt: row.createdAt,
  };
}

class TelegramAccountModel {
  static async find() {
    const rows = await all(`SELECT * FROM telegram_accounts ORDER BY createdAt ASC`);
    return rows.map(mapRow);
  }

  static async findOne(filter = {}) {
    if (!filter.accountId) return null;
    const row = await get(`SELECT * FROM telegram_accounts WHERE id = ?`, [
      filter.accountId,
    ]);
    return mapRow(row);
  }

  static async findOneAndUpdate(filter = {}, update = {}, options = {}) {
    const id = filter.accountId;
    const existing = await TelegramAccountModel.findOne({ accountId: id });
    const now = new Date().toISOString();
    const record = {
      accountId: id,
      apiId: update.apiId || existing?.apiId || "",
      apiHash: update.apiHash || existing?.apiHash || "",
      sessionString: update.sessionString || existing?.sessionString || "",
      firstName: update.firstName || existing?.firstName || "",
      lastName: update.lastName || existing?.lastName || "",
      username: update.username || existing?.username || "",
      phone: update.phone || existing?.phone || "",
      about: update.about || existing?.about || "",
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    await run(
      `INSERT INTO telegram_accounts (id, apiId, apiHash, sessionString, firstName, lastName, username, phone, about, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         apiId = excluded.apiId,
         apiHash = excluded.apiHash,
         sessionString = excluded.sessionString,
         firstName = excluded.firstName,
         lastName = excluded.lastName,
         username = excluded.username,
         phone = excluded.phone,
         about = excluded.about,
         updatedAt = excluded.updatedAt`,
      [
        record.accountId,
        record.apiId,
        record.apiHash,
        record.sessionString,
        record.firstName,
        record.lastName,
        record.username,
        record.phone,
        record.about,
        record.createdAt,
        record.updatedAt,
      ],
    );

    return options.upsert ? record : existing;
  }

  static async findOneAndDelete(filter = {}) {
    if (!filter.accountId) return;
    await run(`DELETE FROM telegram_accounts WHERE id = ?`, [filter.accountId]);
  }
}

module.exports = TelegramAccountModel;
