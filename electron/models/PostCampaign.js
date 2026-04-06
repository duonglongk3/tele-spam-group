const mongoose = require('mongoose');

const TargetGroupSchema = new mongoose.Schema({
    chatId: String,       // ID group/channel
    name: String,         // Tên hiển thị
    isChannel: { type: Boolean, default: false },
    isForum: { type: Boolean, default: false },
    topicId: Number,      // Nếu forum group, ID topic cụ thể (null = General)
    topicName: String,
    accountId: String,    // Account nào join group này
    
    // Per-target schedule
    scheduleType: { type: String, enum: ['global', 'random', 'fixed'], default: 'global' },
    customSchedule: { type: String, default: '' }, // Ví dụ: '60-120' hoặc '10:00, 15:30'
    nextRunAt: { type: Date }, // Thời gian chạy tiếp theo được lưu trong DB để không mất khi restart
    isDisabled: { type: Boolean, default: false },
    lastError: { type: String, default: '' }
});

const ForwardSourceSchema = new mongoose.Schema({
    accountId: String,
    fromChatId: String,
    fromChatUsername: String,
    messageIds: [Number]
}, { _id: false });

const PostCampaignSchema = new mongoose.Schema({
    name: { type: String, required: true },
    type: { type: String, default: 'text' }, // text, photo, album, forward
    forwardSource: ForwardSourceSchema,
    accounts: [{ type: String }],
    targets: [TargetGroupSchema],
    contentTemplate: { type: String },
    quoteText: { type: String, default: '' },
    imagePaths: [{ type: String }],
    schedule: { type: String, default: '60-240' },
    firstRunMode: { type: String, enum: ['immediate', 'random'], default: 'immediate' },
    autoDeleteHours: { type: Number, default: 0 }, // 0 = Không tự xoá
    isRunning: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('PostCampaign', PostCampaignSchema);
