const mongoose = require('mongoose');

const PostLogSchema = new mongoose.Schema({
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'PostCampaign', index: true },
    campaignName: { type: String },
    accountId: { type: String },
    accountName: { type: String },
    targetId: { type: String },
    targetName: { type: String },
    targetLink: { type: String },
    action: { type: String, default: 'post' }, // post, share, forward, addMember, removeMember
    status: { type: String, enum: ['success', 'fail'], required: true },
    contentPreview: { type: String }, // 200 ký tự đầu của nội dung đã gửi (sau spin)
    sentMessageIds: [{ type: Number }], // Lưu ID của tin nhắn để phục vụ Auto-Delete
    postLinks: [{ type: String }], // Lưu link tới bài đăng cụ thể
    errorMessage: { type: String },
    createdAt: { type: Date, default: Date.now, index: true },
});

// Index compound để query nhanh theo campaign + thời gian
PostLogSchema.index({ campaignId: 1, createdAt: -1 });

module.exports = mongoose.model('PostLog', PostLogSchema);
