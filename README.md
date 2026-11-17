# 💍 Wedding Photo Curator (Ứng Dụng Chọn Ảnh Cưới Local)

Ứng dụng web chạy hoàn toàn **cục bộ (local offline)** trên máy tính của bạn, hỗ trợ duyệt hàng ngàn ảnh cưới dung lượng lớn, tạo cây thư mục con đa cấp, di chuyển ảnh trực quan và tự động ghi nhớ trạng thái **"Đã xem"** vào file JSON nội bộ.

---

## 🌟 Các Tính Năng Nổi Bật

1. **Hoạt động 100% Local & Lưu trữ bền bỉ:**
   - Đọc trực tiếp từ bộ nhớ máy tính (ổ cứng trong hoặc ổ cứng ngoài cắm qua USB).
   - Toàn bộ ảnh đã xem, danh sách yêu thích và ghi chú chỉnh sửa được lưu vào file:  
     `./data/viewed_state.json`.
   - **Tắt máy hoặc tắt ứng dụng mở lại:** Mọi trạng thái đã xem, thư mục đã phân loại vẫn được ghi nhớ trọn vẹn.

2. **Quản lý Thư mục Cha & Con (Nested Subfolders):**
   - Tạo thư mục con ngay bên trong bất kỳ thư mục nào (không giới hạn cấp độ).
   - Đổi tên, xoá thư mục linh hoạt.
   - Thao tác trên web sẽ đồng bộ trực tiếp thành thư mục thật trên máy tính của bạn.

3. **Di chuyển, Chọn Dải Ảnh (`Shift + Click`) & Gán Album Hàng Loạt:**
   - **Chọn một dải ảnh (`Shift + click`):** Chọn ảnh đầu rồi giữ `Shift` + nhấp vào ảnh cuối để chọn toàn bộ dải ảnh liền nhau theo thứ tự hiển thị (giữ nguyên các ảnh đã chọn trước đó).
   - **Kéo & Thả (Drag and Drop):** Kéo ảnh từ danh sách thả trực tiếp vào tên thư mục con ở thanh bên trái.
   - **Thao tác hàng loạt:** Chuyển thư mục, gán hoặc gỡ khỏi Album ảo, đánh giá `Giữ lại` / `Cân nhắc` / `Bỏ qua` cho nhiều ảnh cùng lúc.
   - **Hoàn tác an toàn (`Ctrl+Z` / `Cmd+Z` & Hoàn tác chuyển ảnh):** Hỗ trợ hoàn tác đánh giá, gắn album hàng loạt và hoàn tác lệnh di chuyển file vật lý về đúng thư mục gốc.
   - **Bảo toàn trạng thái:** Khi ảnh được chuyển vào thư mục con, trạng thái "Đã xem", đánh giá, album ảo, điểm duyệt và ghi chú tự động cập nhật sang đường dẫn mới.

4. **Đánh giá 3 Trạng Thái, Album Ảo (Chỉ Tiêu) & Duyệt Tiếp:**
   - Đánh giá nhanh **Giữ lại (`1`)**, **Cân nhắc (`2`)**, **Bỏ qua (`3`)** hoặc **Yêu thích (`F`)**.
   - Gắn ảnh vào nhiều **Album ảo** (`Ảnh cổng`, `Album cưới`, `Ảnh để bàn`, `Slide tiệc cưới` hoặc album tự tạo) kèm theo dõi chỉ tiêu số lượng (Quota).
   - Tự động lưu **Điểm duyệt (Review Checkpoint)** và vị trí cuộn để bấm **"Duyệt tiếp"** ngay tại ảnh đang xem dở.

5. **So Sánh Song Song (Side-by-Side) & Tìm Ảnh Trùng Theo Nội Dung:**
   - **So sánh linh hoạt & chọn ảnh trực tiếp:** Mở chế độ so sánh từ thanh công cụ, khi đang chọn 1, 2 hoặc nhiều ảnh; đổi trực tiếp **Ảnh A** / **Ảnh B** qua menu thả xuống hoặc dải thumbnail chọn ảnh (lọc theo *Tất cả*, *Đang chọn*, *Cùng loạt chụp*, *Giữ lại*, tìm tên ảnh), tích chọn ảnh ngay trong màn so sánh hoặc bấm **"Chỉ giữ A" / "Chỉ giữ B"** để chốt nhanh tấm đẹp nhất.
   - **Tìm ảnh trùng & gần giống:** Quét toàn bộ thư mục con để phát hiện **bản sao trùng hệt từng byte (SHA-256)** và **ảnh tương tự về mặt thị giác** (ảnh đã đổi tên, nén lại hoặc thu phóng nằm ở các thư mục khác nhau).
   - Mở từng nhóm để đối chiếu cạnh nhau (Side-by-side) hoặc bấm **"Chỉ giữ bản này"** để giữ bản tốt nhất và tự động đánh dấu bỏ qua các bản trùng còn lại.

6. **Sao Lưu & Khôi Phục Phiên Chọn Ảnh:**
   - Xuất file sao lưu `.json` chứa toàn bộ đánh giá, yêu thích, album ảo, chỉ tiêu, ghi chú retouch và điểm duyệt của bộ ảnh.
   - Xem trước đối chiếu và khôi phục an toàn khi chuyển bộ ảnh sang ổ cứng ngoài hoặc máy tính khác.

7. **Hiệu năng cao với ảnh nặng:**
   - Tích hợp công nghệ sinh thumbnail tự động (`sharp`), ảnh gốc 30MB-50MB vẫn duyệt mượt mà, không giật lag.

8. **Khoanh Vùng, Đánh Số & Xuất Gói Ảnh Gửi Studio / Thợ Retouch:**
   - Click trực tiếp lên vị trí bất kỳ trên ảnh (mặt, eo, váy, người phía sau...) để tạo các điểm khoanh số 1, 2, 3... và xuất **PDF Gửi Thợ**.
   - Xuất gói ảnh phân loại theo từng hạng mục (`01_Anh_Cong`, `02_Album_Cuoi`, ...) kèm biên bản ghi chú retouch và kiểm tra an toàn chống ghi đè ảnh gốc.

---

## 🚀 Cách Khởi Động Ứng Dụng

Mở Terminal tại thư mục dự án và chạy:

```bash
# Cách 1: Chạy script nhanh
./start.sh

# Hoặc Cách 2:
npm start
```

Sau đó mở trình duyệt và truy cập: **`http://localhost:3001`**

*(Nếu bạn muốn phát triển / sửa giao diện với hot-reload, chạy: `npm run dev`)*

---

## ⌨️ Phím Tắt Khi Xem Toàn Màn Hình (Lightbox)

| Phím | Chức năng |
| :--- | :--- |
| `←` hoặc `A` / `H` | Xem ảnh trước |
| `→` hoặc `D` / `L` | Xem ảnh tiếp theo |
| `V` | Bật / tắt trạng thái **Đã xem** |
| `F` | Đánh dấu **Yêu thích** |
| `R` | **Xoay ảnh 90°** theo chiều kim đồng hồ |
| `C` | **So sánh** ngay với ảnh kế tiếp (Side-by-side) |
| `M` | Mở hộp thoại chuyển thư mục |
| `1` – `9` | Chuyển ngay ảnh vào thư mục số 1, 2, 3... |
| `+` / `-` | Phóng to / Thu nhỏ ảnh |
| `0` | Trả về kích thước gốc |
| `Esc` | Đóng chế độ xem toàn màn hình |

Trong màn xem ảnh lớn còn có **dải ảnh nhỏ** ở đáy (bấm để nhảy tới ảnh, chấm màu là đánh giá) và nút **Tự ẩn thanh công cụ** để chỉ còn ảnh khi không dùng chuột.

## ⌨️ Phím Tắt Trên Lưới Ảnh

| Phím | Chức năng |
| :--- | :--- |
| `←` `→` `↑` `↓` / `Home` / `End` | Di chuyển giữa các ảnh |
| `1` / `2` / `3` | Giữ lại / Cân nhắc / Bỏ qua (tự sang ảnh kế) |
| `0` | Xoá đánh giá |
| `F` / `V` | Yêu thích / Đã xem |
| `Space` | Chọn ảnh · `Shift` + mũi tên để chọn thêm |
| `Enter` | Mở ảnh lớn |
| `Esc` | Bỏ chọn |
| `?` | Hiện bảng phím tắt |

Kéo ảnh thả vào **thư mục** ở thanh bên để chuyển ảnh, thả vào **album** để gắn album.

---

## 📁 Cấu Trúc Dự Án

```text
ProjectCuoi/
├── data/
│   ├── config.json         # Lưu đường dẫn thư mục ảnh hiện tại
│   └── viewed_state.json   # Lưu danh sách ảnh đã xem, favorite, note
├── photos/                 # Thư mục ảnh mặc định (có thể đổi đường dẫn trên giao diện)
├── server/                 # Backend Node.js Express (quản lý file, thumbnail, API)
├── client/                 # Frontend React + Tailwind CSS
├── start.sh                # Script khởi chạy 1-click
└── package.json
```
