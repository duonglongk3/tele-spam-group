declare global {
  interface Window {
    ipcRenderer: any;
  }
}

// Safe invoke: nếu không chạy trong Electron thì trả về null
function ipc(channel: string, ...args: any[]) {
  if (typeof window !== 'undefined' && window.ipcRenderer) {
    return window.ipcRenderer.invoke(channel, ...args)
  }
  console.warn(`[IPC] Not in Electron context, skipping: ${channel}`)
  return Promise.resolve(null)
}

export const telegramApi = {
  // ─── Accounts ────────────────────────────────────────
  getAccounts: () => ipc('telegram:getAccounts'),
  requestLoginCode: (apiId: string, apiHash: string, phone: string) => 
    ipc('telegram:requestLoginCode', { apiId, apiHash, phone }),
  submitLoginCode: (code: string, password?: string) => 
    ipc('telegram:submitLoginCode', { code, password }),
  importSession: (apiId: string, apiHash: string, sessionString: string) =>
    ipc('telegram:importSession', { apiId, apiHash, sessionString }),
  removeAccount: (accountId: string) => 
    ipc('telegram:removeAccount', { accountId }),
  getPhoto: (accountId: string, peerId?: string) =>
    ipc('telegram:getPhoto', { accountId, peerId }),
  updateProfile: (accountId: string, data: { firstName?: string, lastName?: string, about?: string }) =>
    ipc('telegram:updateProfile', { accountId, ...data }),

  // ─── Dialogs / Groups ───────────────────────────────
  getDialogs: (accountId: string) => 
    ipc('telegram:getDialogs', { accountId }),
  getForumTopics: (accountId: string, chatId: string) =>
    ipc('telegram:getForumTopics', { accountId, chatId }),

  // ─── Messages / Forward / Diagnostics ─────────────────────
  getMessages: (accountId: string, chatId: string, limit?: number) =>
    ipc('telegram:getMessages', { accountId, chatId, limit }),
  getMessageMedia: (accountId: string, chatId: string, messageId: number) =>
    ipc('telegram:getMessageMedia', { accountId, chatId, messageId }),
  forwardMessages: (accountId: string, fromChatId: string, messageIds: number[], toChatIds: string[]) =>
    ipc('telegram:forwardMessages', { accountId, fromChatId, messageIds, toChatIds }),
  scanGroupSecurity: (accountId: string, chatId: string) =>
    ipc('telegram:scanGroupSecurity', { accountId, chatId }),
  validateCampaign: (accountId: string, campaignPayload: any, targetsCache: any[]) =>
    ipc('telegram:validateCampaign', { accountId, campaignPayload, targetsCache }),

  // ─── Campaign (MongoDB) ─────────────────────────────
  getCampaigns: () => ipc('campaign:findAll'),
  getCampaignProgress: () => ipc('campaign:getProgress'),
  saveCampaign: (data: any) => ipc('campaign:save', data),
  deleteCampaign: (id: string) => ipc('campaign:delete', { id }),

  // ─── Logs ───────────────────────────────────────────
  getLogs: (params?: { campaignId?: string, limit?: number, skip?: number }) =>
    ipc('log:findAll', params || {}),
  getLogStats: () => ipc('log:getStats'),

  // ─── Workspace ────────────────────────────────────────
  exportWorkspace: (workspaceId?: string) => 
    ipc('workspace:export', { workspaceId }),
  importWorkspace: () => 
    ipc('workspace:import'),
}
