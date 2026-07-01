const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(process.cwd(), 'data', 'telegram-auto-post.sqlite3');
console.log('Connecting to database:', dbPath);

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('Error connecting to DB:', err.message);
    process.exit(1);
  }
});

db.get(`SELECT data FROM settings WHERE type = 'global_app_settings'`, [], (err, row) => {
  if (err) {
    console.error('Error querying DB:', err.message);
    process.exit(1);
  }
  if (!row) {
    console.log('No settings found!');
  } else {
    try {
      const data = JSON.parse(row.data);
      console.log('Settings data:');
      console.log('aiLeadEnabled:', data.aiLeadEnabled);
      console.log('aiLeadEngagementGroups:', JSON.stringify(data.aiLeadEngagementGroups, null, 2));
      console.log('aiLeadAccountIds:', data.aiLeadAccountIds);
    } catch (parseErr) {
      console.error('Error parsing JSON:', parseErr.message);
    }
  }
  db.close();
});
