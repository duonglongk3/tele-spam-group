require('dotenv').config();
const mongoose = require('mongoose');
const PostLog = require('./electron/models/PostLog');

async function test() {
    await mongoose.connect('mongodb://127.0.0.1:27017/tele_auto_post');
    const logs = await PostLog.find({status: 'success'}).sort({createdAt: -1}).limit(5);
    console.log(JSON.stringify(logs, null, 2));
    process.exit(0);
}
test();
