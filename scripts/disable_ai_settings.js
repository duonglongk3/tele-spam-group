const { connectDB, run, get } = require('../electron/db');

async function main() {
  await connectDB();
  const row = await get(`SELECT data FROM settings WHERE type = 'global_app_settings'`);
  if (row) {
    const data = JSON.parse(row.data);
    data.aiLeadEnabled = false;
    data.aiLeadUserReplyEnabled = false;
    await run(`UPDATE settings SET data = ? WHERE type = 'global_app_settings'`, [JSON.stringify(data)]);
    console.log('Successfully set aiLeadEnabled and aiLeadUserReplyEnabled to false in DB settings.');
  } else {
    console.log('No settings document found in DB, nothing to update.');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
