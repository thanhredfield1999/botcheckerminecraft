# Changelog

## 0.2.0 — 2026-09-07

Candidate nội bộ sau audit Opus 5 và kiểm thử contract offline cho VillageDefense,
LivingNPC, ItemGuard, RestaurantTycoon, BastionForge. KHÔNG phải release đã chốt:
chưa chạy các scenario này trên Paper, chưa có xác nhận từ người dùng 5 dự án.
DF-03 chỉ có drop; drag vẫn thiếu. Báo cáo parent: `docs/dogfood-round2/index.json`.

Các contract offline đã bộc lộ thiếu sót ở assertion. Đây không phải kết luận
được cả năm dự án ký duyệt: batch reviewer độc lập không hoàn tất thành công.

Gate Windows round 2 lịch sử: `854 test / 848 pass / 0 fail / 6 skip`;
không dùng số liệu này để chứng minh source sau các correction đã được kiểm thử.

### Corrections 2026-09-08 (offline)

- Selector entity/item dùng NFC → lowercase độc lập locale → NFC. Có regression
  tên tiếng Việt NFD và J + combining caron.
- Exact/maximum entity count cần ba mẫu trong ít nhất 200 ms; schema đòi timeout
  lớn hơn 300 ms. Evidence giữ số mẫu/count; thiếu dwell khi predicate đang khớp
  là INCONCLUSIVE thay vì tự gán lỗi sản phẩm.
- Processing menu hoặc crafting cache không rõ ownership bị chặn; không kết luận
  item đã mất chỉ vì không nằm trong projection.
- Drop giữ evidence tăng dần và in-flight uncertainty khi bị ngắt. Thư viện thật
  được kiểm mode 4 cho một item, ba item và toàn stack; không chứng minh server ack.
- UUID ở nhánh count dùng exact identity như pin; late-drop guard luôn có lỗi
  INCONCLUSIVE ngay cả khi run đã kết thúc mà signal chưa có abort reason.
- Capture bỏ event quá dài, chặn capture rỗng, giới hạn tổng regex 100 ms/128 lần;
  missing observation/cancellation giữ verdict INCONCLUSIVE.
- Forward probe chỉ compile main sources; thiếu prerequisite ở chế độ required
  trả nonzero; diagnostics không tự quy mọi lỗi compiler thành Paper xoá API.
- Test concurrency giới hạn 2 sau khi full parallel suite tái hiện CPU starvation
  của VM wall-clock budget. Không nới production regex timeout để làm xanh test.
- Tình trạng/gate/artifact cuối được ghi tại `.hermes/WORKING_STATE.md` và
  `docs/verification/botchecker-0.2.0-round3/`; chưa release/deploy/pin consumer.

### Sửa lỗi

**`observe_crossing` báo PASS cho entity cạ tường (DF-08).** Đây là lỗi đang tồn
tại, không phải thiếu tính năng. Corridor check so `corridorHalfWidth` với *tâm*
entity nên NPC rộng 0.6 có tâm ở lateral 0.4982 — mép thân ở 0.798 — vẫn được
tính là qua gate hợp lệ dù đang đâm vào tường aperture 1.2.

Thêm `entityHalfWidth` (mặc định `0` = point-based). Hai đầu sample được kiểm theo
mép thân. Kiểm điểm nội suy ở gate được giữ nhưng là dư về hình học khi cả hai
đầu đã trong corridor lồi; nó KHÔNG chứng minh quỹ đạo cong giữa hai sample.
`maxStepDistance`, sample rate và exit dwell vẫn cần cấu hình đúng fixture.

Observation thêm `lateralClearance` (âm = đã vượt), khiến biên nhìn thấy được khi
đọc lại evidence thay vì chỉ một boolean.

### Assertion mới

**`assert_inventory` — `exactly` / `maximum`, và nhận `minimum: 0` (DF-01).**
Trước đây chỉ có `minimum` với `.positive()`, nghĩa là assertion **không thể fail
khi count tăng**: `minimum: 1` vẫn pass khi tồn tại 2 item. `exactly`/`maximum`
bắt được count vượt ngưỡng. `maximum: 0` chỉ nói không thấy item khớp trong
player-owned client slots, KHÔNG chứng minh server-side loss/anti-dupe.
Round 2 tính cả crafting inputs, giáp, off-hand, cursor, player slots trong GUI;
loại crafting preview và top container. Selector dùng decoded customName/NFC.

**`assert_nearby_entity` — `exactly` / `minimum` / `maximum` (DF-04).** Cùng hình
dạng lỗi. Khi có ràng buộc số lượng, runner lọc *toàn bộ* `bot.entities` rồi đếm
thay vì gọi `nearestEntity()` — đường cũ cho "merge còn 1" và "vẫn còn 2" cùng
kết quả pass.

**`wait_for_text` — `notText` (DF-02).** Negative assertion, bắt buộc kèm
`durationMs`: "chưa thấy X" luôn đúng ở thời điểm 0, nên chỉ có nghĩa khi quan
sát suốt một cửa sổ. Runner không dùng `poll()` cho nhánh này (poll trả về ngay
khi predicate đúng → pass tức thì ở ms đầu). `allOf` hạ từ `.min(2)` xuống
`.min(1)`.

### Action mới

**`drop_item` (DF-03).** Dùng `clickWindow` mode 4 trên đúng slot; không dùng
`toss` chọn lại theo material, không dùng cursor hay tự close window. Chặn GUI,
cursor bận và hotbar dig cooldown trước dispatch; partial drop kiểm lại mỗi click.
Evidence before/dropped/remaining dùng cùng predicate, là client-predicted delta
với `serverConfirmed: false`, KHÔNG chứng minh server chấp nhận thao tác.

**`capture` / `assert_capture` (DF-05).** So sánh text hiển thị giữa các step.
Không chứng minh cùng item/PDC, không cấp dynamic targetUuid hay thay thế DB oracle.
Mỗi step chỉ đọc event mới từ lúc nó bắt đầu; response burst đã tới ở step trước
không được tái dùng. Ưu tiên `source: 'chat'`; `any` có cả event nội bộ runner.

```jsonc
{ "action": "capture", "name": "itemCode", "pattern": "Mã số:\\s*([A-Z0-9-]+)" },
{ "action": "assert_capture", "name": "itemCode", "pattern": "Mã số:\\s*([A-Z0-9-]+)" }
```

`equals: false` chỉ chứng minh text capture khác nhau, không tự chứng minh nghiệp vụ.

Ràng buộc kiểm lúc parse, không đợi lúc chạy: pattern phải là regex hợp lệ và có
ít nhất một nhóm bắt và group được chọn phải tồn tại; tên biến không trùng;
`assert_capture` phải đứng sau `capture` cùng tên. Value >512 ký tự bị từ chối,
không truncate tạo collision. Regex chạy trong fixed-code VM, budget 25ms/match,
text tối đa 4096; vượt budget là INCONCLUSIVE, không treo event-loop vô hạn.

### Nới ràng buộc

**Trần `timeoutMs` 5 phút → 1 giờ (DF-06).** Bất đối xứng vô lý với
`maxDurationMs` vốn cho phép 1 giờ. RestaurantTycoon có luồng *thiết kế* là chờ
vài phút. Ràng buộc thật vẫn giữ: thời lượng chờ khai báo tường minh không được
vượt `maxDurationMs` hoặc `timeoutMs` của chính step (kể cả mặc định 30s).
Wait dài phải khai báo timeout đủ lớn; không đổi global default.

**`observe_crossing` pairing bỏ ràng buộc "đúng 1 block mỗi bên" (DF-07).**
Đối xứng quanh tâm và axis-aligned là invariant thật; con số 1 block chỉ đúng với
gate của LivingNPC, và nó khiến RestaurantTycoon phải bỏ hẳn pairing. Vẫn chặn
mất đối xứng, lệch trục, lệch cao độ, và vẫn yêu cầu đủ cả 4 field pairing.

### Paper 1.21.11 → mới nhất

Adapter compile theo **sàn** `1.21.11-R0.1-SNAPSHOT` giữ bytecode 21 — mẫu số
chung để một JAR chạy được cả trên 1.21.11 (Java 21) lẫn Paper 26.x (Java 25).
Build theo API mới nhất sẽ nâng bytecode lên 25 và mất 1.21.11.

`plugin.yml` dùng `api-version: '1.21.11'`. Theo Paper docs, đây là minimum,
KHÔNG phải exact-version pin; giải thích cũ về patch pin đã bị sửa.

Forward API COMPILE probe (không phải runtime):
```bash
npm run verify:paper-forward-compat
```
Tải latest stable paper-api, không lấy alpha từ Maven `<release>`, và compile
19 source ở `--release 21`. Observed: `26.2.build.121-stable`. CI dùng JDK 25 và
`REQUIRE_FORWARD_COMPAT=1`: thiếu javac/mạng không được xanh. Chưa Paper E2E.

### Cố ý KHÔNG làm

**`drag` (kéo-thả item giữa các ô).** Cần window click packet với `stateId` và
cursor state; sai một nhịp là desync im lặng — evidence sai còn tệ hơn không có
evidence. BastionForge vẫn no-go cho kéo-thả, và đó là kết luận có chủ ý.

### Tương thích ngược

Mọi thay đổi giữ mặc định cũ: `entityHalfWidth: 0`, `assert_inventory` không nêu
ràng buộc vẫn là `minimum: 1`, `assert_nearby_entity` không nêu số lượng vẫn là
"tồn tại ít nhất 1". Có test khoá riêng cho từng mặc định — nếu làm sai, mọi
scenario cũ sẽ im lặng đổi nghĩa thành "không assert gì".

Giữ mặc định cũ, nhưng schema nay reject wait vượt step timeout và capture group
không tồn tại. Phạm vi inventory được sửa rộng hơn; không hứa mọi scenario cũ
cho cùng verdict nếu trước đây dựa trên kiểm kê thiếu slot.

## 0.1.0

Bản đầu: scenario runner, evidence bundle đã seal, capability manifest,
Paper/Bukkit signed provider (P0.3), QA domain contracts.
