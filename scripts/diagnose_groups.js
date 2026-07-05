const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(__dirname, '..', 'data', 'telegram-auto-post.sqlite3');
console.log('Connecting to database:', dbPath);

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('Error connecting to DB:', err.message);
    process.exit(1);
  }
});

// Load settings
db.get(`SELECT data FROM settings WHERE type = 'global_app_settings'`, [], (err, settingsRow) => {
  if (err) {
    console.error('Error querying settings:', err.message);
    db.close();
    process.exit(1);
  }

  if (!settingsRow) {
    console.log('No settings found!');
    db.close();
    process.exit(1);
  }

  const settings = JSON.parse(settingsRow.data);
  const configuredGroups = settings.aiLeadEngagementGroups || [];
  
  // Query all queue items
  db.all(`SELECT data FROM ai_lead_queue`, [], (err, queueRows) => {
    if (err) {
      console.error('Error querying queue:', err.message);
      db.close();
      process.exit(1);
    }

    const items = queueRows.map(row => {
      try {
        return JSON.parse(row.data);
      } catch (e) {
        return null;
      }
    }).filter(Boolean);

    // Group items by chatId
    const groupStats = {};
    for (const item of items) {
      const chatId = String(item.chatId || '').replace(/^-100/, '');
      if (!groupStats[chatId]) {
        groupStats[chatId] = {
          total: 0,
          pending: 0,
          sent: 0,
          skipped: 0
        };
      }
      groupStats[chatId].total += 1;
      if (item.status === 'pending') groupStats[chatId].pending += 1;
      if (item.status === 'sent') groupStats[chatId].sent += 1;
      if (item.status === 'skipped') groupStats[chatId].skipped += 1;
    }

    console.log('\n=== KẾT QUẢ PHÂN TÍCH HOẠT ĐỘNG CÁC NHÓM (GROUPS) ===\n');
    console.log(`Tổng số nhóm được cấu hình: ${configuredGroups.length}\n`);

    const normalize = (value) => String(value || '').replace(/^-100/, '');

    const tableData = configuredGroups.map((g, index) => {
      const normChatId = normalize(g.chatId);
      const stats = groupStats[normChatId] || { total: 0, pending: 0, sent: 0, skipped: 0 };
      return {
        'STT': index + 1,
        'Tên Nhóm': g.title || 'Không rõ tên',
        'Username': g.username ? `@${g.username}` : 'N/A',
        'Tổng tin nhắn': stats.total,
        'Đang chờ': stats.pending,
        'Đã gửi': stats.sent,
        'Bỏ qua': stats.skipped,
        'Trạng thái quét': stats.total > 0 ? '✓ Đang hoạt động' : '⏳ Chưa phát sinh tin'
      };
    });

    console.table(tableData);

    const inactiveCount = tableData.filter(t => t['Tổng tin nhắn'] === 0).length;
    console.log(`\nThống kê:`);
    console.log(`- Nhóm đang hoạt động (đã nhận diện tin nhắn): ${configuredGroups.length - inactiveCount}`);
    console.log(`- Nhóm chưa phát sinh tin nhắn trong hàng chờ: ${inactiveCount}`);
    console.log(`\nLưu ý: Nhóm hiển thị "Chưa phát sinh tin" có thể do chưa có tin nhắn nào trong nhóm khớp với bộ lọc AI (hoặc chưa có tin nhắn mới nào được gửi đến từ lúc bắt đầu quét).`);

    db.close();
  });
});
