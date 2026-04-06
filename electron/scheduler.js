const cron = require('node-cron')
const { Notification } = require('electron')
const { getAllUsers, suspendUser } = require('./googleService')

function startScheduler(store) {
  // Chạy cron 1 phút / lần (dùng cho debug/demo)
  // Trong thực tế sẽ là '0 1 * * *' (1h sáng mỗi ngày)
  cron.schedule('* * * * *', async () => {
    try {
      const workspaces = store.get('workspaces') || []
      const rules = store.get('automationRules') || []
      const enabledRules = rules.filter(r => r.enabled)

      if (workspaces.length === 0 || enabledRules.length === 0) return

      for (const rule of enabledRules) {
        if (rule.type === 'auto_suspend' && rule.config.inactiveDays) {
          const limitTime = Date.now() - (rule.config.inactiveDays * 24 * 60 * 60 * 1000)

          for (const ws of workspaces) {
            // Chỉ chạy nếu workspace có credentials hợp lệ
            if (!ws.credentials) continue
            
            try {
              const users = await getAllUsers(ws.id, ws.domain)
              let suspendCount = 0

              for (const u of users) {
                if (u.suspended) continue
                if (u.isAdmin || u.isSuperAdmin) continue // Bảo vệ Admin

                // Tính toán thời gian hoạt động cuối cùng
                const loginTimeStr = u.lastLoginTime
                const creationTimeStr = u.creationTime

                let lastActive = Date.now()
                if (loginTimeStr && !loginTimeStr.startsWith('1970')) {
                  lastActive = new Date(loginTimeStr).getTime()
                } else if (creationTimeStr) {
                  lastActive = new Date(creationTimeStr).getTime()
                }

                if (lastActive < limitTime) {
                  await suspendUser(ws.id, u.primaryEmail)
                  suspendCount++
                }
              }

              // Gửi Notification Desktop báo cáo Admin
              if (suspendCount > 0 && Notification.isSupported()) {
                new Notification({
                  title: 'Automation - Auto Suspend',
                  body: `Rule "${rule.name}" đã suspend ${suspendCount} users trên domain ${ws.domain} (>${rule.config.inactiveDays} ngày inactive).`
                }).show()
              }

            } catch (err) {
              console.error(`[Scheduler] Lỗi chạy auto_suspend (${ws.domain}):`, err.message)
            }
          }
        }
      }
    } catch (err) {
      console.error('[Scheduler] System Error:', err)
    }
  })
}

module.exports = { startScheduler }
