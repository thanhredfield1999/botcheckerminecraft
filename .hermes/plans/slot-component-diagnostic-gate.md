# Gate offline: chẩn đoán lỗi SlotComponent/ItemWrittenBookPage

## Bằng chứng hiện có

- Lần kết nối đầu tiên từng lỗi tại `SlotComponent/ItemWrittenBookPage` với array size `1735156083` (`0x676c6173`, ASCII `glas`); lần sau không tái hiện.
- Tiến trình được pin `1.21.11` đã negotiate protocol `774`, nhưng một lần thành công không chứng minh pin version là cách sửa.
- `minecraft-protocol@1.66.2` dùng `protodef@1.19.0`; guard array `0xffffff` vẫn đang hoạt động và phải giữ nguyên.
- `minecraft-protocol` gắn full decompressed packet vào `error.buffer` khi `FullPacketParser` ném lỗi, và bổ sung `error.field` trước khi chuyển lỗi lên Mineflayer.
- Sự kiện `raw`/`packet` chỉ phát sau parse thành công, nên listener các sự kiện đó không thể bắt chính frame làm parser thất bại.

## Giả thuyết chưa được chứng minh

- Parser đã lệch byte boundary trước khi đọc số trang written-book.
- Frame lỗi có thể xác định packet/component nếu lưu fingerprint và các đoạn byte bounded rồi replay offline.
- Chưa đủ bằng chứng để quy lỗi cho Paper, plugin, Mineflayer, minecraft-data hoặc Protodef.

## Gate thực hiện

1. RED: thêm test fixture tổng hợp cho bộ tóm tắt decode error; yêu cầu output chỉ chứa field, kích thước và SHA-256, không chứa raw buffer hay thuộc tính tùy ý/secret.
2. GREEN: thêm pure seam tóm tắt `error.buffer`; giới hạn cố định nhỏ, không thay parser và không nới array guard.
3. Tích hợp seam vào `client_error` sau cờ opt-in mặc định tắt; listener vẫn thuộc `BotSession` và cleanup như cũ.
4. Chạy focused tests, rồi typecheck → full test → build → `git diff --check`.
5. Tự review race, cleanup, listener ownership và dữ liệu nhạy cảm; chỉ cập nhật `CURRENT_STATE.md` bằng output thật.

## Invariant an toàn và giới hạn dữ liệu

- Không kết nối Minecraft/server trong gate này.
- Không thay dependency, decoder, array-size guard, scenario hay hành vi network.
- Diagnostic mặc định tắt.
- Không ghi full frame, packet payload đã decode, username/password/token/chat/NBT.
- Chỉ ghi metadata lỗi đã bounded và fingerprint của tối đa một frame lỗi; không ghi bất kỳ byte frame nào.
- Không thêm listener trực tiếp ngoài ownership/cleanup hiện có của `BotSession`.

## Rollback

- Xóa module diagnostic, test fixture, cờ cấu hình và nhánh tích hợp trong `runner.ts`; không có migration hay dữ liệu bền vững cần đảo ngược.

## Gate runtime cần phê duyệt riêng

- Một lần chạy read-only, fresh direct process, opt-in diagnostic, target/server/account được anh Thành phê duyệt; kiểm tra PID/port ownership trước và cleanup sau.
- Chỉ sau khi có frame fingerprint/segments thật mới lập fixture replay và phân loại packet/component. Gate offline này không phải runtime verification.
