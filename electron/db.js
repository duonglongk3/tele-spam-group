const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const DB_PATH =
  process.env.SQLITE_DB_PATH ||
  path.join(__dirname, "..", "data", "telegram-auto-post.sqlite3");

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
      apiId TEXT,
      apiHash TEXT,
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
