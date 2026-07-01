const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");
const { all, get, run } = require("../db");

const CAMPAIGN_BACKUP_PATH = (() => {
  if (process.env.CAMPAIGN_BACKUP_PATH) return process.env.CAMPAIGN_BACKUP_PATH;
  try {
    const { app } = require("electron");
    if (app && app.isPackaged) {
      return path.join(app.getPath("userData"), "campaigns.json");
    }
  } catch (e) {}
  return path.join(process.cwd(), "data", "campaigns.json");
})();

function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeTarget(target = {}) {
  return {
    chatId: target.chatId || "",
    name: target.name || "",
    isChannel: !!target.isChannel,
    isForum: !!target.isForum,
    topicId: target.topicId ?? null,
    topicName: target.topicName || "",
    accountId: target.accountId || "",
    scheduleType: ["global", "random", "fixed"].includes(target.scheduleType)
      ? target.scheduleType
      : "global",
    customSchedule: target.customSchedule || "",
    nextRunAt: normalizeDate(target.nextRunAt),
    dailySentCount: Number.isFinite(target.dailySentCount) ? target.dailySentCount : 0,
    dailySentDate: target.dailySentDate || '',
    isDisabled: !!target.isDisabled,
    lastError: target.lastError || "",
    photoFallbackOnly: !!target.photoFallbackOnly,
  };
}

function applyUpdateOperators(update = {}) {
  if (!update || typeof update !== "object") return {};
  if (update.$set && typeof update.$set === "object") {
    return { ...update.$set };
  }
  return { ...update };
}

function normalizeCampaign(data = {}, existing = {}) {
  const now = new Date().toISOString();
  const actionButtons = Array.isArray(data.actionButtons)
    ? data.actionButtons
    : Array.isArray(existing.actionButtons)
      ? existing.actionButtons
      : [];
  return {
    _id: data._id || existing._id || randomUUID(),
    name: data.name || existing.name || "",
    type: data.type || existing.type || "text",
    forwardSource: data.forwardSource || existing.forwardSource || null,
    accounts: Array.isArray(data.accounts) ? data.accounts : existing.accounts || [],
    targets: Array.isArray(data.targets)
      ? data.targets.map(normalizeTarget)
      : (existing.targets || []).map(normalizeTarget),
    contentTemplate:
      data.contentTemplate !== undefined
        ? data.contentTemplate
        : existing.contentTemplate || "",
    quoteText:
      data.quoteText !== undefined ? data.quoteText : existing.quoteText || "",
    imagePaths: Array.isArray(data.imagePaths)
      ? data.imagePaths
      : existing.imagePaths || [],
    sendViaBot:
      typeof data.sendViaBot === "boolean"
        ? data.sendViaBot
        : !!existing.sendViaBot,
    actionButtons: actionButtons
      .filter((button) => button && typeof button === "object")
      .map((button) => ({
        text: button.text || "",
        url: button.url || "",
      })),
    delayBetweenPosts:
      data.delayBetweenPosts ||
      data.schedule ||
      existing.delayBetweenPosts ||
      existing.schedule ||
      "10-20",
    schedule:
      data.schedule ||
      data.delayBetweenPosts ||
      existing.schedule ||
      existing.delayBetweenPosts ||
      "10-20",
    maxPostsPerDay:
      Number.isFinite(data.maxPostsPerDay) ? data.maxPostsPerDay : Number(existing.maxPostsPerDay || 3),
    firstRunMode:
      ["immediate", "random"].includes(data.firstRunMode)
        ? data.firstRunMode
        : existing.firstRunMode || "immediate",
    autoDeleteHours:
      Number.isFinite(data.autoDeleteHours)
        ? data.autoDeleteHours
        : Number(existing.autoDeleteHours || 0),
    useAI:
      typeof data.useAI === "boolean"
        ? data.useAI
        : !!existing.useAI,
    obfuscateLinks:
      typeof data.obfuscateLinks === "boolean"
        ? data.obfuscateLinks
        : !!existing.obfuscateLinks,
    isRunning:
      typeof data.isRunning === "boolean"
        ? data.isRunning
        : !!existing.isRunning,
    createdAt: existing.createdAt || data.createdAt || now,
    updatedAt: now,
  };
}

class PostCampaignModel {
  constructor(data = {}) {
    Object.assign(this, normalizeCampaign(data));
  }

  async save() {
    const existing = await PostCampaignModel.findById(this._id);
    const normalized = normalizeCampaign(this, existing || {});
    Object.assign(this, normalized);
    await run(
      `INSERT INTO campaigns (id, data, createdAt, updatedAt)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         data = excluded.data,
         updatedAt = excluded.updatedAt`,
      [
        this._id,
        JSON.stringify(this.toObject()),
        this.createdAt,
        this.updatedAt,
      ],
    );
    await PostCampaignModel.writeJsonBackup();
    return this;
  }

  lean() {
    return { ...this.toObject() };
  }

  toObject() {
    return {
      _id: this._id,
      name: this.name,
      type: this.type,
      forwardSource: this.forwardSource,
      accounts: this.accounts,
      targets: this.targets,
      contentTemplate: this.contentTemplate,
      quoteText: this.quoteText,
      imagePaths: this.imagePaths,
      sendViaBot: this.sendViaBot,
      actionButtons: this.actionButtons,
      delayBetweenPosts: this.delayBetweenPosts,
      schedule: this.schedule || this.delayBetweenPosts,
      maxPostsPerDay: this.maxPostsPerDay,
      firstRunMode: this.firstRunMode,
      autoDeleteHours: this.autoDeleteHours,
      useAI: this.useAI,
      obfuscateLinks: this.obfuscateLinks,
      isRunning: this.isRunning,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  static async findRaw(filter = {}, projection = null) {
    await PostCampaignModel.restoreJsonBackupIfEmpty();
    let rows = await all(`SELECT data FROM campaigns ORDER BY createdAt DESC`);
    let items = rows.map((row) => JSON.parse(row.data));
    items = items.filter((item) => PostCampaignModel.matches(item, filter));
    if (projection) {
      items = items.map((item) => PostCampaignModel.pickFields(item, projection));
    }
    return items.map((item) => new PostCampaignModel(item));
  }

  static find(filter = {}, projection = null) {
    return new CampaignFindQuery(filter, projection);
  }

  static async findByIdRaw(id) {
    await PostCampaignModel.restoreJsonBackupIfEmpty();
    const row = await get(`SELECT data FROM campaigns WHERE id = ?`, [id]);
    if (!row) return null;
    return new PostCampaignModel(JSON.parse(row.data));
  }

  static findById(id) {
    return new CampaignFindByIdQuery(id);
  }

  static async findByIdAndUpdate(id, update = {}, options = {}) {
    const current = await PostCampaignModel.findById(id);
    if (!current) return null;
    Object.assign(current, PostCampaignModel.normalizeUpdate(update), { _id: id });
    await current.save();
    return options.new ? current : new PostCampaignModel(current.toObject());
  }

  static async findByIdAndDelete(id) {
    await run(`DELETE FROM campaigns WHERE id = ?`, [id]);
    await PostCampaignModel.writeJsonBackup();
  }

  static async countDocuments(filter = {}) {
    const items = await PostCampaignModel.findRaw(filter);
    return items.length;
  }

  static async updateMany(filter = {}, update = {}) {
    const items = await PostCampaignModel.findRaw(filter);
    const normalizedUpdate = PostCampaignModel.normalizeUpdate(update);
    let changes = 0;
    for (const item of items) {
      Object.assign(item, normalizedUpdate);
      await item.save();
      changes += 1;
    }
    return { modifiedCount: changes };
  }

  static matches(item, filter = {}) {
    return Object.entries(filter).every(([key, expected]) => item[key] === expected);
  }

  static pickFields(item, projection) {
    const fields = projection.split(/\s+/).filter(Boolean);
    const picked = {};
    for (const field of fields) {
      picked[field] = item[field];
    }
    return picked;
  }

  static normalizeUpdate(update = {}) {
    if (update && typeof update === "object" && update.$set) {
      return { ...update.$set };
    }
    return { ...update };
  }

  static async writeJsonBackup() {
    try {
      const rows = await all(`SELECT data FROM campaigns ORDER BY createdAt DESC`);
      const campaigns = rows
        .map((row) => {
          try {
            return JSON.parse(row.data);
          } catch (err) {
            return null;
          }
        })
        .filter(Boolean);
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        campaigns,
      };
      fs.mkdirSync(path.dirname(CAMPAIGN_BACKUP_PATH), { recursive: true });
      const tempPath = `${CAMPAIGN_BACKUP_PATH}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf8");
      fs.renameSync(tempPath, CAMPAIGN_BACKUP_PATH);
    } catch (err) {
      console.warn(`[CampaignBackup] Failed to write ${CAMPAIGN_BACKUP_PATH}:`, err.message);
    }
  }

  static async restoreJsonBackupIfEmpty() {
    const rows = await all(`SELECT COUNT(*) AS count FROM campaigns`);
    if (Number(rows?.[0]?.count || 0) > 0 || !fs.existsSync(CAMPAIGN_BACKUP_PATH)) return;

    let campaigns = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(CAMPAIGN_BACKUP_PATH, "utf8"));
      campaigns = Array.isArray(parsed) ? parsed : parsed.campaigns;
    } catch (err) {
      console.warn(`[CampaignBackup] Failed to read ${CAMPAIGN_BACKUP_PATH}:`, err.message);
      return;
    }
    if (!Array.isArray(campaigns) || campaigns.length === 0) return;

    for (const campaign of campaigns) {
      const normalized = normalizeCampaign(campaign);
      await run(
        `INSERT OR REPLACE INTO campaigns (id, data, createdAt, updatedAt)
         VALUES (?, ?, ?, ?)`,
        [
          normalized._id,
          JSON.stringify(normalized),
          normalized.createdAt,
          normalized.updatedAt,
        ],
      );
    }
    console.log(`[CampaignBackup] Restored ${campaigns.length} campaigns from ${CAMPAIGN_BACKUP_PATH}`);
  }
}

class CampaignFindQuery {
  constructor(filter = {}, projection = null) {
    this.filter = filter;
    this.projection = projection;
    this.sortObj = null;
    this.limitCount = null;
    this.skipCount = null;
  }

  sort(sortObj = {}) {
    this.sortObj = sortObj;
    return this;
  }

  limit(count = 0) {
    this.limitCount = count;
    return this;
  }

  skip(count = 0) {
    this.skipCount = count;
    return this;
  }

  async exec() {
    const items = await PostCampaignModel.findRaw(this.filter, this.projection);
    if (this.sortObj) {
      const [[field, direction]] = Object.entries(this.sortObj);
      items.sort((a, b) => {
        const av = a[field];
        const bv = b[field];
        if (av === bv) return 0;
        const result = av > bv ? 1 : -1;
        return direction >= 0 ? result : -result;
      });
    }
    if (this.skipCount !== null) items.splice(0, this.skipCount);
    if (this.limitCount !== null) items.splice(this.limitCount);
    return items;
  }

  async lean() {
    const items = await this.exec();
    return items.map((item) => item.lean());
  }

  then(resolve, reject) {
    return this.exec().then(resolve, reject);
  }

  catch(reject) {
    return this.exec().catch(reject);
  }

  finally(callback) {
    return this.exec().finally(callback);
  }
}

class CampaignFindByIdQuery {
  constructor(id) {
    this.id = id;
  }

  async exec() {
    return PostCampaignModel.findByIdRaw(this.id);
  }

  async lean() {
    const item = await this.exec();
    return item ? item.lean() : null;
  }

  then(resolve, reject) {
    return this.exec().then(resolve, reject);
  }

  catch(reject) {
    return this.exec().catch(reject);
  }

  finally(callback) {
    return this.exec().finally(callback);
  }
}

module.exports = PostCampaignModel;
