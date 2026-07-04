const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'telegram-auto-post.sqlite3');
const db = new sqlite3.Database(dbPath);

// Đọc settings trước
db.get(`SELECT data FROM settings WHERE type = 'global_app_settings'`, (err, settingRow) => {
  if (err) {
    console.error(err);
    db.close();
    process.exit(1);
  }
  const settings = JSON.parse(settingRow.data);
  const groups = settings.aiLeadEngagementGroups || [];
  
  // Đọc queue
  db.all(`SELECT data FROM ai_lead_queue WHERE status = 'pending'`, (err, rows) => {
    if (err) {
      console.error(err);
      db.close();
      process.exit(1);
    }
    console.log(`Tìm thấy ${rows.length} tin pending.`);
    rows.forEach((row) => {
      const item = JSON.parse(row.data);
      const groupConfig = groups.find(
        (g) => String(g.accountId) === String(item.accountId) && String(g.chatId) === String(item.chatId)
      );
      const isBulkBuyingGroup = groupConfig?.purpose === "bulk_buying";
      const isBuyingStream = (item.sourceType === "private") || isBulkBuyingGroup;
      
      console.log('-----------------------------');
      console.log('Group Title:', item.chatTitle);
      console.log('chatId:', item.chatId);
      console.log('sourceType:', item.sourceType);
      console.log('AI Category:', item.category);
      console.log('Config Purpose:', groupConfig?.purpose);
      console.log('isBulkBuyingGroup:', isBulkBuyingGroup);
      console.log('isBuyingStream (định tuyến mới):', isBuyingStream);
    });
    db.close();
  });
});
