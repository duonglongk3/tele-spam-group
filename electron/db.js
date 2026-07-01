const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const DB_PATH = (() => {
  if (process.env.SQLITE_DB_PATH) return process.env.SQLITE_DB_PATH;
  try {
    const { app } = require("electron");
    if (app && app.isPackaged) {
      return path.join(app.getPath("userData"), "telegram-auto-post.sqlite3");
    }
  } catch (e) {}
  return path.join(process.cwd(), "data", "telegram-auto-post.sqlite3");
})();
let dbInstance = null;

function getDb() {
  if (!dbInstance) {
    throw new Error("SQLite chưa được khởi tạo");
  }
  return dbInstance;
}

function run(sql, params = []) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve({
        lastID: this.lastID,
        changes: this.changes,
      });
    });
  });
}

function get(sql, params = []) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row || null);
    });
  });
}

function all(sql, params = []) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows || []);
    });
  });
}

async function migrate() {
  await run(`
    CREATE TABLE IF NOT EXISTS telegram_accounts (
      id TEXT PRIMARY KEY,
      sessionString TEXT,
      firstName TEXT,
      lastName TEXT,
      username TEXT,
      phone TEXT,
      about TEXT DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS settings (
      type TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS post_logs (
      id TEXT PRIMARY KEY,
      campaignId TEXT,
      status TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      data TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS ai_lead_queue (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      accountId TEXT NOT NULL,
      chatId TEXT NOT NULL,
      messageId TEXT NOT NULL,
      senderId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      data TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS ai_lead_blacklist (
      id TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      senderId TEXT NOT NULL,
      senderName TEXT,
      chatId TEXT,
      sourceType TEXT DEFAULT 'group',
      score INTEGER DEFAULT 0,
      riskScore INTEGER DEFAULT 0,
      reason TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      data TEXT NOT NULL
    )
  `);

  await run(
    `CREATE INDEX IF NOT EXISTS idx_ai_lead_queue_status_created_at ON ai_lead_queue (status, createdAt DESC)`,
  );
  await run(
    `CREATE INDEX IF NOT EXISTS idx_ai_lead_queue_chat_message ON ai_lead_queue (accountId, chatId, messageId)`,
  );
  await run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_lead_blacklist_account_sender ON ai_lead_blacklist (accountId, senderId)`,
  );

  await run(
    `CREATE INDEX IF NOT EXISTS idx_post_logs_campaign_created_at ON post_logs (campaignId, createdAt DESC)`,
  );
  await run(
    `CREATE INDEX IF NOT EXISTS idx_post_logs_status_created_at ON post_logs (status, createdAt DESC)`,
  );
}

async function connectDB() {
  if (dbInstance) return dbInstance;

  const fs = require("fs");
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  dbInstance = await new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(db);
    });
  });

  await run("PRAGMA foreign_keys = ON");
  await run("PRAGMA journal_mode = WAL");
  await migrate();
  console.log(`[SQLite] Connected successfully: ${DB_PATH}`);
  return dbInstance;
}

module.exports = {
  connectDB,
  getDb,
  run,
  get,
  all,
  DB_PATH,
};
