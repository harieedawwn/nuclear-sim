# REVIEW – PWR simulator (không sửa app; test thật bằng Chromium/Playwright 360×640, 390×844, 740×360, 1280×800)
Kết quả: test_sim.js 12/12 PASS; fuzz ~330 thao tác (tạm dừng/SCRAM/Khôi phục/Đặt lại/±5/slider) không có NaN, không kẹt nút; 584 node SVG; không filter/gradient; không có cú pháp > ES2017; localStorage bị chặn vẫn chạy.
Mặc định 315 °C / 69,2 bar / 3000 vòng/phút / 1000 MW đạt. Trễ rõ: lõi nửa đường sau 7,8 s, tuabin sau 25,8 s. w=100: đỏ 11 s → SCRAM 16 s. Lỗi zaloJSV2 bị bỏ qua; lỗi file mình (kể cả `?v=2`) hiện toast.

## Cao
1. Điện thoại nằm ngang (740×360) – style.css `@media (orientation:landscape) and (max-height:560px)` `.side`: cột số liệu chỉ cao 85 px (nội dung 439 px) nên 5 ô số liệu và biểu đồ gần như không thấy. Mong đợi: thấy số liệu khi chỉnh thanh. Sửa: cho cả cột phải cuộn (`.app{overflow-y:auto}` `.side{overflow:visible}`) hoặc thu gọn `.status`/`.controls`.
2. Điện thoại đứng 360×640 – `.controls{position:sticky}` (cao 159 px) che ô số liệu; số liệu và biểu đồ nằm dưới màn hình đầu, vừa kéo thanh vừa xem chuỗi nhiệt→áp suất→vòng quay→MW là không thể. Sửa: thêm hàng 3 số nhỏ (nhiệt độ lõi, vòng/phút, MW) vào trong `.controls`, hoặc thu `#scene` còn ~40 % chiều cao.

## Trung bình
3. style.css `@font-face` trỏ `fonts/BeVietnamPro-*.woff2` nhưng thư mục không có: 3 lỗi 404 trong console (vi phạm "không lỗi console"), iPhone rơi về font hệ thống. Sửa: thêm thư mục fonts (subset tiếng Việt) hoặc bỏ `url()`.
4. scene.js `pointermove` (kéo thanh): TR=56 đơn vị SVG = 100 % → ở 360 px chỉ ~25 px; kéo 10 px lên đã +40 %. Khó đặt chính xác. Sửa: tăng `TR` lên ~110 hoặc nhân hệ số 0,4 vào độ dời (đồng thời dời núm theo).
5. Chưa chặn double-tap zoom ngoài nút: `touch-action:manipulation` chỉ đặt trên `button`. Chạm đôi vào sơ đồ/chữ trên iOS vẫn zoom. Sửa: `html{touch-action:manipulation}`.
6. sim-core.js `governed()`/`step` (rpm): w=75 → 3345 vòng/phút, 1128 MW; w=100 → 3604 vòng/phút, 1224 MW (vượt định mức 20 %, biểu đồ cắt ở 1200 MW, INFO nói "khoảng 3000"). Mong đợi: tuabin nối lưới giữ ≈3000 vòng/phút, MW ≲ 1050. Sửa: giảm `govSlope` (0,25 → ~0,05) hoặc kẹp `rpm ≤ rpmRated*1.03`; chạy lại test_sim.js (kiểm tra đơn điệu).

## Thấp
7. app.js `isOwnUrl`: coi URL của chính trang là "của mình"; script Zalo chèn vào trang mà báo lỗi theo URL trang và không khớp `IGNORE_RE` sẽ hiện toast. Chromium không tái hiện được, chưa thử trên Zalo iOS thật. Sửa: bỏ nhánh `u.pathname === location.pathname`.
8. app.js `STATUS.safe`: ở w=0 (lõi 40 °C, 0 MW) vẫn ghi "nhà máy chạy ổn định". Sửa: thêm câu riêng khi pElec < 5 ("Nhà máy đang không phát điện").
9. `.hint` ở màn hình đứng che ngọn cột hơi tháp làm mát đến khi chạm lần đầu; chấp nhận được, đã tự ẩn.

## Đã kiểm, không có lỗi
Chạm ≥44 px (nút 44–48, vùng chạm bộ phận 47×50 trở lên); Đặt lại luôn dùng được kể cả đang tạm dừng + SCRAM; SCRAM khi tạm dừng cập nhật nút Khôi phục đúng; thanh trượt bị khoá khi SCRAM; kéo thanh không chặn cuộn trang; safe-area, 100dvh có dự phòng 100vh; tip Zalo/FB; chuỗi `?zarsrc=…#a` không ảnh hưởng.
Hình minh hoạ: tả thực, dễ thương, không trẻ con; không phần nào trơ. Thử trên Chromium, chưa thử WKWebView thật.
