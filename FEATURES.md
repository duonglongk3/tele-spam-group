# 🚀 Auto Google Admin - Danh sách Chức năng (Feature List)

Đây là tài liệu tổng hợp toàn bộ các tính năng đã được hiện thực hoá và khắc phục lỗi trong phần mềm **Google Workspace Admin Automation** phiên bản Desktop App.

## 1. Hệ thống Xác thực (Authentication & Session)
- **Đăng nhập linh hoạt:**
  - Hỗ trợ kết nối qua **Service Account JSON Key** truyền thống.
  - Hỗ trợ **OAuth 2.0 Desktop Flow** trực tiếp nhập `Client ID` / `Client Secret` (Dành cho công ty cấm tạo Service Account).
- **Trình Cứu hộ Phiên làm việc (Session Keeper):**  
  Tích hợp "tai nghe" ngầm định lắng nghe sự kiện từ Server Google. Khi Google đổi `Access Token` giữa chừng, Electron tự động bắt Token mới, lưu đè lên Cấu hình nội bộ giúp phiên làm việc của bạn KHÔNG BAO GIỜ bị đăng xuất hay "hết hạn".
- **Export/Import Workspace:**
  Xuất toàn bộ cấu hình (Kèm cả Token đăng nhập Google chưa hết hạn) ra thành một tệp `.json` duy nhất. Có thể gửi tệp này qua máy tính/Laptop cá nhân khác để Import trực tiếp sử dụng (chống lộ bí mật qua UI).
- **Bảo mật Khoá ứng dụng:** Chuyển tất cả các thông tin uỷ quyền từ Redux/Zustand UI xuống Tầng ổ cứng tĩnh được mã hoá `electron-store`. UI không có bất cứ key nào để ngăn chặn mã độc nhúng vào DOM Web.

## 2. Quản lý Người Dùng (User Management)
- **Giao diện Liệt kê siêu tốc:** Load hàng nghìn thành viên trong nháy mắt. Hỗ trợ thay đổi số lượng phân trang động (`25`, `50`, `100`, `200` và **Mức số Tuỳ chỉnh tự gõ**).
- **Bộ máy Bộ lọc Đa năng:** 
  - Ô tìm kiếm theo Email / Tên người thực.
  - Lọc trạng thái (Active / Suspended).
  - Phân loại Role (Admin / User).
  - Lọc theo từng chi nhánh/phòng ban (Org Unit).
- **Hành động Hàng loạt an toàn (Bulk Actions):**
  Tích chọn (Checkbox) nhiều người dùng cùng lúc để thực hiện:
  - `Đình Chỉ (Suspend)` hoặc `Bỏ Đình Chỉ (Unsuspend)`.
  - `Xoá vĩnh viễn hàng loạt`: Có xác thực chống xoá nhầm bằng cách buộc gõ đúng mật ngữ.
- **Tiện ích nhỏ giọt:** Nút `Reset Mật Khẩu` reset một lần, hiển thị Pass tạm bằng Toast Alert cho Admin gửi luôn vào kênh chat nội bộ.

## 3. Khôi Phục Người Dùng Bị Xoá Nhầm (User Restore)
- **Đồng hồ đếm ngược sinh tử:** Quét tất cả User trong **20 ngày chờ thi hành án tử hình vĩnh viễn**. Báo cáo chính xác số dư ngày bị giam giữ của tài khoản.
- **Vượt Ải "Bad Request":** API bị Google giới hạn nghiêm ngặt đã được bẻ khoá. Khôi phục trực tiếp dựa trên lõi `Immutable ID` của Google cấp phát, bao mượt 100%.
- **Auto-Pass sau Khôi phục:** Chỉ định OU (phòng ban đích) để user tái sinh bay thẳng vào đó. Hệ thống sẽ cấp sẵn một cụm mật khẩu hoàn toàn mới để User đi làm lại.

## 4. Quản lý Phòng Ban Hình Cây (Organization Units)
- Auto vẽ và render thuật toán Cây Gia phả (Tree View) để dễ hình dung toàn bộ cấu trúc công ty: Công ty Mẹ -> Các Công ty Con -> Phòng ban con.
- Xem số List Person trong phòng ban đó nếu click vào.
- Trình tạo OU trực quan. Có chọn Node Root nhanh gọn.

## 5. Quản lý Hội Nhóm Công Ty (Google Groups)
- Nhìn thấy Group, Nhìn thấy Số List nhân sự trong Group.
- **Tương tác Thêm / Xoá Nóng:**
  - Nhập Email vào ô input, ấn Enter -> Nhân viên lập tức chui tọt vào Group.
  - Ấn icon Nút Trừ góc phải -> Nhân viên bị đá ra ngoài Group không lưu luyến.
- Tuỳ biến tạo mới Group cho dự án rác.

## 6. Lịch sử Thao tác Admin (Audit Logs)
- Ghi log lại mọi lịch sử hành động mà bạn (người cầm máy) đã thực hiện lên Hệ thống nội bộ Google: *Xoá ai, Reset pass của ai, Xoá group nào, Chuyển quyền tài khoản nào...* 
- Lưu ở dạng cục bộ để đối chiếu KPI, xuất Excel thông qua nút bấm Export (CSV).

## 7. Hotfixes Kỹ thuật Backend đáng giá
- Phá vây thành công lỗi **Hydration Failed** khiến UI chập chờn / Mất khung Session khi F5 vì React Render Server và Zustand Fetch Local chưa đồng pha.
- Tự thiết kế hệ cơ chế Scheme `app://` riêng biệt để bọc dự án Next.js App Router bên trong con Electron vỏ bọc (vốn dĩ không tương trợ giao thức URL thuần của windows).
- Đóng gói (Build) file NSIS Installer `.exe` tối giản nhưng chuyên sâu. Mở lên là chạy!
