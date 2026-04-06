const { randomUUID } = require("crypto");
const { all, get, run } = require("../db");

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
    nextRunAt: target.nextRunAt || null,
    isDisabled: !!target.isDisabled,
    lastError: target.lastError || "",
  };
}

function normalizeCampaign(data = {}, existing = {}) {
  const now = new Date().toISOString();
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
    schedule: data.schedule || existing.schedule || "60-240",
    firstRunMode:
      ["immediate", "random"].includes(data.firstRunMode)
        ? data.firstRunMode
        : existing.firstRunMode || "immediate",
    autoDeleteHours:
      Number.isFinite(data.autoDeleteHours)
        ? data.autoDeleteHours
        : Number(existing.autoDeleteHours || 0),
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
      schedule: this.schedule,
      firstRunMode: this.firstRunMode,
      autoDeleteHours: this.autoDeleteHours,
      isRunning: this.isRunning,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  static async find(filter = {}, projection = null) {
    let rows = await all(`SELECT data FROM campaigns ORDER BY createdAt DESC`);
    let items = rows.map((row) => JSON.parse(row.data));
    items = items.filter((item) => PostCampaignModel.matches(item, filter));
    if (projection) {
      items = items.map((item) => PostCampaignModel.pickFields(item, projection));
    }
    const collection = items.map((item) => new PostCampaignModel(item));
    collection.lean = async () => collection.map((item) => item.lean());
    return collection;
  }

  static async findById(id) {
    const row = await get(`SELECT data FROM campaigns WHERE id = ?`, [id]);
    if (!row) return null;
    const model = new PostCampaignModel(JSON.parse(row.data));
    model.lean = async () => model.toObject();
    return model;
  }

  static async findByIdAndUpdate(id, update = {}, options = {}) {
    const current = await PostCampaignModel.findById(id);
    if (!current) return null;
    Object.assign(current, update, { _id: id });
    await current.save();
    return options.new ? current : new PostCampaignModel(current.toObject());
  }

  static async findByIdAndDelete(id) {
    await run(`DELETE FROM campaigns WHERE id = ?`, [id]);
  }

  static async countDocuments(filter = {}) {
    const items = await PostCampaignModel.find(filter);
    return items.length;
  }

  static async updateMany(filter = {}, update = {}) {
    const items = await PostCampaignModel.find(filter);
    let changes = 0;
    for (const item of items) {
      Object.assign(item, update);
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
}

module.exports = PostCampaignModel;
