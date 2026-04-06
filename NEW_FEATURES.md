# 📋 Spec: Bulk Operations từ File + Auto Reload List

---

## 🎯 Tổng quan 3 tính năng mới

| #   | Tính năng           | Input              | Output                           |
| --- | ------------------- | ------------------ | -------------------------------- |
| 1   | Tạo hàng loạt user  | File Excel/CSV     | 1000 user được tạo + báo cáo     |
| 2   | Xoá hàng loạt user  | File Excel/CSV/TXT | Danh sách đã xoá + báo cáo       |
| 3   | Khôi phục hàng loạt | File Excel/CSV/TXT | Danh sách đã khôi phục + báo cáo |

---

## ⚡ Vấn đề cốt lõi: Auto Reload List

> **Đây là điểm quan trọng nhất, cần làm đúng ngay từ đầu.**

### ❌ Pattern sai (hiện tại nhiều app làm vậy)

```
User bấm "Xoá 500 người"
→ Gọi API xoá
→ Xong
→ User phải F5 tay để thấy kết quả
```

### ✅ Pattern đúng cần implement

```
User bấm "Xoá 500 người"
→ Gọi API xoá (từng batch)
→ Mỗi batch xong → gọi fetchUserList() ngay lập tức
→ UI tự cập nhật, không cần F5
→ Khi toàn bộ xong → báo cáo tổng kết
```

### Quy tắc bắt buộc cho MỌI action (Tạo / Xoá / Sửa / Khôi phục):

```typescript
// Pseudocode - áp dụng cho TẤT CẢ các action
async function executeAndReload(action: () => Promise<void>) {
  try {
    await action(); // 1. Thực thi hành động
  } finally {
    await fetchUserList(); // 2. LUÔN reload, dù thành công hay lỗi
    updateAuditLog(); // 3. Ghi log
  }
}
```

**Tại sao `finally` chứ không phải `then`?**
Vì nếu xoá 500 người, 490 thành công, 10 lỗi → vẫn phải reload để thấy 490 người đã biến mất.

---

## 📁 Tính năng 1: Tạo hàng loạt User

### Template Excel chuẩn (cột bắt buộc)

```
| firstName | lastName | email              | password    | orgUnit        | role  |
|-----------|----------|--------------------|-------------|----------------|-------|
| Nguyen    | Van A    | vana@company.com   | Pass@1234   | /Sales/HCM     | user  |
| Tran      | Thi B    | thib@company.com   | (để trống)  | /Engineering   | admin |
```

> **Lưu ý:** Nếu cột `password` để trống → hệ thống tự sinh mật khẩu ngẫu nhiên 12 ký tự.

### Luồng xử lý

```
1. User upload file Excel/CSV
2. App parse file → hiển thị preview bảng (50 dòng đầu)
   → Highlight đỏ các dòng thiếu email / firstName
   → Cho phép user xác nhận hoặc huỷ
3. User bấm "Bắt đầu tạo"
4. Xử lý theo batch 10 user / lần (tránh rate limit Google API)
   → Sau mỗi batch: cập nhật Progress Bar
   → Sau mỗi batch: gọi fetchUserList() → UI reload
5. Kết thúc → xuất báo cáo (xem phần Báo cáo bên dưới)
```

### Xử lý lỗi

- Bỏ qua dòng lỗi, tiếp tục tạo các dòng còn lại
- Ghi nhận lý do lỗi từng dòng để xuất báo cáo cuối

---

## 🗑️ Tính năng 2: Xoá hàng loạt User

### Format file input (hỗ trợ cả 3)

```
Excel/CSV:           TXT:
| email            | vana@company.com
| vana@company.com | thib@company.com
| thib@company.com | vanc@company.com
```

### Luồng xử lý

```
1. User upload file
2. App parse → hiển thị danh sách email sẽ bị xoá
   → Hiển thị cảnh báo đỏ: "Bạn sắp xoá X tài khoản"
3. Bắt buộc nhập mật ngữ xác nhận (giữ nguyên cơ chế hiện có)
4. Xử lý theo batch 10 email / lần
   → Sau mỗi batch: gọi fetchUserList() → UI reload
   → Các user đã xoá biến mất khỏi danh sách ngay
5. Kết thúc → báo cáo
```

---

## ♻️ Tính năng 3: Khôi phục hàng loạt User

### Format file input

Giống tính năng Xoá — hỗ trợ Excel/CSV/TXT, chứa danh sách email cần khôi phục.

### Luồng xử lý

```
1. User upload file
2. App đối chiếu email với danh sách "đang chờ xoá vĩnh viễn"
   → Highlight xanh: email tìm thấy, khôi phục được
   → Highlight vàng: email không có trong danh sách chờ xoá
3. User xác nhận
4. Xử lý batch, dùng Immutable ID (giữ nguyên cơ chế hiện có)
   → Sau mỗi batch: gọi fetchUserList() VÀ fetchDeletedUserList() → cả 2 list reload
5. Kết thúc → báo cáo
```

---

## 📊 Báo cáo kết quả (dùng chung cho cả 3 tính năng)

Sau khi chạy xong, hiện modal tổng kết:

```
✅ Thành công: 987 / 1000
❌ Thất bại:    13 / 1000

Chi tiết lỗi:
| Email              | Lý do lỗi                        |
|--------------------|----------------------------------|
| abc@company.com    | Email đã tồn tại                 |
| xyz@company.com    | OrgUnit /Sales/HCM không tồn tại |

[Xuất báo cáo CSV]   [Đóng]
```

---

## 🔄 Tóm tắt điểm bắt buộc cho AI implement

```
1. fetchUserList() phải được gọi trong khối `finally`, không phải `then`
2. Mỗi batch xong → gọi fetch ngay, không đợi hết toàn bộ
3. Khôi phục → fetch CẢ HAI list: userList + deletedUserList
4. Progress Bar cập nhật real-time theo từng batch
5. Báo cáo lỗi chi tiết từng dòng, có nút Export CSV
6. Preview file trước khi chạy, highlight lỗi validate ngay trên bảng
```
