const mongoose = require('mongoose');

// Kết nối mặc định đến localhost, có thể sửa từ UI qua SETTINGS sau này
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/tele_auto_post';

async function connectDB() {
    try {
        if (mongoose.connection.readyState >= 1) return;
        await mongoose.connect(MONGODB_URI);
        console.log('[MongoDB] Connected successfully');
    } catch (err) {
        console.error('[MongoDB] Connection error:', err.message);
    }
}

module.exports = { connectDB };
