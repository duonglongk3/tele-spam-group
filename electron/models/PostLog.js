const { randomUUID } = require("crypto");
const { all, run } = require("../db");

function normalizeLog(data = {}) {
  return {
    _id: data._id || randomUUID(),
    campaignId: data.campaignId || "",
    campaignName: data.campaignName || "",
    accountId: data.accountId || "",
    accountName: data.accountName || "",
    targetId: data.targetId || "",
    targetName: data.targetName || "",
    targetLink: data.targetLink || "",
    action: data.action || "post",
    status: data.status || "fail",
    contentPreview: data.contentPreview || "",
    sentMessageIds: Array.isArray(data.sentMessageIds) ? data.sentMessageIds : [],
    postLinks: Array.isArray(data.postLinks) ? data.postLinks : [],
    errorMessage: data.errorMessage || "",
    createdAt: data.createdAt || new Date().toISOString(),
  };
}

function matchesCondition(value, expected) {
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    if (expected.$gte !== undefined) return new Date(value) >= new Date(expected.$gte);
    return false;
  }
  return value === expected;
}

class Query {
  constructor(items) {
    this.items = items;
  }

  sort(sortObj = {}) {
    const [[field, direction]] = Object.entries(sortObj);
    this.items.sort((a, b) => {
      const av = a[field];
      const bv = b[field];
      if (av === bv) return 0;
      const result = av > bv ? 1 : -1;
      return direction >= 0 ? result : -result;
    });
    return this;
  }

  limit(count = 0) {
    this.items = this.items.slice(0, count);
    return this;
  }

  skip(count = 0) {
    this.items = this.items.slice(count);
    return this;
  }

  lean() {
    return Promise.resolve(this.items.map((item) => ({ ...item })));
  }

  then(resolve, reject) {
    return Promise.resolve(this.items.map((item) => ({ ...item }))).then(
      resolve,
      reject,
    );
  }
}

class QueryLoader {
  constructor(filter = {}) {
    this.filter = filter;
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
    const rows = await all(`SELECT data FROM post_logs ORDER BY createdAt DESC`);
    let items = rows
      .map((row) => JSON.parse(row.data))
      .filter((item) =>
        Object.entries(this.filter).every(([key, expected]) =>
          matchesCondition(item[key], expected),
        ),
      );

    const query = new Query(items);
    if (this.sortObj) query.sort(this.sortObj);
    if (this.skipCount) query.skip(this.skipCount);
    if (this.limitCount !== null) query.limit(this.limitCount);
    return query;
  }

  async lean() {
    const query = await this.exec();
    return query.lean();
  }

  then(resolve, reject) {
    return this.exec().then((query) => query.then(resolve, reject), reject);
  }
}

class PostLogModel {
  static async create(data) {
    const log = normalizeLog(data);
    await run(
      `INSERT INTO post_logs (id, campaignId, status, createdAt, data) VALUES (?, ?, ?, ?, ?)`,
      [log._id, log.campaignId, log.status, log.createdAt, JSON.stringify(log)],
    );
    return log;
  }

  static find(filter = {}) {
    return new QueryLoader(filter);
  }

  static async countDocuments(filter = {}) {
    const rows = await all(`SELECT data FROM post_logs`);
    return rows
      .map((row) => JSON.parse(row.data))
      .filter((item) =>
        Object.entries(filter).every(([key, expected]) =>
          matchesCondition(item[key], expected),
        ),
      ).length;
  }
}

module.exports = PostLogModel;
