<div align="center">

<img src="static/icons/icon-128.png" width="96" height="96" alt="Odoo Debug">

# Odoo Debug

**Đừng đoán nữa. Thấy ngay vì sao Odoo chạy như vậy.**

Extension Chrome miễn phí để debug Odoo 18, 19 và 20, với bảng debug ngay trên trang Odoo.

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/mfmamdbagelffoedimmjpolhalmngcjk?label=Chrome%20Web%20Store&logo=googlechrome&logoColor=white&color=714b67)](https://chromewebstore.google.com/detail/odoo-debug/mfmamdbagelffoedimmjpolhalmngcjk) [![License](https://img.shields.io/badge/license-Sustainable%20Use-714b67)](LICENSE)

**[Thêm vào Chrome](https://chromewebstore.google.com/detail/odoo-debug/mfmamdbagelffoedimmjpolhalmngcjk)** · [Website](https://odoo-debug.unclecatvn.com/) · [Tính năng](#tính-năng) · [English](README.md)

</div>

**Xem video giới thiệu** (2 phút rưỡi): từng tab trả lời một câu hỏi thật trên một đơn bán hàng.

https://github.com/user-attachments/assets/d6254395-fac7-4999-ac39-f0c72e547428

## Vì sao

Developer mode của Odoo cho thấy *cái gì* đang có trên màn hình. Odoo Debug cho thấy *vì sao*: module nào thêm field, view kế thừa nào làm field chỉ đọc, lời gọi RPC nào lỗi và traceback ra sao, record rule nào chặn user, request nào bắn ra 50 câu SQL.

Câu trả lời hiện ngay trên trang, cho chính bạn hoặc cho bất kỳ user nào bạn chọn. Dành cho lập trình viên Odoo, tư vấn chức năng xử lý các yêu cầu "tôi không làm được X", và quản trị viên rà soát database.

## Tính năng

| Tab | Trả lời câu hỏi |
|---|---|
| **Record** | Field này là gì? Kiểu, giá trị, module của nó, và cái gì tính lại nó. |
| **View** | Vì sao field này chỉ đọc? Điều kiện, giá trị của nó lúc này, và view kế thừa đã đặt ra nó. |
| **RPC** | Lời gọi đó gửi gì? Mọi lời gọi JSON-RPC kèm thời gian và lỗi; sửa rồi gửi lại, hoặc copy dạng cURL. |
| **Security** | Vì sao user này không mở được bản ghi? ACL hoặc record rule đang từ chối, và nhóm sẽ cho phép, thử trước khi cấp thật. |
| **Translations** | Chữ này lấy từ đâu? Nguồn của nó và chỗ để sửa; độ phủ `.po`, xuất và nhập. |
| **Apps** | Cài cái này sẽ kéo theo gì? Mọi module được cài và tự cài theo, đúng như Odoo tính; cài, nâng cấp, xem trước khi gỡ. |
| **Menus** | Màn hình kỹ thuật kia ở đâu? Models, views, rules, crons, actions… một cú bấm, không cần debug mode. |
| **Perf** | Vì sao màn hình chậm? Đọc kết quả profiler của Odoo: truy vấn N+1 và dòng code chạy nó, thời gian tốn vào đâu, so sánh trước / sau khi sửa. |
| **Code** | Đổi thế này thì ra sao? Console ORM bằng JavaScript hoặc Python, chạy thử không lưu gì. |

Ảnh chụp từng tab: [odoo-debug.unclecatvn.com](https://odoo-debug.unclecatvn.com/#features).

### Cải tiến luồng debug (bản phát triển)

- **RPC**: thấy request đang chờ cùng thời gian đã chờ; lọc Đang chờ, Chậm (≥ 1 giây), hoặc Lỗi. Phản hồi cập nhật ngay trên dòng cũ, giữ phần request đang chỉnh sửa.
- **Code → Lịch sử**: xem 20 lần chạy gần nhất, khôi phục code mà không chạy lại hoặc bật quyền ghi, lưu thành snippet. Lịch sử tách theo database/người dùng và chỉ ở bộ nhớ phiên panel; tải lại hoặc hủy phiên panel sẽ mất lịch sử (thu nhỏ panel vẫn giữ). Kết quả quá lớn được bỏ qua kèm thông báo.
- **Record → So sánh bản ghi đã lưu**: chọn 2–5 bản ghi trong danh sách/kanban, hoặc ghim A rồi mở B. Lọc **Chỉ hiện khác biệt**; giá trị chưa đọc được vẫn hiện rõ. Chỉ so sánh dữ liệu đã lưu, dữ liệu nhị phân so theo kích thước; Tải lại dữ liệu sẽ bỏ ghim.
- **Perf → Nhóm theo phương thức**: số lần gọi, tổng thời gian, trung vị và tổng SQL; mở từng request để xem chi tiết. Chỉ tính trong 200 profile mới nhất đã tải sau khi loại request của panel và file tĩnh đang ẩn. Tổng thời gian request không phải thời gian tải trang.

## Cài đặt

1. Cài **[Odoo Debug từ Chrome Web Store](https://chromewebstore.google.com/detail/odoo-debug/mfmamdbagelffoedimmjpolhalmngcjk)**. Chạy trên Chrome, Edge, Brave và các trình duyệt nhân Chromium khác (Edge: cho phép extension từ store khác trước), và tự cập nhật.
2. Mở một trang của database Odoo 18, 19 hoặc 20, đã đăng nhập.
3. Bấm nút **Odoo Debug** ở góc dưới bên phải, hoặc nhấn **Alt+Shift+O**. Từ thanh tiêu đề, panel có thể phóng toàn màn hình hoặc tách ra cửa sổ riêng.

### Phím tắt

| Phím tắt | Tác dụng |
|---|---|
| **Alt+Shift+O** | Ẩn / hiện panel |
| **Alt+Shift+D** | Bật / tắt debug mode của Odoo |
| **⌥/Alt + click** | Trên một field, nhãn của nó, ô hoặc tiêu đề cột trong list, hay một dòng thay đổi trong chatter: copy tên kỹ thuật |

Đổi phím, hoặc thêm phím mở panel trong cửa sổ riêng, ở `chrome://extensions/shortcuts`.

<details>
<summary>Bản chưa lên store</summary>

Tải `odoo-debug-v<phiên bản>.zip` ở trang [Releases](https://github.com/unclecatvn/extension-debug-odoo/releases), giải nén, rồi vào `chrome://extensions` → bật **Developer mode** → **Load unpacked**. Trong lúc đó tắt bản từ store, vì cả hai đều thêm nút vào trang Odoo.

</details>

## Tương thích

- **Odoo:** 18.0, 19.0, 20.0, nhận diện trên từng trang
- **Trình duyệt:** Chrome, Edge, Brave và các trình duyệt nhân Chromium khác (Manifest V3)
- **Ngôn ngữ:** English, Tiếng Việt
- **Không hỗ trợ:** Odoo 17 trở về trước; Firefox và Safari

## Quyền riêng tư

- Chỉ nói chuyện với server Odoo của tab đang mở, bằng chính phiên của bạn: không backend, không analytics, không theo dõi.
- Mặc định chỉ đọc. Chỉ ghi khi bạn bấm, dưới quyền của bạn: áp dụng một nhóm, cài một module, sửa bản dịch, chạy Python ở chế độ ghi.
- Không bao giờ đọc giá trị cookie phiên, chỉ đọc các cờ của nó.

Từng quyền extension xin và để làm gì: [odoo-debug.unclecatvn.com/#privacy](https://odoo-debug.unclecatvn.com/#privacy).

## Đóng góp

Rất hoan nghênh báo lỗi và pull request.

- **Gặp lỗi?** [Mở issue](https://github.com/unclecatvn/extension-debug-odoo/issues) kèm phiên bản Odoo, trang bạn đang mở và, nếu có, lỗi trong tab RPC.
- **Muốn sửa code?** Build từ mã nguồn, các bước kiểm tra và checklist cho pull request nằm trong [CONTRIBUTING.md](CONTRIBUTING.md); cách tổ chức mã nguồn trong [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **Có gì mới:** [CHANGELOG.md](CHANGELOG.md).

## Giấy phép

[Sustainable Use License](LICENSE) © 2026 UncleCat.

- **Được dùng và sửa miễn phí** cho mục đích cá nhân, phi thương mại, hoặc cho công việc nội bộ của chính công ty bạn: lập trình viên của một đối tác Odoo dùng trên dự án của khách hàng vẫn được.
- **Được chia sẻ, nhưng chỉ miễn phí và cho mục đích phi thương mại**, giữ nguyên thông báo license và bản quyền.
- **Không được bán**: không đưa bản thu phí lên store, không host hay bán lại, không làm sản phẩm hay dịch vụ thu phí dựa trên nó.

Cần license thương mại: [mở issue](https://github.com/unclecatvn/extension-debug-odoo/issues) hoặc liên hệ qua [unclecatvn.com](https://unclecatvn.com/).
