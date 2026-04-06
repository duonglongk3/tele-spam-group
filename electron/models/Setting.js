const mongoose = require('mongoose');

const globalSettingSchema = new mongoose.Schema({
  // Since we only need one global setting, we can enforce uniqueness if needed, 
  // but typically we just findOne or query specific fields.
  type: {
    type: String,
    default: 'global_app_settings',
    unique: true
  },
  telegramBotToken: {
    type: String,
    default: ''
  },
  telegramAdminChatId: {
    type: String,
    default: ''
  },
  telegramPairToken: {
    type: String,
    default: ''
  },
  telegramBotUsername: {
    type: String,
    default: ''
  },
  telegramWebhookUrl: {
    type: String,
    default: 'https://d5x1qljf-3000.asse.devtunnels.ms/'
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

globalSettingSchema.pre('save', function() {
  this.updatedAt = Date.now();
});

const GlobalSetting = mongoose.models.GlobalSetting || mongoose.model('GlobalSetting', globalSettingSchema);

module.exports = GlobalSetting;
