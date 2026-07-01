const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(process.cwd(), 'data', 'telegram-auto-post.sqlite3');

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('Error connecting to DB:', err.message);
    process.exit(1);
  }
});

db.all(`SELECT data FROM ai_lead_queue WHERE chatId = '7206482845'`, [], (err, rows) => {
  if (err) {
    console.error('Error querying DB:', err.message);
    process.exit(1);
  }
  console.log(`Found ${rows.length} queue items for chatId 7206482845:`);
  rows.forEach((row, i) => {
    try {
      const data = JSON.parse(row.data);
      console.log(`Item #${i + 1}:`);
      console.log('  ID:', data._id);
      console.log('  Status:', data.status);
      console.log('  MessageId:', data.messageId);
      console.log('  OriginalText:', data.originalText);
      console.log('  SuggestedReply:', data.suggestedReply);
      console.log('  CreatedAt:', data.createdAt);
    } catch (e) {
      console.error('Parse error:', e.message);
    }
  });
  db.close();
});
