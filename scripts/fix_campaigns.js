const mongoose = require('mongoose');

async function fix() {
  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/tele_auto_post');
    const PostCampaign = require('../electron/models/PostCampaign');
    await PostCampaign.updateMany({}, { 
        $set: { 
            isRunning: false, 
            firstRunMode: 'random' 
        } 
    });
    console.log('All campaigns paused and set to RANDOM first start mode safely.');
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

fix();
