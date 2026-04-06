// Google Service module for Electron main process
// This file runs in the main process where Node.js APIs are available

let adminServiceCache = new Map()

function createAdminService(credentials, subject) {
  const { google } = require('googleapis')
  
  // Hỗ trợ OAuth 2.0 Desktop Flow
  if (credentials.refresh_token && credentials.clientId && credentials.clientSecret) {
    const oauth2Client = new google.auth.OAuth2(
      credentials.clientId,
      credentials.clientSecret
    )
    
    oauth2Client.setCredentials({ 
      refresh_token: credentials.refresh_token,
      access_token: credentials.access_token,
      expiry_date: credentials.expiry_date
    })

    // Lắng nghe sự kiện Tự động lấy Refresh Token để cập nhật vào file cấu hình
    oauth2Client.on('tokens', async (tokens) => {
      if (tokens.access_token) {
        credentials.access_token = tokens.access_token
        credentials.expiry_date = tokens.expiry_date
        if (tokens.refresh_token) {
          credentials.refresh_token = tokens.refresh_token
        }
        
        try {
          const { default: Store } = await import('electron-store')
          const store = new Store()
          const workspaces = store.get('workspaces') || []
          
          // Match by client_email
          const wsIdx = workspaces.findIndex(w => w.credentials.client_email === credentials.client_email)
          if (wsIdx !== -1) {
             workspaces[wsIdx].credentials = credentials
             store.set('workspaces', workspaces)
             console.log(`[OAuth2] Auto-saved new tokens for workspace ${workspaces[wsIdx].name}`)
          }
        } catch (e) {
          console.warn('Failed to save refreshed tokens:', e)
        }
      }
    })

    return google.admin({ version: 'directory_v1', auth: oauth2Client })
  } 
  
  // Hỗ trợ Service Account
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [
      'https://www.googleapis.com/auth/admin.directory.user',
      'https://www.googleapis.com/auth/admin.directory.orgunit',
      'https://www.googleapis.com/auth/admin.directory.group',
      'https://www.googleapis.com/auth/admin.directory.group.member',
      'https://www.googleapis.com/auth/admin.directory.rolemanagement',
      'https://www.googleapis.com/auth/admin.directory.domain.readonly',
      'https://www.googleapis.com/auth/admin.reports.audit.readonly',
      'https://www.googleapis.com/auth/admin.reports.usage.readonly'
    ],
    subject,
  })
  return google.admin({ version: 'directory_v1', auth })
}

function initAdminService(workspaceId, credentials, subject) {
  const service = createAdminService(credentials, subject)
  adminServiceCache.set(workspaceId, service)
}

async function getAdminService(workspaceId) {
  let service = adminServiceCache.get(workspaceId)
  if (!service) {
    // Thử auto-reinit nếu người dùng force reload UI làm mất cache nhưng dữ liệu vẫn còn trong Store
    try {
      const { default: Store } = await import('electron-store')
      const store = new Store()
      const workspaces = store.get('workspaces') || []
      const ws = workspaces.find(w => w.id === workspaceId)
      if (ws) {
        initAdminService(ws.id, ws.credentials, ws.adminEmail)
        service = adminServiceCache.get(workspaceId)
      }
    } catch (e) {
      console.warn('Auto restore failed:', e)
    }
  }
  if (!service) throw new Error(`Workspace ${workspaceId} chưa được khởi tạo. Vui lòng thử khởi động lại ứng dụng.`)
  return service
}

// ====== USERS ======
async function listUsers(workspaceId, domain, options = {}) {
  const service = await getAdminService(workspaceId)
  const params = {
    domain,
    maxResults: options.maxResults ?? 500,
    showDeleted: options.showDeleted ?? false,
    orderBy: options.orderBy ?? 'email',
  }
  if (options.pageToken) params.pageToken = options.pageToken
  if (options.query) params.query = options.query
  const res = await service.users.list(params)
  return { users: res.data.users ?? [], nextPageToken: res.data.nextPageToken }
}

async function getAllUsers(workspaceId, domain) {
  const all = []
  let pageToken
  do {
    const { users, nextPageToken } = await listUsers(workspaceId, domain, { pageToken })
    all.push(...users)
    pageToken = nextPageToken
  } while (pageToken)
  return all
}

async function getUser(workspaceId, userKey) {
  const service = await getAdminService(workspaceId)
  const res = await service.users.get({ userKey })
  return res.data
}

async function createUser(workspaceId, userData) {
  const service = await getAdminService(workspaceId)
  const res = await service.users.insert({ requestBody: userData })
  return res.data
}

async function updateUser(workspaceId, userKey, updates) {
  const service = await getAdminService(workspaceId)
  const res = await service.users.update({ userKey, requestBody: updates })
  return res.data
}

async function deleteUser(workspaceId, userKey) {
  const service = await getAdminService(workspaceId)
  await service.users.delete({ userKey })
  return true
}

async function undeleteUser(workspaceId, userKey, orgUnitPath) {
  const service = await getAdminService(workspaceId)
  const requestBody = { orgUnitPath: orgUnitPath || '/' }
  await service.users.undelete({ userKey, requestBody })
  return true
}

async function makeAdmin(workspaceId, userKey, status) {
  const service = await getAdminService(workspaceId)
  await service.users.makeAdmin({ userKey, requestBody: { status } })
  return true
}

async function suspendUser(workspaceId, userKey) {
  return updateUser(workspaceId, userKey, { suspended: true })
}

async function unsuspendUser(workspaceId, userKey) {
  return updateUser(workspaceId, userKey, { suspended: false })
}

async function resetPassword(workspaceId, userKey, newPassword, forceChange = true) {
  return updateUser(workspaceId, userKey, {
    password: newPassword,
    changePasswordAtNextLogin: forceChange,
  })
}

async function testConnection(credentials, subject) {
  try {
    const tmpId = 'test_' + Date.now()
    initAdminService(tmpId, credentials, subject)
    const service = await getAdminService(tmpId)
    const res = await service.domains.list({ customer: 'my_customer' })
    adminServiceCache.delete(tmpId)
    return !!res.data
  } catch (err) {
    return false
  }
}

// ====== DOMAINS ======
async function listDomains(workspaceId) {
  const service = await getAdminService(workspaceId)
  const res = await service.domains.list({ customer: 'my_customer' })
  return (res.data.domains ?? []).map(d => ({
    domainName: d.domainName,
    isPrimary: d.isPrimary || false,
    verified: d.verified || false,
  }))
}

// ====== DELETED USERS (full pagination) ======
async function getAllDeletedUsers(workspaceId, domain) {
  const all = []
  let pageToken
  do {
    const { users, nextPageToken } = await listUsers(workspaceId, domain, { showDeleted: true, pageToken })
    all.push(...users)
    pageToken = nextPageToken
  } while (pageToken)
  return all
}

// ====== ORG UNITS ======
async function listOrgUnits(workspaceId, customerId) {
  const service = await getAdminService(workspaceId)
  const res = await service.orgunits.list({ customerId, type: 'all' })
  return res.data.organizationUnits ?? []
}

async function createOrgUnit(workspaceId, customerId, data) {
  const service = await getAdminService(workspaceId)
  const res = await service.orgunits.insert({ customerId, requestBody: data })
  return res.data
}

async function deleteOrgUnit(workspaceId, customerId, orgUnitPath) {
  const service = await getAdminService(workspaceId)
  await service.orgunits.delete({ customerId, orgUnitPath })
  return true
}

// ====== GROUPS ======
async function listGroups(workspaceId, domain) {
  const service = await getAdminService(workspaceId)
  const res = await service.groups.list({ domain, maxResults: 200 })
  return res.data.groups ?? []
}

async function createGroup(workspaceId, data) {
  const service = await getAdminService(workspaceId)
  const res = await service.groups.insert({ requestBody: data })
  return res.data
}

async function deleteGroup(workspaceId, groupKey) {
  const service = await getAdminService(workspaceId)
  await service.groups.delete({ groupKey })
  return true
}

async function listGroupMembers(workspaceId, groupKey) {
  const service = await getAdminService(workspaceId)
  const res = await service.members.list({ groupKey, maxResults: 200 })
  return res.data.members ?? []
}

async function addGroupMember(workspaceId, groupKey, email, role = 'MEMBER') {
  const service = await getAdminService(workspaceId)
  await service.members.insert({ groupKey, requestBody: { email, role } })
  return true
}

async function removeGroupMember(workspaceId, groupKey, memberKey) {
  const service = await getAdminService(workspaceId)
  await service.members.delete({ groupKey, memberKey })
  return true
}

// ====== ROLES ======
async function listRoles(workspaceId, customerId) {
  const service = await getAdminService(workspaceId)
  const res = await service.roles.list({ customer: customerId })
  return res.data.items ?? []
}

async function listRoleAssignments(workspaceId, customerId) {
  const service = await getAdminService(workspaceId)
  const res = await service.roleAssignments.list({ customer: customerId, maxResults: 200 })
  return res.data.items ?? []
}

async function assignRole(workspaceId, customerId, userKey, roleId) {
  const service = await getAdminService(workspaceId)
  await service.roleAssignments.insert({
    customer: customerId,
    requestBody: { assignedTo: userKey, roleId, scopeType: 'CUSTOMER' },
  })
  return true
}

async function revokeRole(workspaceId, customerId, roleAssignmentId) {
  const service = await getAdminService(workspaceId)
  await service.roleAssignments.delete({ customer: customerId, roleAssignmentId })
  return true
}

async function getDashboardStats(workspaceId, domain) {
  const [allUsers, orgUnits, groups] = await Promise.all([
    getAllUsers(workspaceId, domain),
    listOrgUnits(workspaceId, 'my_customer'),
    listGroups(workspaceId, domain),
  ])
  const activeUsers = allUsers.filter(u => !u.suspended)
  const suspendedUsers = allUsers.filter(u => u.suspended)
  const admins = allUsers.filter(u => u.isAdmin)
  const without2FA = allUsers.filter(u => !u.isEnrolledIn2Sv && !u.suspended)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const inactive = activeUsers.filter(u => !u.lastLoginTime || u.lastLoginTime < thirtyDaysAgo)

  return {
    totalUsers: allUsers.length,
    activeUsers: activeUsers.length,
    suspendedUsers: suspendedUsers.length,
    deletedUsers: 0,
    totalOrgUnits: orgUnits.length,
    totalGroups: groups.length,
    totalAdmins: admins.length,
    usersWithout2FA: without2FA.length,
    inactiveUsers: inactive.length,
    allUsers,
    orgUnits,
    groups,
  }
}

module.exports = {
  initAdminService,
  getAdminService,
  listUsers,
  getAllUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  undeleteUser,
  makeAdmin,
  suspendUser,
  unsuspendUser,
  resetPassword,
  testConnection,
  listDomains,
  getAllDeletedUsers,
  listOrgUnits,
  createOrgUnit,
  deleteOrgUnit,
  listGroups,
  createGroup,
  deleteGroup,
  listGroupMembers,
  addGroupMember,
  removeGroupMember,
  listRoles,
  listRoleAssignments,
  assignRole,
  revokeRole,
  getDashboardStats,
}
