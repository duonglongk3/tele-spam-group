const { google } = require('googleapis')
const fs = require('fs')
const axios = require('axios')

async function testVerbose() {
  const fileContent = fs.readFileSync('workspace-duaxiemchinhgoc.com.json', 'utf-8')
  const json = JSON.parse(fileContent)
  const creds = json.workspace.credentials

  const oauth2Client = new google.auth.OAuth2(creds.clientId, creds.clientSecret)
  oauth2Client.setCredentials({
    refresh_token: creds.refresh_token,
    access_token: creds.access_token,
    expiry_date: creds.expiry_date
  })

  try {
    const { token } = await oauth2Client.getAccessToken()

    const resList = await axios.get(`https://admin.googleapis.com/admin/directory/v1/users?domain=${json.workspace.domain}&showDeleted=true&maxResults=1`, {
        headers: { Authorization: `Bearer ${token}` }
    })
    
    const user = resList.data.users ? resList.data.users[0] : null
    
    if (user) {
      console.log(`Đang khôi phục: ${user.primaryEmail} (ID: ${user.id})`)
      
      try {
        const resUndelete = await axios.post(`https://admin.googleapis.com/admin/directory/v1/users/${user.id}/undelete`, {
            orgUnitPath: '/'
        }, {
            headers: { 'Authorization': `Bearer ${token}` }
        })

        console.log(`HTTP Status: ${resUndelete.status}`)
        console.log('Response Body:', JSON.stringify(resUndelete.data, null, 2))
      } catch (err2) {
         console.log('LỖI AXIOS UNDELETE:', err2.response?.data || err2.message)
      }
    }
  } catch (err) {
    console.log('LỖI CHÍNH:', err.response?.data || err.message)
  }
}

testVerbose()
