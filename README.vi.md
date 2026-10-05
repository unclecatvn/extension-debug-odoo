# Odoo Debug

**Đừng đoán nữa. Hãy xem vì sao Odoo làm như vậy.** Panel debug ngay trong trang cho Odoo 18.0, 19.0 và 20.0: một extension
Chrome (Manifest V3) mở bên cạnh màn hình bạn đang xem và giải thích nó: bản ghi, view, các lời gọi lên server, ai được
làm gì, và bản dịch.

[English](README.md) · [Hướng dẫn sử dụng](https://unclecatvn.github.io/extension-debug-odoo/) · [Kiến trúc](docs/ARCHITECTURE.md)

## Vấn đề

Chế độ debug của Odoo cho thấy *có* chuyện gì xảy ra, hiếm khi cho thấy *vì sao*:

- **Một user không mở hoặc không sửa được bản ghi.** Thông báo AccessError chỉ nêu model, may lắm thì thêm tên rule.
  Muốn biết thiếu ACL nào, record rule nào đang chặn, domain của rule ra sao với user đó, và thêm nhóm nào thì được (mà
  không cấp thừa quyền), phải tự đọc `ir.model.access`, `ir.rule`, `res.groups`.
- **Một field bị ẩn, chỉ đọc hoặc không thấy trên form.** Các điều kiện của nó đến từ nhiều view kế thừa của nhiều
  module, theo một thứ tự chỉ `ir.ui.view._combine` biết.
- **Màn hình chậm hoặc một lời gọi lỗi.** Tab Network của trình duyệt chỉ hiện payload JSON-RPC, không cho thấy model,
  method, lỗi phía server, cũng không cho gọi lại qua external API.
- **Một chữ chưa được dịch.** Đó là giá trị field, chữ trong view, hay chữ trong code nằm trong file `.po` của module
  nào? Mỗi loại sửa ở một chỗ khác nhau.

Odoo Debug trả lời các câu hỏi này ngay trên màn hình, dưới dạng bảng, cho chính bạn hoặc cho bất kỳ user nào bạn chọn.

## Dành cho ai

- **Lập trình viên Odoo** debug module của mình: field, compute, kế thừa view, lời gọi RPC, record rule.
- **Tư vấn chức năng và người vận hành hệ thống** xử lý các yêu cầu "tôi không làm được X": quyền theo user, bản ghi và
  model, nhóm cấp gì, so sánh hai user, bản dịch.
- **Quản trị viên** rà soát database: ai giữ nhóm nhạy cảm, mỗi nhóm mở gì, instance phơi ra những gì trên web.

## Các tab

| Tab | Dùng để |
|---|---|
| **Record** | Mọi field của bản ghi: định nghĩa, giá trị theo kiểu dữ liệu, cái gì tính lại nó, lọc nhanh, sao chép dạng JSON |
| **View** | View được kể như một câu chuyện: view nào của module nào tạo nên nó, theo đúng thứ tự Odoo áp dụng; một field qua các view; arch tổng hợp |
| **RPC** | Các lời gọi JSON-RPC của trang, kèm thời gian và lỗi; mở một lời gọi là sửa và gửi lại ngay tại đó; Copy as cURL cho external API (18: `/jsonrpc`, 19 / 20: `/json/2`) |
| **Security** | Quyền dạng bảng: ACL và rule của một bản ghi × đọc / ghi / tạo / xoá, domain được đánh giá với user; quyền trên mọi model; nhóm, nhóm cấp gì và ai đang có; thử một nhóm trước khi cấp; so sánh hai user |
| **Translations** | Chữ đến từ đâu và sửa ở đâu; bản dịch của bản ghi và view theo từng ngôn ngữ; độ phủ `.po`, xuất và nhập; ngôn ngữ |
| **Apps** | Module như menu Apps của Odoo (cùng bộ lọc, dạng facet): chọn nhiều module rồi Kích hoạt (Cập nhật danh sách ứng dụng + cài kèm phụ thuộc), Nâng cấp hoặc mở form; ⚠ khi manifest trên đĩa mới hơn database. Mở một module: mô tả (`index.html` hoặc README), manifest, phụ thuộc hai chiều (cài nó sẽ kéo theo những gì, gồm cả module tự cài, tính đúng như Odoo) và dạng sơ đồ, dữ liệu và model của nó, gỡ cài đặt có xem trước bằng chính wizard của Odoo; các thao tác đang treo, áp dụng hoặc huỷ (quyền Settings) |
| **Menus** | Các màn hình kỹ thuật mà developer mở suốt ngày, chỉ một cú bấm, không cần bật debug mode hay vào menu Technical: Models, Fields, Record Rules, Views, Menus, Model Data, Crons, Actions Window, Actions Server, Reports, Parameters, Sequences, Mail Templates (danh sách của module `developer_menu` bên OCA, không phải cài gì; dành cho user có quyền Access Rights). Bấm một dòng là mở màn hình đó ngay trên trang Odoo, như bấm menu; ↗ để mở ở tab mới. |
| **Perf** | Profiler có sẵn của Odoo, đọc lại: bật / tắt cho phiên của bạn, rồi xem các request (chậm nhất trước), chẩn đoán từng request (nên xem gì trước: N+1, database hay Python), thời gian theo hàm của các module, SQL diễn giải bằng lời, dòng code gửi SQL, nghi vấn N+1, câu chậm nhất; so với một mốc (trước / sau khi sửa); profile riêng một lời gọi từ tab RPC; flame graph; dọn dẹp (quyền Settings) |
| **Code** | ORM console chạy dưới quyền người đang đăng nhập, trên bản ghi đang mở / đang chọn (`record`, `records`, `model`): **JavaScript** trong trang (`env['sale.order'].search(…)`, chỉ đọc, chạy thử hoặc ghi) hoặc **Python** trên server bằng một server action tạm (chạy thử được rollback thật; cần quyền Settings); kết quả hiển thị theo kiểu dữ liệu (bản ghi, bảng theo kiểu field, ngày giờ theo múi giờ của bạn), copy dạng CSV / Markdown / JSON; snippet; gợi ý model, field, method |

Phiên bản Odoo được nhận diện trên từng trang, và mọi khác biệt giữa 18.0, 19.0 và 20.0 mà panel cần đều nằm ở một chỗ
(`src/odoo/adapters/`).

## Video demo

<!-- website/intro.mp4 (npm run intro), tải lên làm tệp đính kèm của GitHub: GitHub không phát video nằm trong repo.
     Phim mới: kéo file vào một ô bình luận bất kỳ, thay link user-attachments nhận được vào chỗ này. -->
https://github.com/user-attachments/assets/d6254395-fac7-4999-ac39-f0c72e547428

Từng tab trả lời một câu hỏi thật trên một đơn bán hàng: vì sao field bị readonly, vì sao user không mở được đơn, cài một
module sẽ kéo theo những gì, vì sao màn hình chậm… Ảnh chụp từng tab có trên
[trang Odoo Debug](https://unclecatvn.github.io/extension-debug-odoo/).

## Hướng dẫn sử dụng

Hướng dẫn chi tiết từng tab, phím tắt và quyền riêng tư:
**https://unclecatvn.github.io/extension-debug-odoo/**.

Phím tắt: **Alt+Shift+O** ẩn / hiện panel, **Alt+Shift+D** bật / tắt chế độ debug của Odoo, có thể đặt thêm phím mở panel trong cửa sổ riêng (đổi ở
`chrome://extensions/shortcuts`). ⌥/Alt + click vào một field, nhãn của nó, ô hoặc tiêu đề cột trong list, hay một dòng thay đổi trong chatter trên trang Odoo: tên kỹ thuật được copy.

## Cài đặt

Cài **[Odoo Debug từ Chrome Web Store](https://chromewebstore.google.com/detail/odoo-debug/mfmamdbagelffoedimmjpolhalmngcjk)** rồi bấm **Thêm vào Chrome** (Add to Chrome). Chạy được trên Chrome, Edge, Brave và các trình duyệt nhân Chromium khác (Edge sẽ hỏi cho phép cài extension từ store khác trước), và tự cập nhật.

Sau đó mở một trang bất kỳ của database Odoo 18, 19 hoặc 20 (đã đăng nhập) rồi bấm nút **Odoo Debug** ở góc dưới bên phải trang, hoặc nhấn **Alt+Shift+O**. Từ thanh tiêu đề của panel có thể phóng toàn màn hình hoặc tách ra cửa sổ riêng (dùng với màn hình thứ hai).

Bản chưa lên store: tải `odoo-debug-v<phiên bản>.zip` ở trang [Releases](https://github.com/unclecatvn/extension-debug-odoo/releases), giải nén rồi nạp dạng giải nén (`chrome://extensions` → bật **Developer mode** → **Load unpacked**); trong lúc đó tắt bản từ store, vì cả hai đều thêm nút vào trang Odoo.

## Build từ mã nguồn

Cần có: **Node.js 22.18 trở lên**.

```sh
git clone https://github.com/unclecatvn/extension-debug-odoo.git
cd extension-debug-odoo
npm install
npm run build   # → dist/: Load unpacked thư mục này (chrome://extensions → Developer mode)
```

Sau khi kéo code mới: `npm run build`, bấm ⟳ ở `chrome://extensions` rồi tải lại trang Odoo.

### Phát triển

```sh
npm run watch   # tự build lại dist/ mỗi lần lưu (rồi bấm ⟳ ở chrome://extensions)
npm run check   # những gì CI chạy: kiểm tra kiểu, unit test, build, kiểm tra hàm chạy trong trang / markup / import
npm run i18n    # cập nhật .pot / .po sau khi thêm chuỗi cần dịch
```

Cách tổ chức mã nguồn, các quy tắc và cách xử lý từng phiên bản Odoo: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Phát hành: tăng `version` trong `static/manifest.json`, thêm mục tương ứng vào [CHANGELOG.md](CHANGELOG.md), rồi push. CI
kiểm tra, build và đăng `odoo-debug-v<phiên bản>.zip` lên Releases; từ `main` còn tải lên Chrome Web Store và gửi duyệt (secret của repo `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`; Actions › Release › Run workflow gửi lại sau khi bị từ chối).

## Đóng góp

Rất hoan nghênh issue và pull request. Trước khi mở PR:

1. `npm run check` chạy qua và `npm run i18n` không làm thay đổi `static/i18n/` (CI kiểm tra cả hai).
2. Chuỗi mới đã được dịch trong `static/i18n/vi.po`.
3. Đã thử trên ít nhất một instance Odoo; ghi rõ phiên bản trong PR.

Gặp lỗi? [Mở issue](https://github.com/unclecatvn/extension-debug-odoo/issues) kèm phiên bản Odoo, trang bạn đang mở và, nếu có, lỗi trong tab RPC. Mở pull request nghĩa là đồng ý với [Contributor License Agreement](CONTRIBUTING.md#contributor-license-agreement) một câu.

## Giấy phép

[Sustainable Use License](LICENSE) © 2026 UncleCat.

- **Được dùng và sửa miễn phí** cho mục đích cá nhân, phi thương mại, hoặc cho công việc nội bộ của chính công ty bạn: lập trình viên của một đối tác Odoo dùng trên dự án của khách hàng vẫn được.
- **Được chia sẻ, nhưng chỉ miễn phí và cho mục đích phi thương mại**, giữ nguyên thông báo license và bản quyền.
- **Không được bán**: không đưa bản thu phí lên store, không host hay bán lại, không làm sản phẩm hay dịch vụ thu phí dựa trên nó.
- Muốn dùng thương mại theo cách không được phép ở trên? [Mở issue](https://github.com/unclecatvn/extension-debug-odoo/issues) hoặc liên hệ qua [unclecatvn.com](https://unclecatvn.com/) để có license thương mại.
