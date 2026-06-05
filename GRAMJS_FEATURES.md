# 📋 Hướng dẫn đầy đủ về Telegram API & Code mẫu với GramJS

Tài liệu này cung cấp các code mẫu chi tiết, tham số và cách sử dụng thực tế cho mọi tính năng của Telegram API thông qua thư viện **GramJS** (phiên bản Node.js/TypeScript).

---

## ⚙️ Cấu hình Ban đầu & Khởi tạo Client

Để sử dụng GramJS, trước tiên bạn cần khởi tạo thực thể `TelegramClient` với một cấu trúc Session (thông dụng nhất là `StringSession`).

```javascript
const { TelegramClient, Api } = require('gramjs'); // Hoặc 'telegram' tùy theo cách cài đặt
const { StringSession } = require('gramjs/sessions');

const apiId = 123456; // Thay thế bằng api_id của bạn (kiểu number)
const apiHash = "your_api_hash_here";
const stringSession = new StringSession(""); // Chuỗi trống để tạo session mới, hoặc truyền chuỗi session đã lưu

const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
});

(async () => {
    await client.connect();
    console.log("Đã kết nối với Telegram!");
})();
```

---

## 1. Xác thực & Quản lý Phiên làm việc (Authentication & Session)

### 1.1. Yêu cầu mã OTP (Send Verification Code)
```javascript
const phone = "+84912345678";
const result = await client.sendCode(
    {
        apiId: apiId,
        apiHash: apiHash
    },
    phone
);
const phoneCodeHash = result.phoneCodeHash; // Lưu lại hash này để dùng khi submit code
```

### 1.2. Đăng nhập bằng mã OTP (Sign In)
```javascript
const code = "12345"; // Mã OTP người dùng nhập vào
try {
    const user = await client.signIn({
        phoneNumber: phone,
        phoneCodeHash: phoneCodeHash,
        phoneCode: code,
    });
    console.log("Đăng nhập thành công! User ID:", user.id.toString());
} catch (err) {
    if (err.message.includes("SESSION_PASSWORD_NEEDED")) {
        console.log("Tài khoản yêu cầu mật khẩu 2 lớp (2FA)!");
    } else {
        console.error("Lỗi đăng nhập:", err);
    }
}
```

### 1.3. Xác thực mật khẩu 2 lớp (2FA Password)
```javascript
const { computeCheck } = require('gramjs/Password');

const password = "your_2fa_password";
try {
    // 1. Lấy thông tin cấu hình mã hóa mật khẩu từ Telegram
    const passwordParams = await client.invoke(new Api.account.GetPassword());
    
    // 2. Tính toán mã hash kiểm tra mật khẩu
    const checkPwd = await computeCheck(passwordParams, password);
    
    // 3. Gửi mã hash lên để xác thực
    await client.invoke(new Api.auth.CheckPassword({ password: checkPwd }));
    
    console.log("Xác thực 2FA thành công!");
} catch (err) {
    console.error("Sai mật khẩu 2FA:", err.message);
}
```

### 1.4. Lưu trữ Session (Save Session)
Sau khi đăng nhập thành công, lưu chuỗi session này vào cơ sở dữ liệu hoặc file để tái sử dụng mà không cần OTP.
```javascript
const savedSessionString = client.session.save(); 
// Lưu chuỗi 'savedSessionString' này vào file hoặc SQLite
```

### 1.5. Đăng xuất & Hủy kết nối (Sign Out / Disconnect)
```javascript
// Đăng xuất vĩnh viễn (Xóa phiên làm việc này khỏi hệ thống Telegram)
await client.logOut();

// Hoặc chỉ ngắt kết nối tạm thời của client hiện tại
await client.disconnect();
```

---

## 2. Quản lý Tài khoản & Hồ sơ (User & Profile Management)

### 2.1. Lấy thông tin cá nhân (Get Profile Info)
```javascript
// Lấy thông tin của chính mình
const me = await client.getMe();
console.log(`Tôi là: ${me.firstName} (@${me.username})`);

// Giải quyết thực thể (Username / ID / Số điện thoại) để lấy thông tin tài khoản khác
const entity = await client.getEntity("username_or_phone_number");
console.log("Thông tin đối tượng:", entity);
```

### 2.2. Cập nhật hồ sơ cá nhân (Update Profile)
```javascript
await client.invoke(new Api.account.UpdateProfile({
    firstName: "Nguyen",
    lastName: "Van A",
    about: "Developer | Auto Post Tool Creator" // Mô tả tiểu sử (Bio)
}));
```

### 2.3. Cập nhật Username
```javascript
await client.invoke(new Api.account.UpdateUsername({
    username: "new_custom_username"
}));
```

### 2.4. Cập nhật & Xóa ảnh đại diện (Profile Photo)
```javascript
const { CustomFile } = require('gramjs/client/uploads');
const fs = require('fs');

// Cập nhật ảnh đại diện mới
const imageBuffer = fs.readFileSync("path/to/avatar.jpg");
const file = await client.uploadFile({
    file: new CustomFile("avatar.jpg", imageBuffer.length, "avatar.jpg", imageBuffer),
    workers: 1
});
await client.invoke(new Api.photos.UploadProfilePhoto({ file: file }));

// Xóa ảnh đại diện cũ
// 1. Lấy danh sách ảnh
const photos = await client.invoke(new Api.photos.GetUserPhotos({
    userId: "me",
    offset: 0,
    limit: 1,
    maxId: 0
}));
if (photos.photos.length > 0) {
    const photoId = photos.photos[0].id;
    const accessHash = photos.photos[0].accessHash;
    // 2. Thực hiện xóa ảnh
    await client.invoke(new Api.photos.DeletePhotos({
        id: [new Api.InputPhoto({ id: photoId, accessHash: accessHash })]
    }));
}
```

### 2.5. Cài đặt bảo mật & Riêng tư (Privacy Settings)
```javascript
// Ví dụ: Thiết lập chỉ Danh bạ (Contacts) mới xem được thời gian Online (Status Timestamp)
await client.invoke(new Api.account.SetPrivacy({
    key: new Api.InputPrivacyKeyStatusTimestamp(),
    rules: [
        new Api.InputPrivacyRuleAllowContacts() // Chỉ cho phép danh bạ
        // Hoặc new Api.InputPrivacyRuleAllowAll() - Cho phép tất cả
        // Hoặc new Api.InputPrivacyRuleDisallowAll() - Chặn tất cả
    ]
}));
```

---

## 3. Quản lý Tin nhắn & Đa phương tiện (Messaging & Media)

### 3.1. Gửi tin nhắn định dạng văn bản (Send Text Message)
```javascript
const chatId = "username_or_id";

// Gửi tin nhắn thường kèm theo định dạng HTML
await client.sendMessage(chatId, {
    message: "Xin chào <b>sếp</b>! Đây là tin nhắn định dạng <i>HTML</i>.",
    parseMode: "html" // Hoặc "markdown"
});
```

### 3.2. Gửi tệp tin và đa phương tiện (Send Files / Photos / Videos)
```javascript
// Gửi ảnh kèm chú thích (caption)
await client.sendFile(chatId, {
    file: "path/to/image.jpg", // Có thể truyền đường dẫn tệp tin, Buffer hoặc URL
    caption: "Mô tả bức ảnh này 🚀",
    parseMode: "markdown"
});

// Gửi tài liệu (Document) không nén ảnh
await client.sendFile(chatId, {
    file: "path/to/document.pdf",
    forceDocument: true, // Ép gửi dưới dạng tệp tin tài liệu
    caption: "Tệp tài liệu đính kèm"
});
```

### 3.3. Gửi địa điểm & Khảo sát (Send Location & Polls)
```javascript
// Gửi vị trí GPS
await client.invoke(new Api.messages.SendMedia({
    peer: chatId,
    media: new Api.InputMediaGeoPoint({
        geoPoint: new Api.InputGeoPoint({
            lat: 21.028511, // Vĩ độ (Latitude)
            long: 105.804817 // Kinh độ (Longitude)
        })
    }),
    message: ""
}));

// Gửi bài khảo sát chọn một phương án (Single Choice Poll)
await client.invoke(new Api.messages.SendMedia({
    peer: chatId,
    media: new Api.InputMediaPoll({
        poll: new Api.Poll({
            id: BigInt(Date.now()),
            question: "Hôm nay sếp ăn gì?",
            answers: [
                new Api.PollAnswer({ text: "Cơm văn phòng", option: Buffer.from("0") }),
                new Api.PollAnswer({ text: "Phở bò", option: Buffer.from("1") }),
                new Api.PollAnswer({ text: "Bún chả", option: Buffer.from("2") })
            ],
            closed: false,
            multipleChoice: false
        })
    }),
    message: ""
}));
```

### 3.4. Chỉnh sửa & Xóa tin nhắn (Edit & Delete Messages)
```javascript
const messageId = 12345; // ID tin nhắn cần thao tác

// Chỉnh sửa tin nhắn
await client.editMessage(chatId, {
    message: messageId,
    text: "Nội dung tin nhắn sau khi đã chỉnh sửa! 📝",
    parseMode: "markdown"
});

// Xóa tin nhắn
await client.deleteMessages(chatId, [messageId], {
    revoke: true // Đặt true để xóa ở cả phía người nhận (thu hồi)
});
```

### 3.5. Ghim & Bỏ ghim tin nhắn (Pin & Unpin)
```javascript
// Ghim tin nhắn
await client.pinMessage(chatId, messageId, {
    notify: true, // Gửi thông báo đến mọi thành viên trong group
    pmOneSide: false // true nếu chỉ muốn ghim ở phía mình (đối với chat 1-1)
});

// Bỏ ghim tin nhắn
await client.unpinMessage(chatId, messageId);
```

### 3.6. Tương tác cảm xúc (Send Reaction)
```javascript
await client.invoke(new Api.messages.SendReaction({
    peer: chatId,
    msgId: messageId,
    reaction: [new Api.ReactionEmoji({ emoticon: "👍" })] // Biểu tượng cảm xúc muốn thả
}));
```

### 3.7. Đọc lịch sử tin nhắn & Tải File đính kèm (Fetch & Download Media)
```javascript
// Đọc tin nhắn cũ
const messages = await client.getMessages(chatId, {
    limit: 50, // Số lượng tin nhắn muốn lấy
});

for (let msg of messages) {
    console.log(`[Message ID: ${msg.id}]: ${msg.text}`);
    
    // Nếu tin nhắn có đính kèm file, tải nó xuống
    if (msg.media) {
        const buffer = await client.downloadMedia(msg, {
            workers: 1 // Số luồng tải đồng thời
        });
        fs.writeFileSync(`downloads/file_${msg.id}.jpg`, buffer);
        console.log("Đã tải xuống file đính kèm!");
    }
}
```

### 3.8. Chuyển tiếp tin nhắn (Forward Messages)
```javascript
const fromChatId = "source_chat_username";
const toChatId = "destination_chat_username";
const messageIdsToForward = [111, 112, 113];

// Chuyển tiếp tin nhắn thông thường (Hiển thị nguồn "Forwarded from...")
await client.forwardMessages(toChatId, {
    messages: messageIdsToForward,
    fromPeer: fromChatId
});
```

---

## 4. Quản lý Nhóm & Kênh (Groups & Channels)

### 4.1. Tìm kiếm & Tham gia Nhóm/Kênh
```javascript
// Tìm kiếm nhóm công khai toàn cầu bằng từ khóa
const searchResult = await client.invoke(new Api.contacts.Search({
    q: "MMO Community",
    limit: 10
}));

// Tham gia nhóm/kênh công khai bằng username
await client.invoke(new Api.channels.JoinChannel({
    channel: "username_nhom_cong_khai"
}));

// Tham gia nhóm/kênh riêng tư bằng Invite Link (Dạng t.me/+hash hoặc t.me/joinchat/hash)
const inviteHash = "AaaaaBBBBccc111"; // Phần hash sau dấu + hoặc joinchat/
await client.invoke(new Api.messages.ImportChatInvite({
    hash: inviteHash
}));
```

### 4.2. Quản lý Thành viên (Invite, Kick, Ban, Mute)
```javascript
const channelEntity = await client.getEntity("my_group_username");
const userEntity = await client.getEntity("target_user_username");

// Mời thành viên mới vào nhóm/kênh
await client.invoke(new Api.channels.InviteToChannel({
    channel: channelEntity,
    users: [userEntity]
}));

// Đá (Kick) hoặc Cấm (Ban) hoặc Tắt tiếng (Mute)
// Để Kick: Đặt quyền ban trong khoảng thời gian rất ngắn hoặc cấm quyền xem tin nhắn
await client.invoke(new Api.channels.EditBanned({
    channel: channelEntity,
    participant: userEntity,
    bannedRights: new Api.ChatBannedRights({
        untilDate: 0, // 0 nghĩa là cấm vĩnh viễn (cho đến khi mở khóa)
        viewMessages: true, // Đặt true để Cấm Xem -> Tương đương với việc Kick/Ban khỏi nhóm
        sendMessages: true,
        sendMedia: true,
        sendStickers: true,
        sendGifs: true,
        embedLinks: true
    })
}));

// Để Mở cấm (Unban / Unmute): Đặt toàn bộ quyền hạn bị cấm về false
await client.invoke(new Api.channels.EditBanned({
    channel: channelEntity,
    participant: userEntity,
    bannedRights: new Api.ChatBannedRights({
        untilDate: 0,
        viewMessages: false,
        sendMessages: false,
        sendMedia: false
    })
}));
```

### 4.3. Rời nhóm hoặc Kênh
```javascript
const chat = await client.getEntity("chat_id_or_username");

if (chat.className === 'Channel') {
    // Rời Kênh hoặc Supergroup
    await client.invoke(new Api.channels.LeaveChannel({ channel: chat }));
} else {
    // Rời nhóm Chat thường (Basic Group)
    await client.invoke(new Api.messages.DeleteChatUser({
        chatId: chat.id,
        userId: "me"
    }));
}
```

### 4.4. Tạo Nhóm/Kênh mới & Phân quyền quản trị
```javascript
// Tạo Kênh công khai (hoặc Supergroup nếu đặt megagroup: true)
const newChannel = await client.invoke(new Api.channels.CreateChannel({
    title: "Kênh Tin Tức Tự Động",
    about: "Kênh được tạo tự động qua API bởi GramJS",
    megagroup: false // true: Tạo Supergroup, false: Tạo Channel phát sóng
}));

// Bổ nhiệm làm Admin (Phân quyền Admin Rights)
await client.invoke(new Api.channels.EditAdmin({
    channel: newChannel.chats[0],
    userId: userEntity,
    adminRights: new Api.ChatAdminRights({
        postMessages: true,
        editMessages: true,
        deleteMessages: true,
        banUsers: true,
        inviteUsers: true,
        pinMessages: true,
        addAdmins: false // Không cho phép quyền bổ nhiệm Admin khác
    }),
    rank: "Trưởng Ban Kỹ Thuật" // Biệt danh hiển thị của Admin
}));
```

### 4.5. Quản lý Topic trong Diễn đàn (Forum Topics)
```javascript
// Tạo Topic mới trong Supergroup dạng Forum
const topicResult = await client.invoke(new Api.channels.CreateForumTopic({
    channel: channelEntity,
    title: "Chuyên mục Hỏi Đáp 💬",
    iconEmojiId: undefined // Có thể truyền mã Emoji ID tùy chỉnh
}));
const topicId = topicResult.updates[0].message.id; // ID của Topic chính là ID tin nhắn khởi đầu

// Chỉnh sửa tiêu đề Topic hoặc Đóng/Mở Topic
await client.invoke(new Api.channels.EditForumTopic({
    channel: channelEntity,
    id: topicId,
    title: "Hỏi Đáp Kỹ Thuật (Đã cập nhật)",
    closed: false // true để khóa chủ đề
}));
```

---

## 5. Nhận Sự kiện Thời gian thực (Updates & Events)

### 5.1. Lắng nghe tin nhắn mới gửi đến (NewMessage Event)
```javascript
const { NewMessage } = require('gramjs/events');

client.addEventHandler(async (event) => {
    const message = event.message;
    
    // Bỏ qua nếu là tin nhắn do chính mình gửi đi
    if (message.out) return;

    const text = message.message;
    console.log(`Nhận được tin nhắn từ ${message.senderId}: ${text}`);

    if (text === "ping") {
        await client.sendMessage(message.chatId, { message: "pong" });
    }
}, new NewMessage({ incoming: true })); // Bộ lọc: Chỉ tin nhắn đến
```

---

## 6. Liên hệ & Tương tác Bot (Contacts & Bots)

### 6.1. Quản lý danh bạ
```javascript
// Thêm liên hệ mới bằng số điện thoại
await client.invoke(new Api.contacts.ImportContacts({
    contacts: [
        new Api.InputPhoneContact({
            clientId: BigInt(1),
            phone: "+84999888777",
            firstName: "Khách Hàng A",
            lastName: ""
        })
    ]
}));

// Xóa liên hệ khỏi danh bạ
await client.invoke(new Api.contacts.DeleteContacts({
    id: [userEntity.id]
}));
```

### 6.2. Tương tác với Bot & Click nút bấm (Inline Keyboards)
```javascript
const botUsername = "my_telegram_bot";

// 1. Gửi lệnh /start kèm mã kích hoạt (Pairing/Ref Link)
await client.sendMessage(botUsername, {
    message: "/start pair_token_123"
});

// 2. Giả lập click vào nút bấm Inline của Bot
// Giả định bạn vừa đọc tin nhắn từ Bot chứa nút bấm
const botMessages = await client.getMessages(botUsername, { limit: 1 });
const lastMsg = botMessages[0];

if (lastMsg && lastMsg.replyMarkup && lastMsg.replyMarkup.rows) {
    // Lấy nút đầu tiên của dòng đầu tiên
    const button = lastMsg.replyMarkup.rows[0].buttons[0];
    
    if (button.className === 'KeyboardButtonCallback') {
        // Thực hiện lệnh Click
        await client.invoke(new Api.messages.GetBotCallbackAnswer({
            peer: botUsername,
            msgId: lastMsg.id,
            data: button.data // Mã dữ liệu phản hồi của nút
        }));
        console.log("Đã click nút bấm!");
    }
}
```
