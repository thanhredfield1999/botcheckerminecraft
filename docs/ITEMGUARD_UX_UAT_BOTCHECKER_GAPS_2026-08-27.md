# BotChecker gaps found by ItemGuard UX UAT — 2026-08-27

## Kết luận

Controlled ItemGuard command/GUI UAT trên Paper `1.21.11-131`, protocol `774`, Mineflayer `4.37.1` đã lộ ra bốn thiếu sót P0/P1 của live BotChecker. Không có evidence cho lỗi ItemGuard hoặc server exception trong các điểm này. Hai lỗi còn lại là lỗi oracle/scenario do người viết test, không phải BotChecker. Các P0/P1 trong report này sau đó đã được sửa theo TDD và authoritative rerun đã PASS; historical findings bên dưới được giữ làm RCA, không phải backlog chưa xử lý.

BotChecker nên ưu tiên:

1. decode Adventure chat component cho GUI title/custom name/lore;
2. biến `assert_state` thành polling assertion đúng với `timeoutMs`;
3. thêm semantic GUI transition/window-generation oracle thay vì yêu cầu người viết chèn `wait 300ms` thủ công;
4. hỗ trợ composite text assertion hoặc controlled lookback để một message có thể được kiểm nhiều predicate mà không race.

Evidence đã seal ngoài clone:

- `E:/AI.WORK/evidence/itemguard-ux-uat-20260827/`
- archive: `E:/AI.WORK/evidence/itemguard-ux-uat-20260827.tar.gz`
- SHA-256: `ac6840fe4ea13279042d09c52781c431ec10265e18834b762a0b048e7b79c3da`

## Phân loại findings

| Ưu tiên | Finding | Phân loại | Evidence |
|---|---|---|---|
| P0 | Adventure component bị render thành `[object Object]` | BotChecker capability bug | run `303b0472-42ef-4807-bbab-dcda93ea9d5d` |
| P0 | `assert_state` kiểm một lần, không poll tới timeout | BotChecker semantic bug | run `29fa567c-00cd-4bd9-b1a0-7ee4dd01ab08` |
| P1 | Thiếu primitive chờ GUI transition ổn định/generation mới | BotChecker capability gap; fail-closed click hiện tại là đúng | run `4674399a-fee3-4c36-888f-b195f93c0448` |
| P1 | `wait_for_text` không thể dùng hai assertion tuần tự cho cùng một message | BotChecker capability gap | run `d2358257-5e68-4087-bf5e-4f2a8e5ba86e` |
| P1 | GUI snapshot `slotCount` trộn top container và player inventory | BotChecker report ambiguity | run `303b0472-...`: generic_9x6 báo 90; generic_9x1 báo 45 |
| P1 | Selector thiếu `material`, `topInventoryOnly`, `slotEmpty`, cardinality/absence | BotChecker capability gap | scenario ItemGuard buộc dùng slot-only oracle yếu hơn |
| P2 | Live API chưa orchestration nhiều account trong một run | BotChecker live-provider gap | ItemGuard phải chạy hai API/queue riêng và hold account thủ công |
| P2 | Harness limitation thường bị ghi `FAIL/high` thay vì `INCONCLUSIVE_HARNESS` | BotChecker verdict taxonomy gap | component decode/window-close timing reports |
| N/A | Direct alias deny trả `Unknown or incomplete command` | Scenario/oracle author bug | run `90cbd399-a064-4076-a780-628bfc0b421f`; Paper manifest permission hoạt động đúng |
| N/A | ASCII `Phat hien` không match Unicode `Phát hiện` | Scenario/oracle author bug | run `d2358257-...`; exact Unicode line có trong timeline |

## P0-1 — Decode Adventure components đúng chuẩn

### OBSERVED

`src/snapshot.ts:9-20` chỉ gọi `value.toString()` hoặc `String(value)`. Với component object do Paper 1.21.11/Mineflayer cung cấp:

- GUI title thành `[object Object]`;
- custom name thành `[object Object]`;
- mỗi lore line thành `[object Object]`.

Run `303b0472-...` cho thấy GUI thực mở đúng slot/material nhưng `titleIncludes` và `loreIncludes` không thể dùng. Việc bỏ text selectors để tiếp tục UAT chỉ chứng minh layout/navigation, không chứng minh visual UX.

### Tight repro

Tạo fixture snapshot với các dạng component thực tế từ protocol 774:

- string;
- JSON chat component `{text, extra, color, bold}`;
- object có `toJSON()`;
- prismarine-chat `ChatMessage`;
- translatable component;
- nested lore component array.

Hiện tại expected RED: output chứa `[object Object]`.

### Acceptance

- `guiText` trả plain text có thứ tự, không chứa `[object Object]`.
- Giữ color/style ngoài search text nhưng có thể lưu structured sanitized component riêng nếu cần.
- Không đọc raw NBT/component ngoài bound; output vẫn tối đa `256` ký tự và `16` lore lines.
- `assert_gui titleIncludes/nameIncludes/loreIncludes` PASS với component thực protocol 774.
- Regression live hoặc captured-packet fixture chứng minh `ItemGuard - Lịch Sử Item`, `Quay lại`, `Đóng`, `#UXS001` được decode.

## P0-2 — `assert_state` phải poll tới timeout

### OBSERVED

`src/runner.ts:502-507` kiểm state đúng một lần. `timeoutMs` chỉ bọc lời gọi bằng `withTimeout`; do function trả/throw ngay nên timeout không có tác dụng chờ.

Run `29fa567c-...`:

- click barrier slot 49 được inspect và authorized;
- step click PASS;
- `assert_state gui=closed` chạy ngay và FAIL `Expected GUI closed, found open`;
- event `gui_close` đến ngay sau failed step.

### Tight repro

Fake bot bắt đầu `currentWindow != null`, sau 25 ms chuyển `null`; step `assert_state gui=closed timeoutMs=100`. Hiện tại RED tức thời; behavior mong muốn PASS sau khoảng 25 ms.

### Acceptance

- `assert_state` poll health/food/gui tới khi tất cả predicate thỏa hoặc timeout.
- Evidence khi timeout lưu last observed state + elapsed time.
- Abort/cancel vẫn ngắt polling ngay.
- Không biến health giảm thật thành transient PASS sai: cần hỗ trợ `mode: eventually` (default cho GUI) và về sau `mode: consistently` nếu cần soak.

## P1-1 — Semantic GUI transition / generation oracle

### OBSERVED

`click_gui` hiện inspect → delay → recheck same window ID → click. Đây là fail-closed đúng và phải giữ.

Sau click mở detail trong run `4674399a-...`:

- `assert_gui` kế tiếp đọc GUI cũ #1 ở elapsed `1546 ms` và PASS theo slot-only selector;
- GUI mới #2 đến ở `1555 ms`;
- click kế tiếp bị chặn đúng: `GUI changed or closed while BotChecker was reading it`.

Manual `wait 300ms` giúp nhưng là workaround thời gian, không phải oracle semantic.

### Proposed action/schema

Một trong hai:

```json
{"action":"wait_for_gui_transition","fromGeneration":"previous","state":"open","topType":"minecraft:generic_9x1"}
```

hoặc mở rộng click:

```json
{
  "action":"click_gui",
  "slot":10,
  "expect":{"window":"new","topRows":1,"items":[{"slot":0,"material":"arrow"}]}
}
```

### Acceptance

- Runner duy trì monotonic `windowGeneration` tăng trên open/close, không chỉ dựa `window.id` vì ID có thể tái sử dụng.
- `assert_gui` có tùy chọn `afterStep`/`generationGreaterThan` để không match GUI cũ.
- Click vẫn bị block nếu window đổi giữa final inspect và actual click.
- Transition wait timeout trả `INCONCLUSIVE_HARNESS` nếu client không quan sát được packet, `FAIL` nếu đã quan sát GUI sai rõ ràng.

## P1-2 — Composite text assertions và lookback có kiểm soát

### OBSERVED

`src/runner.ts:295` đặt `eventCursor` tại đầu mỗi step. `wait_for_text` chỉ tìm `events.slice(eventCursor)`.

Staff output có một dòng:

`- UX Staff Sword 001 | Chủ: ItemGuardStaffUX | Phát hiện: 1 lần`

Step đầu chờ `UX Staff Sword 001` PASS. Step kế tiếp chờ `Phat hien` không thể thấy lại dòng trước và cũng sai Unicode, nên timeout.

### Proposed action/schema

Hỗ trợ một composite step:

```json
{
  "action":"wait_for_text",
  "source":"chat",
  "allOf":["UX Staff Sword 001","Phát hiện: 1 lần"],
  "normalize":"unicode-nfc-casefold"
}
```

Hoặc `lookback: { sinceStep: "code-search-command" }`, bounded tối đa N events/N ms.

### Acceptance

- Một event có thể thỏa nhiều predicate trong cùng step.
- Default hiện tại `since current step` giữ để tránh stale message false-green.
- Lookback phải explicit, bounded và lưu matched event timestamp/index.
- Unicode matching default nên NFC + locale-insensitive casefold; không tự strip dấu vì có thể gây collision. Nếu muốn accent-insensitive phải là option riêng.

## P1-3 — Tách top container khỏi player inventory

### OBSERVED

`snapshotGui` dùng `window.slots.length` và toàn bộ `window.slots`:

- generic_9x6 report `slotCount=90`, thay vì top container `54`;
- generic_9x1 report `slotCount=45`, thay vì top container `9`.

Điều này làm report và selector slot dễ nhầm top inventory với player inventory.

### Acceptance

`GuiSnapshot` nên có:

```ts
{
  topSlotCount: 54,
  totalSlotCount: 90,
  inventoryStart: 54,
  items: [{slot, section: 'top'|'player', ...}]
}
```

- `click_gui` mặc định chỉ cho top inventory; muốn click player inventory phải explicit `section: player`.
- Formatter ghi `54 top / 90 total`, không gọi 90 là số slot GUI.
- Regression cho generic 9x1, 9x6, hopper, chest và player inventory.

## P1-4 — Selector/absence/cardinality đầy đủ

Current schema chỉ có `slot`, `nameIncludes`, `loreIncludes`, `count`. Cần thêm:

- `material` exact;
- `section: top|player`;
- `slotEmpty: true` hoặc action `assert_gui_empty_slot`;
- `matchCount`/`exactly` cho cardinality;
- `absent` selector;
- `topRows`/`topSlotCount`;
- `windowGeneration`/`afterStep`.

Acceptance ItemGuard pagination:

- page 1: đúng 28 `diamond_sword` ở top grid slots và next button;
- page 2: đúng 1 `diamond_sword`, previous button, không có item thứ hai trong grid;
- không cần dựa title/lore khi component decoder unavailable; sau P0-1 phải kiểm cả text.

## P2-1 — Live multi-account orchestration

Current repo có offline contracts/runner boundary cho multi-account nhưng HTTP live server vẫn dùng một account từ environment mỗi process. ItemGuard permission test phải:

- chạy API `18085` cho staff hold;
- chạy API `18086` cho member;
- orchestration ngoài repo;
- tự bảo đảm target online trước member test.

Đề xuất live plan endpoint nhận account references đã provision an toàn, chạy concurrent bounded khi contract yêu cầu target online. Không đưa password/token vào scenario/report. Report cha phải link child run IDs, roles, overlap interval và per-account verdict.

## P2-2 — Verdict taxonomy cho harness limitation

Current `verdictForStep` chỉ coi message bắt đầu `INCONCLUSIVE_` là inconclusive. Live harness bugs thường thành `FAIL/high`:

- component `[object Object]` → title mismatch timeout;
- close packet đến ngay sau immediate assertion;
- client decode/protocol limitation.

Đề xuất typed error thay vì dựa string prefix:

- `PRODUCT_ASSERTION_FAILED` → FAIL;
- `HARNESS_DECODE_UNSUPPORTED` → INCONCLUSIVE;
- `HARNESS_TRANSITION_NOT_OBSERVED` → INCONCLUSIVE;
- `FIXTURE_PRECONDITION_FAILED` → INCONCLUSIVE;
- `SAFETY_BLOCKED_STALE_WINDOW` → INCONCLUSIVE hoặc FAIL theo scenario contract, nhưng không gán product bug tự động.

Report phải giữ raw step status và `attribution` riêng; không tự đổi historical reports.

## Những gì không phải BotChecker bug

1. Run `90cbd399-...`: `/igstats` của member trả `Unknown or incomplete command`. Paper lọc command theo manifest permission trước executor; đây là đúng fail-closed/discoverability behavior. Scenario mong message ItemGuard là sai.
2. Run `d2358257-...`: expected ASCII `Phat hien`, output thực là Unicode `Phát hiện`. Oracle sai. Tuy nhiên inability reuse same event ở step kế tiếp vẫn là capability gap riêng.
3. `click_gui` block khi window đổi là đúng safety behavior, không được bỏ guard hoặc click blind.

## ItemGuard verdict boundary từ UAT này

### VERIFIED runtime

- member direct alias deny/hidden;
- member browser, code-history, other-player-history deny;
- self-history open;
- detail open/back;
- parent browser return;
- close click được inspect/authorized;
- staff `/igstats` và `/igsearch #UXS001` output;
- protocol/UUID fixture đúng;
- không có ItemGuard/Paper exception trong journey.

### NOT VERIFIED runtime

- GUI title/custom name/lore visual text;
- staff browser/filter/pagination `28+1`/history journey vì staff scenario dừng sớm;
- final close state dưới một polling oracle hợp lệ;
- production.

Không có evidence yêu cầu sửa ItemGuard từ các failure này.

## Đề xuất thứ tự triển khai

1. P0 component decoder + captured protocol-774 fixtures.
2. P0 polling `assert_state`.
3. P1 generation-aware GUI transition.
4. P1 composite text matcher/lookback + Unicode normalization.
5. P1 top/total slot model + material/absence/cardinality selectors.
6. P2 live multi-account orchestration.
7. P2 typed verdict attribution.

Sau 1–5, rerun chính hai scenario đã seal. Acceptance tối thiểu:

- member `24/24 PASS` mà không thêm sleep tùy tiện;
- staff đi qua đủ browser/filter/page1/page2/history/detail/back/close;
- title/lore không còn `[object Object]`;
- report phân biệt top slots với player inventory;
- clone restore và production boundary giữ nguyên.

## Authoritative rerun resolution

- BotChecker final gate: typecheck PASS; `318` pass, `0` fail, `2` intentional Windows skips; build và `git diff --check` PASS.
- Live protocol-774 RED `d9feae08-45ee-4760-9e6a-462edf09809c` bổ sung exact prismarine-NBT wire shape; bounded decoder regression RED rồi GREEN.
- Member run `d26d730e-6bff-4471-8c96-5d104d811f62`: `24/24 PASS`, Adventure GUI text và final polling close verified.
- Staff run `40698a9d-a0ff-4422-ac9a-3b5e21a1a33b`: `38/38 PASS`, Unicode composite, filter, exact page `28+1`, history/detail/back/close verified.
- Staff RED `969fd096-b849-4092-a9ca-9c2b67d5207a` được phân loại scenario selector overlap với back control; acceptance `exactly 2` giữ nguyên bằng history-row marker riêng.
- Runtime source fingerprint: `fc7d4d7e1986bdfef35cc8dfac879ef97ed07344b5f84c1d7bc7a0506c4b2a10`.
- Sealed archive: `E:/AI.WORK/evidence/itemguard-ux-uat-rerun-20260827-124601.tar.gz`, SHA-256 `b64914fe00b7025ff644638a3d114a7a897f999325dc7d49448d254b6bf99a00`.
- Clone restore byte-exact/offline; production untouched. P2 orchestration/taxonomy and broader provenance/release scopes remain open.
