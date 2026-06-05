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
  updateUsername: (accountId: string, username: string) =>
    ipc('telegram:updateUsername', { accountId, username }),
  uploadProfilePhoto: (accountId: string, base64Image: string) =>
    ipc('telegram:uploadProfilePhoto', { accountId, base64Image }),
  deleteProfilePhoto: (accountId: string) =>
    ipc('telegram:deleteProfilePhoto', { accountId }),
  setPrivacySettings: (accountId: string, rules: any) =>
    ipc('telegram:setPrivacySettings', { accountId, rules }),
  manageContacts: (accountId: string, action: string, payload: any) =>
    ipc('telegram:manageContacts', { accountId, action, payload }),

  // ─── Dialogs / Groups ───────────────────────────────
  getDialogs: (accountId: string) => 
    ipc('telegram:getDialogs', { accountId }),
  getForumTopics: (accountId: string, chatId: string) =>
    ipc('telegram:getForumTopics', { accountId, chatId }),
  leaveGroup: (accountId: string, chatId: string) =>
    ipc('telegram:leaveGroup', { accountId, chatId }),
  createChat: (accountId: string, title: string, users: string[], isMega: boolean, about?: string) =>
    ipc('telegram:createChat', { accountId, title, users, isMega, about }),
  editBanned: (accountId: string, chatId: string, usernameOrId: string, action: string) =>
    ipc('telegram:editBanned', { accountId, chatId, usernameOrId, action }),
  createForumTopic: (accountId: string, chatId: string, title: string) =>
    ipc('telegram:createForumTopic', { accountId, chatId, title }),
  editForumTopic: (accountId: string, chatId: string, topicId: number, title?: string, closed?: boolean) =>
    ipc('telegram:editForumTopic', { accountId, chatId, topicId, title, closed }),
  addMember: (accountId: string, chatId: string, userId: string) =>
    ipc('telegram:addMember', { accountId, chatId, userId }),
  removeMember: (accountId: string, chatId: string, userId: string) =>
    ipc('telegram:removeMember', { accountId, chatId, userId }),
  getParticipants: (accountId: string, chatId: string, limit?: number, offset?: number) =>
    ipc('telegram:getParticipants', { accountId, chatId, limit, offset }),
  updateGroupProfile: (accountId: string, chatId: string, data: { title?: string, about?: string, base64Photo?: string }) =>
    ipc('telegram:updateGroupProfile', { accountId, chatId, ...data }),
  editAdmin: (accountId: string, chatId: string, userId: string, adminRights: any, rank: string) =>
    ipc('telegram:editAdmin', { accountId, chatId, userId, adminRights, rank }),
  clickBotButton: (accountId: string, chatId: string, messageId: number, buttonData: string) =>
    ipc('telegram:clickBotButton', { accountId, chatId, messageId, buttonData }),

  // ─── Messages / Forward / Diagnostics / Quick Actions ───────────
  getMessages: (accountId: string, chatId: string, limit?: number) =>
    ipc('telegram:getMessages', { accountId, chatId, limit }),
  getMessageMedia: (accountId: string, chatId: string, messageId: number) =>
    ipc('telegram:getMessageMedia', { accountId, chatId, messageId }),
  sendNow: (payload: any) =>
    ipc('telegram:sendNow', payload),
  forwardMessages: (accountId: string, fromChatId: string, messageIds: number[], toChatIds: string[]) =>
    ipc('telegram:forwardMessages', { accountId, fromChatId, messageIds, toChatIds }),
  scanGroupSecurity: (accountId: string, chatId: string) =>
    ipc('telegram:scanGroupSecurity', { accountId, chatId }),
  validateCampaign: (accountId: string, campaignPayload: any, targetsCache: any[]) =>
    ipc('telegram:validateCampaign', { accountId, campaignPayload, targetsCache }),
  executeQuickAction: (accountId: string, chatId: string, actionType: string, payload: any) =>
    ipc('telegram:executeQuickAction', { accountId, chatId, actionType, payload }),
  searchGlobalChats: (accountId: string, query: string) =>
    ipc('telegram:searchGlobalChats', { accountId, query }),
  joinChat: (accountId: string, linkOrUsername: string) =>
    ipc('telegram:joinChat', { accountId, linkOrUsername }),
  getInviteLink: (accountId: string, chatId: string) =>
    ipc('telegram:getInviteLink', { accountId, chatId }),
  selectImage: () => ipc('app:selectImage'),

  // ─── Campaign (SQLite) ─────────────────────────────
  getCampaigns: () => ipc('campaign:findAll'),
  getCampaignProgress: () => ipc('campaign:getProgress'),
  saveCampaign: (data: any) => ipc('campaign:save', data),
  deleteCampaign: (id: string) => ipc('campaign:delete', { id }),

  // ─── Logs ───────────────────────────────────────────
  getLogs: (params?: { campaignId?: string, limit?: number, skip?: number }) =>
    ipc('log:findAll', params || {}),
  getLogStats: () => ipc('log:getStats'),
  deleteAllLogs: () => ipc('log:deleteAll'),

  // ─── Workspace ────────────────────────────────────────
  exportWorkspace: (workspaceId?: string) => 
    ipc('workspace:export', { workspaceId }),
  importWorkspace: () => 
    ipc('workspace:import'),
}
