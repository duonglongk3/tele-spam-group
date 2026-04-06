const mongoose = require('mongoose');

const TelegramAccountSchema = new mongoose.Schema({
    accountId: { type: String, required: true, unique: true },
    apiId: String,
    apiHash: String,
    sessionString: String,
    firstName: String,
    lastName: String,
    username: String,
    phone: String,
    about: String,
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('TelegramAccount', TelegramAccountSchema);
