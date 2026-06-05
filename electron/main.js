"use strict";

const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  Tray,
  Menu,
  nativeImage,
  protocol,
  net,
} = require("electron");
const path = require("path");

// Cấu hình Scheme bảo mật app:// cho NextJS
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true,
    },
  },
]);

// Store will be dynamically imported because electron-store v10+ is ESM-only
let store;

// Initialize encrypted store dynamically
async function initStore() {
  const { default: Store } = await import("electron-store");
  store = new Store({
    name: "google-admin-credentials",
    encryptionKey: "gat-local-encryption-key-v1",
    schema: {
      workspaces: {
        type: "array",
        default: [],
      },
      settings: {
        type: "object",
        default: { theme: "system" },
      },
    },
  });
}

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
let mainWindow = null;
let tray = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0a0a0a",
    icon: path.join(__dirname, "..", "public", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Load app
  if (isDev) {
    mainWindow.loadURL("http://localhost:3000");
  } else {
    // Sử dụng custom scheme để tránh lỗi đường dẫn /_next/ file://
    mainWindow.loadURL("app://-/index.html");
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

// IPC Handlers for electron-store
ipcMain.handle("store:get", (_, key) => {
  return store.get(key);
});

ipcMain.handle("store:set", (_, key, value) => {
  store.set(key, value);
  return true;
});

ipcMain.handle("store:delete", (_, key) => {
  store.delete(key);
  return true;
});

ipcMain.handle("store:getAll", () => {
  return store.store;
});

// IPC: send native notification
ipcMain.handle("notification:send", (_, { title, body }) => {
  const { Notification } = require("electron");
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
});

// IPC: Export workspace session ra file
ipcMain.handle("workspace:export", async (_, { workspaceId }) => {
  try {
    const { dialog } = require("electron");
    const fs = require("fs");
    const workspaces = store.get("workspaces") || [];
    const ws = workspaces.find((w) => w.id === workspaceId);
    if (!ws) return { success: false, error: "Workspace not found" };

    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: "Lưu phiên Workspace",
      defaultPath: `workspace-${ws.name.replace(/\s+/g, "_")}.json`,
      filters: [{ name: "JSON Files", extensions: ["json"] }],
    });
    if (!filePath) return { success: false, error: "Cancelled" };

    const exportData = {
      _exportVersion: 1,
      _exportedAt: new Date().toISOString(),
      workspace: ws,
    };
    fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2), "utf-8");
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// IPC: Import workspace session từ file
ipcMain.handle("workspace:import", async () => {
  try {
    const { dialog } = require("electron");
    const fs = require("fs");
    const { filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: "Chọn file Workspace đã export",
      filters: [{ name: "JSON Files", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (!filePaths || filePaths.length === 0)
      return { success: false, error: "Cancelled" };

    const raw = fs.readFileSync(filePaths[0], "utf-8");
    const data = JSON.parse(raw);
    if (!data._exportVersion || !data.workspace) {
      return {
        success: false,
        error: "File không hợp lệ (thiếu _exportVersion hoặc workspace)",
      };
    }
    const ws = data.workspace;
    // Migration: workspace cũ có domain (string) → chuyển sang domains (array)
    if (!ws.domains || ws.domains.length === 0) {
      if (ws.domain) {
        ws.domains = [ws.domain];
      } else {
        ws.domains = [];
      }
    }
    // Kiểm tra trùng lặp
    const existing = store.get("workspaces") || [];
    if (existing.find((w) => w.id === ws.id)) {
      return { success: false, error: `Workspace "${ws.name}" đã tồn tại rồi` };
    }
    store.set("workspaces", [...existing, ws]);
    // Init Google Service ngay
    const { initAdminService } = require("./googleService");
    initAdminService(ws.id, ws.credentials, ws.adminEmail);
    return { success: true, workspace: ws };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// IPC: Chọn hình ảnh cho bài đăng
ipcMain.handle("app:selectImage", async () => {
  try {
    const { dialog } = require("electron");
    const { filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: "Chọn hình ảnh cho bài đăng",
      filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "webp"] }],
      properties: ["openFile"],
    });
    if (!filePaths || filePaths.length === 0)
      return { success: false, error: "Cancelled" };
    return { success: true, filePath: filePaths[0] };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// IPC: Telegram Accounts
ipcMain.handle("telegram:getAccounts", () => {
  const telegramService = require("./telegramService");
  return telegramService.getAccounts();
});

ipcMain.handle(
  "telegram:requestLoginCode",
  async (_, { apiId, apiHash, phone }) => {
    const telegramService = require("./telegramService");
    try {
      return await telegramService.requestLoginCode(apiId, apiHash, phone);
    } catch (e) {
      return { success: false, error: e.message };
    }
  },
);

ipcMain.handle("telegram:submitLoginCode", async (_, { code, password }) => {
  const telegramService = require("./telegramService");
  try {
    return await telegramService.submitLoginCode(code, password);
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle(
  "telegram:importSession",
  async (_, { apiId, apiHash, sessionString }) => {
    const telegramService = require("./telegramService");
    try {
      return await telegramService.importSession(apiId, apiHash, sessionString);
    } catch (e) {
      return { success: false, error: e.message };
    }
  },
);

ipcMain.handle("telegram:removeAccount", async (_, { accountId }) => {
  const telegramService = require("./telegramService");
  try {
    return await telegramService.removeAccount(accountId);
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("telegram:getDialogs", async (_, { accountId }) => {
  const telegramService = require("./telegramService");
  try {
    const dialogs = await telegramService.getDialogs(accountId);
    return { success: true, dialogs };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("telegram:leaveGroup", async (_, { accountId, chatId }) => {
  const telegramService = require("./telegramService");
  try {
    return await telegramService.leaveGroup(accountId, chatId);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("telegram:getForumTopics", async (_, { accountId, chatId }) => {
  const telegramService = require("./telegramService");
  try {
    const topics = await telegramService.getForumTopics(accountId, chatId);
    return { success: true, topics };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle(
  "telegram:getMessages",
  async (_, { accountId, chatId, limit }) => {
    const telegramService = require("./telegramService");
    try {
      const messages = await telegramService.getMessages(
        accountId,
        chatId,
        limit || 30,
      );
      return { success: true, messages };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle(
  "telegram:scanGroupSecurity",
  async (_, { accountId, chatId }) => {
    const telegramService = require("./telegramService");
    try {
      return await telegramService.scanGroupSecurity(accountId, chatId);
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle(
  "telegram:validateCampaign",
  async (_, { accountId, campaignPayload, targetsCache }) => {
    const telegramService = require("./telegramService");
    try {
      return await telegramService.validateCampaign(
        accountId,
        campaignPayload,
        targetsCache,
      );
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle(
  "telegram:getMessageMedia",
  async (_, { accountId, chatId, messageId }) => {
    const telegramService = require("./telegramService");
    try {
      return await telegramService.getMessageMedia(
        accountId,
        chatId,
        messageId,
      );
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle("telegram:sendNow", async (_, payload) => {
  const autoPostService = require("./autoPostService");
  try {
    return await autoPostService.sendNow(payload);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle(
  "telegram:forwardMessages",
  async (_, { accountId, fromChatId, messageIds, toChatIds }) => {
    const telegramService = require("./telegramService");
    try {
      const results = await telegramService.forwardMessages(
        accountId,
        fromChatId,
        messageIds,
        toChatIds,
      );
      return { success: true, results };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle("telegram:getPhoto", async (_, { accountId, peerId }) => {
  const telegramService = require("./telegramService");
  try {
    return await telegramService.getPhoto(accountId, peerId);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle(
  "telegram:updateProfile",
  async (_, { accountId, firstName, lastName, about }) => {
    const telegramService = require("./telegramService");
    try {
      return await telegramService.updateProfile(accountId, {
        firstName,
        lastName,
        about,
      });
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle(
  "telegram:updateUsername",
  async (_, { accountId, username }) => {
    const telegramService = require("./telegramService");
    try {
      return await telegramService.updateUsername(accountId, username);
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle(
  "telegram:uploadProfilePhoto",
  async (_, { accountId, base64Image }) => {
    const telegramService = require("./telegramService");
    try {
      return await telegramService.uploadProfilePhoto(accountId, base64Image);
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle(
  "telegram:deleteProfilePhoto",
  async (_, { accountId }) => {
    const telegramService = require("./telegramService");
    try {
      return await telegramService.deleteProfilePhoto(accountId);
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle(
  "telegram:setPrivacySettings",
  async (_, { accountId, rules }) => {
    const telegramService = require("./telegramService");
    try {
      return await telegramService.setPrivacySettings(accountId, rules);
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle(
  "telegram:manageContacts",
  async (_, { accountId, action, payload }) => {
    const telegramService = require("./telegramService");
    try {
      return await telegramService.manageContacts(accountId, action, payload);
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle(
  "telegram:createChat",
  async (_, { accountId, title, users, isMega, about }) => {
    const telegramService = require("./telegramService");
    try {
      return await telegramService.createChat(accountId, title, users, isMega, about);
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle(
  "telegram:editBanned",
  async (_, { accountId, chatId, usernameOrId, action }) => {
    const telegramService = require("./telegramService");
    try {
      return await telegramService.editBanned(accountId, chatId, usernameOrId, action);
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle(
  "telegram:createForumTopic",
  async (_, { accountId, chatId, title }) => {
    const telegramService = require("./telegramService");
    try {
      return await telegramService.createForumTopic(accountId, chatId, title);
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle(
  "telegram:editForumTopic",
  async (_, { accountId, chatId, topicId, title, closed }) => {
    const telegramService = require("./telegramService");
    try {
      return await telegramService.editForumTopic(accountId, chatId, topicId, title, closed);
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle(
  "telegram:addMember",
  async (_, { accountId, chatId, userId }) => {
    const telegramService = require("./telegramService");
    try {
      return await telegramService.addMember(accountId, chatId, userId);
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle(
  "telegram:removeMember",
  async (_, { accountId, chatId, userId }) => {
    const telegramService = require("./telegramService");
    try {
      return await telegramService.removeMember(accountId, chatId, userId);
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle(
  "telegram:executeQuickAction",
  async (_, { accountId, chatId, actionType, payload }) => {
    const telegramService = require("./telegramService");
    try {
      return await telegramService.executeQuickAction(accountId, chatId, actionType, payload);
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle(
  "telegram:searchGlobalChats",
  async (_, { accountId, query }) => {
    const telegramService = require("./telegramService");
    try {
      return await telegramService.searchGlobalChats(accountId, query);
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle(
  "telegram:joinChat",
  async (_, { accountId, linkOrUsername }) => {
    const telegramService = require("./telegramService");
    try {
      return await telegramService.joinChat(accountId, linkOrUsername);
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle(
  "telegram:getInviteLink",
  async (_, { accountId, chatId }) => {
    const telegramService = require("./telegramService");
    try {
      return await telegramService.getInviteLink(accountId, chatId);
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle(
  "telegram:getParticipants",
  async (_, { accountId, chatId, limit, offset }) => {
    const telegramService = require("./telegramService");
    try {
      return await telegramService.getParticipants(accountId, chatId, limit, offset);
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle(
  "telegram:updateGroupProfile",
  async (_, { accountId, chatId, title, about, base64Photo }) => {
    const telegramService = require("./telegramService");
    try {
      return await telegramService.updateGroupProfile(accountId, chatId, { title, about, base64Photo });
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle(
  "telegram:editAdmin",
  async (_, { accountId, chatId, userId, adminRights, rank }) => {
    const telegramService = require("./telegramService");
    try {
      return await telegramService.editAdmin(accountId, chatId, userId, adminRights, rank);
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle(
  "telegram:clickBotButton",
  async (_, { accountId, chatId, messageId, buttonData }) => {
    const telegramService = require("./telegramService");
    try {
      return await telegramService.clickBotButton(accountId, chatId, messageId, buttonData);
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

// IPC: Post Campaigns (SQLite)
ipcMain.handle("campaign:findAll", async () => {
  const PostCampaign = require("./models/PostCampaign");
  try {
    const campaigns = (await PostCampaign.find()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return { success: true, campaigns: JSON.parse(JSON.stringify(campaigns)) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("campaign:getProgress", async () => {
  const autoPostManager = require("./autoPostService");
  try {
    const progress = autoPostManager.getProgress();
    return { success: true, progress };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("campaign:save", async (_, campaignData) => {
  const PostCampaign = require("./models/PostCampaign");
  try {
    if (campaignData._id) {
      const updated = await PostCampaign.findByIdAndUpdate(
        campaignData._id,
        campaignData,
        { new: true },
      );
      return { success: true, campaign: JSON.parse(JSON.stringify(updated)) };
    } else {
      const newCampaign = new PostCampaign(campaignData);
      await newCampaign.save();
      return {
        success: true,
        campaign: JSON.parse(JSON.stringify(newCampaign)),
      };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("campaign:delete", async (_, { id }) => {
  const PostCampaign = require("./models/PostCampaign");
  try {
    await PostCampaign.findByIdAndDelete(id);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// IPC: Post Logs (Lịch sử hành động)
ipcMain.handle("log:findAll", async (_, { campaignId, limit, skip } = {}) => {
  const PostLog = require("./models/PostLog");
  try {
    const query = campaignId ? { campaignId } : {};
    const logs = await PostLog.find(query)
      .sort({ createdAt: -1 })
      .limit(limit || 100)
      .skip(skip || 0)
      .lean();
    const total = await PostLog.countDocuments(query);
    return { success: true, logs, total };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("log:deleteAll", async () => {
  const PostLog = require("./models/PostLog");
  try {
    await PostLog.deleteAll();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("log:getStats", async () => {
  const PostLog = require("./models/PostLog");
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todaySuccess = await PostLog.countDocuments({
      status: "success",
      createdAt: { $gte: today },
    });
    const todayFail = await PostLog.countDocuments({
      status: "fail",
      createdAt: { $gte: today },
    });
    const totalSuccess = await PostLog.countDocuments({ status: "success" });
    const totalFail = await PostLog.countDocuments({ status: "fail" });

    return { success: true, todaySuccess, todayFail, totalSuccess, totalFail };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

app.whenReady().then(async () => {
  // Handler phục vụ các file tĩnh thư mục /out qua protocol app://
  protocol.handle("app", async (request) => {
    let url = request.url.replace(/^app:\/\/[^\/]*\//, "");
    if (!url || url === "") url = "index.html";
    url = url.split("?")[0].split("#")[0];

    const fs = require("fs");
    let absolutePath = path.join(__dirname, "..", "out", url);

    // Khớp tự động NextJS Route sang đuôi .html
    if (!fs.existsSync(absolutePath)) {
      if (fs.existsSync(absolutePath + ".html")) {
        absolutePath += ".html";
      } else if (fs.existsSync(path.join(absolutePath, "index.html"))) {
        absolutePath = path.join(absolutePath, "index.html");
      } else {
        absolutePath = path.join(__dirname, "..", "out", "index.html");
      }
    }

    const ext = path.extname(absolutePath).toLowerCase();
    let mimeType = "text/plain";
    if (ext === ".html") mimeType = "text/html";
    else if (ext === ".js") mimeType = "text/javascript";
    else if (ext === ".css") mimeType = "text/css";
    else if (ext === ".json") mimeType = "application/json";
    else if (ext === ".png") mimeType = "image/png";
    else if (ext === ".svg") mimeType = "image/svg+xml";
    else if (ext === ".txt") mimeType = "text/plain";

    try {
      const data = await require("fs/promises").readFile(absolutePath);
      return new Response(data, { headers: { "Content-Type": mimeType } });
    } catch (err) {
      return new Response("Not Found", { status: 404 });
    }
  });

  require("dotenv").config();
  const { connectDB } = require("./db");
  await connectDB();

  await initStore();

  // Telegram Background Services
  const telegramService = require("./telegramService");
  telegramService
    .init(store)
    .catch((err) => console.error("[Telegram Init Error]", err));

  const botService = require("./botService");
  botService.initBot().catch((err) => console.error("[Bot Init Error]", err));

  // Start Background Automation Scheduler
  try {
    const PostCampaign = require("./models/PostCampaign");
    await PostCampaign.updateMany({}, { isRunning: false });
    const autoPostService = require("./autoPostService");
    autoPostService.start();
    console.log("[Scheduler] AutoPost Background jobs started and campaigns reset to stopped");
  } catch (err) {
    console.warn("[Scheduler] Failed to start:", err.message);
  }

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

const GlobalSetting = require("./models/Setting");

// IPC: Settings
ipcMain.handle("settings:get", async () => {
  try {
    let s = await GlobalSetting.findOne({ type: "global_app_settings" });
    if (s && !s.telegramPairToken) {
      s.telegramPairToken =
        "admin_" + Math.random().toString(36).substring(2, 10);
      await s.save();
    }
    return {
      success: true,
      settings: s ? (typeof s.toObject === "function" ? s.toObject() : s) : null,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("settings:save", async (_, data) => {
  try {
    let s = await GlobalSetting.findOne({ type: "global_app_settings" });
    if (!s) {
      s = new GlobalSetting({ type: "global_app_settings", ...data });
    } else {
      Object.assign(s, data);
    }
    await s.save();
    return {
      success: true,
      settings: typeof s.toObject === "function" ? s.toObject() : s,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("bot:restart", async () => {
  try {
    const botService = require("./botService");
    await botService.initBot();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
