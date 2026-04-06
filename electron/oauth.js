const { shell } = require('electron')
const http = require('http')
const url = require('url')
const { google } = require('googleapis')

/**
 * Mở Web để user Login Google, sau đó bật http server ở port 3001 
 * để đón code sinh ra, rồi đổi code lấy refresh_token.
 */
function loginWithOAuth2(clientId, clientSecret) {
  return new Promise((resolve, reject) => {
    // 1. Tạo OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      'http://127.0.0.1:3001/oauth2callback'
    )

    // 2. Tạo link cấp quyền
    const scopes = [
      'https://www.googleapis.com/auth/admin.directory.user',
      'https://www.googleapis.com/auth/admin.directory.group',
      'https://www.googleapis.com/auth/admin.directory.orgunit',
      'https://www.googleapis.com/auth/admin.directory.rolemanagement',
      'https://www.googleapis.com/auth/admin.reports.audit.readonly',
      'https://www.googleapis.com/auth/admin.reports.usage.readonly'
    ]

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent' // Ép hiện màn hình consent để Google luôn nhả refresh_token
    })

    // 3. Khởi tạo một Web Server tạm ở local để hứng request trả về
    const server = http.createServer(async (req, res) => {
      try {
        const parsedUrl = url.parse(req.url, true)
        
        // Nếu là path callback của Google
        if (parsedUrl.pathname === '/oauth2callback') {
          const code = parsedUrl.query.code
          const error = parsedUrl.query.error

          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end('<h1>Lỗi uỷ quyền</h1><p>Bạn đã từ chối cấp quyền.</p><script>window.close()</script>')
            server.close()
            return reject(new Error('User denied access: ' + error))
          }

          if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end('<h1>Đăng nhập hoàn tất!</h1><p>Đã lấy được uỷ quyền. Bạn có thể đóng tab này và quay lại phần mềm.</p><script>window.close()</script>')
            server.close()

            // Dùng code đổi lấy token
            const { tokens } = await oauth2Client.getToken(code)
            // Cần lưu lại tokens (có chứa access_token, refresh_token)
            resolve(tokens)
          } else {
            res.end('<h1>Không tìm thấy Authorization code</h1>')
            server.close()
            reject(new Error('No code found in url'))
          }
        } else {
          // Ignore other paths (e.g., favicon)
          res.end('')
        }
      } catch (err) {
        res.end(`<h1>Lỗi nội bộ: ${err.message}</h1>`)
        server.close()
        reject(err)
      }
    })

    // 4. Bật server và tự mở cửa sổ Web
    server.listen(3001, '127.0.0.1', () => {
      console.log('[OAuth2] Local server đang đợi callback tại port 3001...')
      shell.openExternal(authUrl)
    })

    // Auto timeout sau 3 phút nếu user không thao tác
    setTimeout(() => {
      if (server.listening) {
        server.close()
        reject(new Error('OAuth login timed out (3 phút)'))
      }
    }, 3 * 60 * 1000)
  })
}

module.exports = {
  loginWithOAuth2
}
