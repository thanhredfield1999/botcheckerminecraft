# BotChecker — báo cáo dogfooding liên dự án (2026-09-07)

Năm dự án thật được giao dùng thử BotChecker và báo cáo lại thiếu gì. Đây không
phải review nội bộ: mỗi dự án đóng vai người dùng, đọc source thật của repo mình,
viết scenario cho luồng QA thật, validate bằng `scenarioSchema.parse()`, rồi nêu
cái gì chặn họ.

Dự án tham gia: VillageDefense, LivingNPC, ItemGuard, RestaurantTycoon,
BastionForge. Input chung: `docs/DOGFOOD_BRIEF_2026-09-07.md`.

Trạng thái BotChecker khi dogfood: `800 test / 794 pass / 0 fail / 6 skip`.

## Điều kiện chạy — đọc trước khi tin kết quả

Cả 5 phiên đều **kết thúc bằng lỗi hạ tầng** (`HTTP 503` / API timeout), không
phải hoàn thành bình thường. Nghĩa là **không có báo cáo văn xuôi cuối cùng nào
từ các dự án**.

Cái thu được là artifact họ đã kịp tạo trước khi đứt: **21 scenario JSON**, kết
quả `scenarioSchema.parse()` thật, và các ghi chú `note` họ nhúng thẳng vào
scenario. Đó là bằng chứng cứng — nhưng nó là **một phần** của việc dogfooding,
không phải toàn bộ. Ưu tiên dưới đây phản ánh đúng phần đó, không hơn.

Mọi phát hiện trong tài liệu này đã được **tôi tự đối chiếu lại với
`src/scenario.ts`** trước khi ghi CONFIRMED. Dự án nói thiếu không có nghĩa là
đúng.

Scenario các dự án tạo (giữ nguyên, chưa merge vào `scenarios/`):

| Dự án | Vị trí | Số file |
|---|---|---|
| VillageDefense | `%TEMP%/vd-botchecker-qa` | 6 (5 pass + 1 probe cố ý fail) |
| ItemGuard | `E:/AI.WORK/scratch-itemguard-botchecker-dogfood-20260907` | 5 |
| RestaurantTycoon | `E:/AI.WORK/_scratch-rt-botchecker-dogfood/scenarios` | 5 |
| BastionForge | `E:/AI.WORK/scratch-bf-botchecker-dogfood` | 5 |
| LivingNPC | (validate inline, không ghi thư mục) | 5 |

## Phát hiện đã xác minh bằng source

### DF-01 — `assert_inventory` không có `exactly`/`maximum` (CONFIRMED, chặn nặng nhất)

`src/scenario.ts`:
```ts
action: z.literal('assert_inventory'),
itemIncludes: z.string().min(1),
minimum: z.number().int().positive().default(1)
```

Chỉ có `minimum`, và `.positive()` nên **không đặt được `minimum: 0`**.

ItemGuard nói thẳng, và họ đúng:
> "GAP LON NHAT: `minimum:1` van PASS ca khi dupe thanh cong tao ra 2 sword.
> `assert_inventory` khong co `exactly`/`maximum`."

Đây là lỗi thiết kế nghiêm trọng với một QA harness: assertion hiện tại **không
thể fail khi dupe xảy ra**. Một plugin anti-dupe không dùng được assertion này
để chứng minh điều nó cần chứng minh.

VillageDefense đụng đúng cùng bức tường từ hướng khác — họ cần chứng minh **mất
đồ** khi chết: `assert_inventory maximum:0` → schema reject.

Ảnh hưởng: ItemGuard (no-go), VillageDefense (no-go), BastionForge (no-go cho
verify kết quả rèn).

### DF-02 — `wait_for_text` không có negative assertion (CONFIRMED)

```ts
allOf: z.array(z.string().min(1)).min(2).max(16).optional(),
```

Hai vấn đề riêng biệt:
- Không có dạng "text này KHÔNG được xuất hiện" — VillageDefense thử, bị
  `Unrecognized key`.
- `allOf` bắt buộc `.min(2)`: muốn dùng dạng list với đúng 1 phần tử thì phải
  đổi sang `text`. Chỗ này gây khó chịu không cần thiết khi sinh scenario bằng
  script.

Negative assertion là thứ QA cần thường xuyên: "không có message lỗi nào",
"không rơi vào trạng thái X".

### DF-03 — không có action `drop_item` / `drag` (CONFIRMED)

`grep -cE "literal\('(drag|drop_item|drop)'\)"` → `0`.

- ItemGuard: "NO-GO: BotChecker khong co action `drop_item`. Buoc nay chi chay
  duoc neu fixture tu them mot command drop rieng — **tuc la phai sua san pham
  cho harness**." Câu cuối là lời phê bình đúng chỗ.
- BastionForge: kéo-thả item giữa 2 ô bị schema reject
  (`invalid_union: Expected 'wait_for_gui' | ...`).

Drop/pickup là **bề mặt dupe cổ điển nhất** của Minecraft. Không mô phỏng được
nó nghĩa là mảng anti-dupe gần như không tự động hoá được.

### DF-04 — không assert được số lượng entity (CONFIRMED)

```ts
action: z.literal('assert_nearby_entity'),
nameIncludes, requiredUuid, maxDistance   // không có count
```

ItemGuard:
> "GAP: assertion nay PASS ca khi merge thanh 1 lan khi van con 2. Khong co
> `count`/`exactly` cho nearby entity."
> "Ket qua that nam o cho: co dung 2 entity rieng biet giu nguyen 2 UUID hay
> khong. `inspect_entities` ghi lai list nhung khong assert duoc dieu do."

Cùng một hình dạng lỗi với DF-01: quan sát được, không assert được.

### DF-05 — không có state giữa các step (CONFIRMED qua schema)

Không có cơ chế bắt giá trị ở step N rồi so ở step M.

- ItemGuard: "text match nhung KHONG capture duoc gia tri code... step sau khong
  so sanh lai duoc" → không chứng minh được **cùng một mã item** trước/sau.
- RestaurantTycoon: "Dung de LAY UUID that; sau do **phai sua tay** `targetUuid`
  ben duoi. Khong co bien/tham chieu dong trong schema."

Hệ quả: mọi kiểm chứng dạng "định danh không đổi qua thao tác" — lõi của
anti-dupe và item tracking — phải làm thủ công.

### DF-06 — trần `timeoutMs` 300000ms (CONFIRMED)

```ts
timeoutMs: z.number().int().positive().max(300_000).default(30_000)
```

- LivingNPC: `wait` dài hơn 5 phút bị reject → scenario lunch-rest phải cắt nhỏ.
- RestaurantTycoon: "Food timeout theo thoi gian thuc; moi `wait` toi da
  300000ms" — và luồng đặt hàng của họ **thiết kế là chờ vài phút**.

Workaround được (chia nhiều step `wait`) nhưng làm scenario xấu và khó đọc.

### DF-07 — `observe_crossing` bắt buộc 4 field cùng lúc (CONFIRMED qua báo cáo RT)

RestaurantTycoon phải **bỏ hẳn** phần pairing:
> "Bo pairing (`targetUuid`/`serverWorld`/`dimension`/`gateBlock`) vi schema bat
> buoc ca 4 cung luc va **hinh hoc phai doi xung 1 block quanh tam gate**."

Ràng buộc hình học đó hợp lý cho gate của LivingNPC, nhưng nó vô tình khoá luôn
các dự án có "cửa" hình dạng khác. Cần xem lại: nên là *tuỳ chọn theo profile*,
không phải bắt buộc toàn cục.

### DF-08 — LivingNPC: `observe_crossing` PASS khi NPC cạ tường (CONFIRMED, tinh vi nhất)

Đây là phát hiện đáng giá nhất về mặt kỹ thuật.

Log của LivingNPC: **"PASS dù NPC cạ tường ở z=8.0018 (lateral 0.4982 < 0.6)"**

Nghĩa là: ngưỡng lateral hiện tại cho phép một NPC **đi sát/cạ vào tường** vẫn
được tính là đã băng qua aperture hợp lệ. Với chuẩn của LivingNPC — trajectory
liên tục A→B→C — đây là **false positive**, đúng loại lỗi mà `observe_crossing`
sinh ra để ngăn.

Cần: ngưỡng lateral cấu hình được theo độ rộng aperture thật, và/hoặc thêm điều
kiện thân NPC không chạm biên.

### DF-09 — không có ràng buộc giữ dấu tiếng Việt (đã kiểm, có tin tốt)

VillageDefense tự phát hiện họ viết text **không dấu** trong scenario, trong khi
plugin gửi text **có dấu**. Họ kiểm lại normalization của BotChecker và xác nhận:
**NFC + lowercase, KHÔNG strip dấu**.

Nên harness đúng; lỗi thuộc về người viết scenario. Nhưng nó là cái bẫy có thật
và lặp lại được — cần cảnh báo rõ trong tài liệu, và về lâu dài nên có lint
cảnh báo khi `text` toàn ASCII trong scenario của plugin tiếng Việt.

### DF-10 — RestaurantTycoon: không quan sát được vì plugin không broadcast

> "Chi hoat dong neu plugin broadcast text ra chat; hien tai khong co message nao
> nhu vay → khong quan sat duoc order."
> "KHONG dien dat duoc thuc su: plugin khong gui text timeout ra chat cho player."

Đây **không phải lỗi BotChecker** — nó là hệ quả trực tiếp của kiến trúc
black-box. Nhưng nó chỉ đúng một điều: với plugin không nói ra chat, BotChecker
gần như mù. Đây chính là lý do tồn tại của trusted server-side probe (P0.3), và
là lập luận mạnh nhất cho việc hoàn thiện nó.

Ghi chú thêm từ RT: `customer-traffic-runtime.enabled=false` trên build hôm nay,
nên scenario khách tự tới **không bao giờ chạy được** — vấn đề fixture, không
phải harness.

## Tổng hợp — thiếu sót lặp ở nhiều dự án

| Thiếu sót | Dự án đụng phải | Mức |
|---|---|---|
| Không assert được **số lượng chính xác** (item/entity) | ItemGuard, VillageDefense, BastionForge | Chặn |
| Không có **state giữa step** (capture → compare) | ItemGuard, RestaurantTycoon | Chặn |
| Không có **drop/drag** | ItemGuard, BastionForge | Chặn |
| Không có **negative assertion** | VillageDefense, RestaurantTycoon | Cao |
| Không đọc được **server-side truth** | Tất cả 5 | Nền tảng |
| Trần `timeoutMs` 5 phút | LivingNPC, RestaurantTycoon | Trung bình |

Điểm chung của 4 mục đầu: BotChecker **quan sát tốt, assert yếu**. Nó ghi được
rất nhiều evidence nhưng thiếu đúng những assertion khiến evidence đó kết luận
được điều gì. Với QA harness, đó là khoảng cách giữa "có log" và "có bằng chứng".

## Đã sửa — đợt 1 (2026-09-07, ngay sau dogfooding)

Ba thiếu sót rẻ nhất và chặn nhiều dự án nhất đã được vá theo TDD (RED trước,
GREEN sau). Gate sau khi sửa: `810 test / 804 pass / 0 fail / 6 skip`.

### DF-01 — `assert_inventory` giờ có `exactly` / `maximum`, và nhận `minimum: 0`

```jsonc
{ "action": "assert_inventory", "itemIncludes": "sword", "exactly": 1 }   // dupe → FAIL
{ "action": "assert_inventory", "itemIncludes": "sword", "maximum": 0 }   // chứng minh đã mất
```

Schema loại trừ lẫn nhau: `exactly` không đi cùng `minimum`/`maximum`, và
`minimum > maximum` bị chặn lúc parse. Runner so sánh đúng ba nhánh, thông báo
lỗi nêu cả kỳ vọng lẫn số quan sát được.

**Tương thích ngược**: scenario cũ không nêu ràng buộc nào vẫn được `.transform()`
về `minimum: 1` — đúng hành vi trước đây. Có test khoá riêng điều này, vì nếu
làm sai thì mọi scenario cũ sẽ im lặng biến thành "không assert gì".

### DF-04 — `assert_nearby_entity` giờ đếm được

```jsonc
{ "action": "assert_nearby_entity", "nameIncludes": "item", "exactly": 2 }
{ "action": "assert_nearby_entity", "nameIncludes": "item", "maximum": 0 }  // vắng mặt
```

Điểm mấu chốt nằm ở runner, không phải schema: khi có ràng buộc số lượng, nó lọc
**toàn bộ** `bot.entities` rồi đếm, thay vì gọi `nearestEntity()`. Dùng đường cũ
thì "merge còn 1" và "vẫn còn 2" cho cùng kết quả pass — đúng lỗi ItemGuard báo.

`requiredUuid` pin một entity nên không kết hợp được với `exactly` khác 1.

### DF-02 — `wait_for_text` có `notText`, `allOf` nhận 1 phần tử

```jsonc
{ "action": "wait_for_text", "notText": "Lỗi", "durationMs": 5000 }
```

`durationMs` là **bắt buộc** với `notText`, và đây là quyết định có chủ ý:
"chưa thấy X" luôn đúng ở thời điểm 0, nên assertion chỉ có nghĩa khi quan sát
suốt một cửa sổ. Runner cũng không dùng `poll()` cho nhánh này — `poll()` trả về
ngay khi predicate đúng, tức là pass tức thì ở ms đầu tiên. Nó chờ hết cửa sổ,
và fail ngay giữa chừng nếu text cấm xuất hiện.

`allOf.min(2)` hạ xuống `.min(1)`.

### Chưa làm trong đợt này

DF-05 (state giữa step), DF-06 (trần `timeoutMs`), DF-07 (`observe_crossing` bắt
buộc 4 field).

## Đã sửa — đợt 2 (2026-09-07): DF-08 và DF-03

Gate sau đợt 2: `819 test / 813 pass / 0 fail / 6 skip`.

### DF-08 — sửa false positive `observe_crossing` (bug, không phải thiếu tính năng)

Đây là mục duy nhất trong toàn bộ dogfooding là **lỗi đang tồn tại**, nên làm
trước. LivingNPC quan sát được:

```
PASS dù NPC cạ tường ở z=8.0018 (lateral 0.4982 < 0.6)
```

Nguyên nhân: corridor check so `corridorHalfWidth` với **tâm** entity, bỏ qua bề
ngang thân. NPC dạng người rộng 0.6 (nửa 0.3) có tâm ở lateral 0.4982 → mép thân
ở **0.798**, đã đâm vào tường của aperture rộng 1.2. Nhưng tracker vẫn báo
`crossed: true`.

Sửa: thêm `entityHalfWidth` vào `CrossingOptions` (mặc định `0` = hành vi cũ).
Corridor check tính theo mép thân.

Điểm dễ sai và tôi đã kiểm: corridor check xuất hiện ở **ba** chỗ trong
`crossing.ts` — sample hiện tại, sample trước đó, và **điểm cắt mặt phẳng gate**.
Chỗ thứ ba quan trọng nhất: nếu chỉ sửa chỗ đầu, thân entity vẫn có thể xuyên
tường đúng vào khoảnh khắc băng qua. Cả ba nay dùng chung `withinCorridorAt()`.

Thêm `lateralClearance` vào observation — khoảng cách còn lại từ mép thân tới
tường, âm nghĩa là đã vượt. Chính con số này lẽ ra làm DF-08 lộ ra sớm hơn, thay
vì chỉ một boolean pass/fail.

`entityHalfWidth >= corridorHalfWidth` bị ném lỗi ngay lúc dựng tracker: thân
không lọt thì mọi run đều fail, đó là lỗi cấu hình phải báo sớm.

Nối lên schema ở **cả hai** nơi: `observe_crossing` và gate của `observe_route`
(hai chỗ dùng chung `CrossingTracker`; sửa một chỗ thì route-level vẫn giữ
nguyên false positive).

Dùng cho NPC dạng người:
```jsonc
{ "action": "observe_crossing", "entityHalfWidth": 0.3, ... }
```

### DF-03 — thêm `drop_item`

ItemGuard nói: *"phải sửa sản phẩm cho harness"* — bắt plugin thêm command drop
chỉ để test được là làm hỏng chính thứ đang kiểm.

```jsonc
{ "action": "drop_item", "itemIncludes": "sword" }              // cả stack
{ "action": "drop_item", "itemIncludes": "sword", "count": 1 }  // một phần
```

Runner dùng `bot.tossStack()` cho cả stack và `bot.toss()` cho một phần — hai API
khác nhau, dùng `toss` với đúng số lượng stack sẽ để lại stack rỗng lơ lửng.
Evidence trả `dropped` và `remaining` để kiểm chứng được kết quả khi đọc lại
report. Thả nhiều hơn số đang giữ bị chặn với thông báo nêu rõ số thật.

**Cố ý KHÔNG làm `drag`.** Kéo-thả cần window click packet với `stateId` và
cursor state; sai một nhịp là desync im lặng — evidence sai còn tệ hơn không có.
BastionForge vẫn no-go cho kéo-thả, và đó là kết luận có chủ ý, không phải bỏ sót.

## Đã sửa — đợt 3 (2026-09-07): DF-05, DF-06, DF-07 → chốt 0.2.0

**Cả 8 finding đã xử lý.** Gate: `831 test / 825 pass / 0 fail / 6 skip`.

### DF-05 — `capture` / `assert_capture` (ảnh hưởng sâu nhất)

Thiếu sót này chặn mọi kiểm chứng dạng "định danh không đổi qua thao tác" — lõi
của anti-dupe và item tracking.

```jsonc
{ "action": "capture", "name": "itemCode", "pattern": "Mã số:\\s*([A-Z0-9-]+)" },
{ "action": "drop_item", "itemIncludes": "sword" },
{ "action": "assert_capture", "name": "itemCode", "pattern": "Mã số:\\s*([A-Z0-9-]+)" }
```

`equals: false` chứng minh giá trị **đã đổi** — cần cho luồng ngược (sau khi rèn,
mã item phải khác; giống nghĩa là thao tác không có hiệu lực).

Bốn quyết định thiết kế đáng ghi:

1. **Không làm template `${var}` thay thế tự do trong mọi field.** Nó biến
   scenario thành ngôn ngữ lập trình mini — khó kiểm chứng và dễ sinh evidence
   sai một cách im lặng. Chỉ `assert_capture` đọc biến.
2. **Ràng buộc kiểm lúc parse, không đợi lúc chạy.** Pattern phải là regex hợp lệ
   và có ít nhất một nhóm bắt; tên biến phải là identifier, không trùng;
   `assert_capture` phải đứng **sau** `capture` cùng tên theo thứ tự step. Nếu để
   lúc chạy, một scenario sai chính tả sẽ chạy hết rồi báo pass vì "không có gì
   để so" — đúng loại false positive mà harness này sinh ra để ngăn.
3. **Giá trị cắt ở 512 ký tự.** Capture đi thẳng vào evidence bundle, không được
   phép thành đường bơm dữ liệu tuỳ ý.
4. **Đếm nhóm bắt bằng `new RegExp(source + '|').exec('')`** thay vì parse regex
   bằng tay — mẹo chuẩn, không tự viết parser.

Giới hạn thật, đã ghi vào brief: `capture` chỉ trích được từ text plugin **nói
ra**, không phải state thật. Nó không thay thế trusted probe.

### DF-06 — trần `timeoutMs` 5 phút → 1 giờ

Bất đối xứng vô lý: `maxDurationMs` cho phép 1 giờ nhưng một step không chờ quá 5
phút. RestaurantTycoon có luồng *thiết kế* là chờ vài phút.

Ràng buộc thật vẫn giữ: thời lượng chờ **khai báo tường minh** không được vượt
`maxDurationMs`. Lần đầu tôi tính cả `step.timeoutMs` vào ràng buộc này và làm đỏ
14 test — mặc định 30s của một field không ai khai báo lại chặn scenario 1s hợp
lệ. Chỉ tính giá trị người viết chủ động đặt.

### DF-07 — pairing bỏ ràng buộc "đúng 1 block mỗi bên"

RestaurantTycoon phải bỏ hẳn pairing vì ràng buộc `|dx| == 2`. Đối xứng quanh tâm
và axis-aligned là invariant **thật** (chúng bảo đảm crossing plane vuông góc với
gate và hai điểm nằm hai phía); con số 1 block chỉ đúng với gate của LivingNPC.

Vẫn chặn: mất đối xứng, lệch trục, lệch cao độ, và vẫn yêu cầu đủ cả 4 field
pairing — nới hình học không phải nới tính toàn vẹn.

## Ưu tiên đề xuất

Xếp theo số dự án bị chặn × mức độ chặn, không theo độ dễ làm.

1. **`exactly` / `maximum` cho `assert_inventory`, cho phép `minimum: 0`** —
   3 dự án no-go. Rẻ, nội bộ, không cần server. Làm trước.
2. **`count`/`exactly` cho `assert_nearby_entity`** — cùng hình dạng lỗi, cùng
   mức rẻ.
3. **Negative assertion cho `wait_for_text`** (`notText`/`absent`), bỏ ràng buộc
   `allOf.min(2)`.
4. **State giữa step**: capture giá trị (mã item, UUID, số dư) ở step N, so sánh
   ở step M. Đây là thay đổi thiết kế thật, không phải thêm field — nhưng nó mở
   khoá toàn bộ mảng "định danh không đổi".
5. **`drop_item` + `drag`** — mở khoá bề mặt dupe cổ điển. Cần cẩn thận với
   protocol (window `stateId`, cursor).
6. **Sửa ngưỡng lateral `observe_crossing`** (DF-08) — đây là *false positive
   đang tồn tại*, khác với các mục trên là *thiếu tính năng*. Ưu tiên cao hơn
   nếu LivingNPC sắp dùng thật.
7. **Nới `timeoutMs`** hoặc thêm `wait_until` có điều kiện.
8. **Hoàn thiện P0.3 trusted probe** — lời giải gốc cho DF-10 và cho mọi câu hỏi
   về server-side truth. Đắt nhất, nhưng là thứ duy nhất phá được trần black-box.

## Điều chưa biết

- Không có báo cáo văn xuôi từ dự án nào (cả 5 đứt vì 503). Các mục "phải tự viết
  script ngoài" mới chỉ có tín hiệu rời rạc (VillageDefense có
  `send_console_command.py`), chưa có bản kiểm kê đầy đủ.
- 21 scenario mới chỉ qua `scenarioSchema.parse()`. **Chưa scenario nào chạy
  trên server thật** — nên chúng chứng minh "diễn đạt được", không chứng minh
  "chạy đúng".
- Chưa merge scenario nào vào `scenarios/`. Cần rà từng cái trước khi nhận.
