const mongoose = require('mongoose');

async function check() {
  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/telegram_auto_post');
    const db = mongoose.connection.db;
    const campaign = await db.collection('postcampaigns').findOne({ name: 'Share Bài Đăng #65' });
    console.log('--- DB Check ---');
    if (!campaign) {
      console.log('Campaign not found');
    } else {
      console.log('isRunning:', campaign.isRunning);
      console.log('firstRunMode:', campaign.firstRunMode);
    }
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

check();
