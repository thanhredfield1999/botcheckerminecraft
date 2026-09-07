# BotChecker 0.2.0 — tài liệu năng lực cho dự án dùng thử

Tài liệu này là input duy nhất cho một dự án khi dùng BotChecker. Nó mô tả
**đúng những gì BotChecker làm được hôm nay**, không phải roadmap.

Phiên bản: **0.2.0** (chốt 2026-09-07 sau vòng dogfooding 5 dự án).
Gate: `831 test / 825 pass / 0 fail / 6 skip`.
Xem `CHANGELOG.md` để biết 0.2.0 thay đổi gì so với 0.1.0.

## BotChecker là gì

Một black-box QA harness cho plugin Minecraft. Nó điều khiển một client Mineflayer
thật kết nối tới server được ủy quyền, chạy một *scenario* JSON gồm các bước, rồi
ghi lại evidence bounded đã seal.

Nó **không** đọc được state phía server (Bukkit event, PDC, DB, scheduler). Mọi
thứ nó biết đến từ góc nhìn client.

## Cách chạy

```bash
npm install
npm run build

# API mặc định nghe 127.0.0.1:8080
npm start
```

Biến môi trường quan trọng:

| Biến | Ý nghĩa |
|---|---|
| `MC_HOST` / `MC_PORT` | server đích |
| `MC_USERNAME` | tài khoản test chuyên dụng |
| `MC_AUTH` | đúng `offline` hoặc `microsoft`, sai là throw lúc khởi động |
| `API_HOST` | ngoài loopback thì **bắt buộc** `API_CREDENTIAL` ≥16 ký tự |
| `API_CREDENTIAL` | Bearer token cho mọi route `/api/*` |
| `SCENARIO_DIR` | mặc định `scenarios/` |
| `REPORT_DIR` | mặc định `reports/` |
| `MAX_RETAINED_RUNS` | mặc định 64 |

## HTTP API

```http
GET  /health                      # không cần credential
GET  /api/scenarios
POST /api/runs                    {"scenario":"tên-file-không-đuôi"}
GET  /api/runs/{runId}
GET  /api/runs/{runId}/report
POST /api/runs/{runId}/cancel
```

Mọi `/api/*` cần `Authorization: Bearer <API_CREDENTIAL>` khi credential được cấu
hình. Scenario không tồn tại → `404 {"error":"Scenario not found"}`.

## Scenario schema — các action dùng được

Tối đa **256 step**/scenario. Mỗi step có `id`, `timeoutMs` (mặc định 30000),
`optional`.

**Di chuyển & tương tác**
- `go_to` — x/y/z, `range`, `travel: walk|teleport`
- `interact_entity` — `nameIncludes`, `requiredUuid`, `maxDistance`,
  `interactionRange`, `waitForGui`
- `equip` — `itemIncludes`, `destination`
- `drop_item` — `itemIncludes`, `count` (bỏ trống = cả stack). Evidence trả
  `dropped` + `remaining`.
- `fish`, `plant` — action gameplay hẹp
- `chat` — gửi message/command
- `wait` — `durationMs`

**GUI** (có inspect-before-click)
- `wait_for_gui` — `titleIncludes`
- `assert_gui` — `titleIncludes`, `topSlotCount`, `items[]` (slot, material,
  nameIncludes, loreIncludes, count, exactly, absent, slotEmpty)
- `click_gui` — `slot` hoặc `nameIncludes`/`loreIncludes`, `button`,
  `inspectDelayMs`

**Assertion**
- `wait_for_text` — `text` / `allOf[]` / `notText` (negative, cần `durationMs`),
  `source: any|chat|title|action_bar`
- `assert_inventory` — `itemIncludes` + `minimum` / `maximum` / `exactly`
  (`exactly` là thứ duy nhất fail được khi dupe tạo thêm bản sao)
- `assert_position`, `assert_state` (health/food/gui)
- `assert_nearby_entity` — thêm `minimum`/`maximum`/`exactly` để đếm entity
- `inspect_entities`

**State giữa các step** (0.2.0)
- `capture` — `name`, `pattern` (regex có nhóm bắt), `group`, `source`
- `assert_capture` — so lại biến đã capture; `equals: false` chứng minh ĐÃ ĐỔI

```jsonc
{ "action": "capture", "name": "itemCode", "pattern": "Mã số:\\s*([A-Z0-9-]+)" },
{ "action": "drop_item", "itemIncludes": "sword" },
{ "action": "assert_capture", "name": "itemCode", "pattern": "Mã số:\\s*([A-Z0-9-]+)" }
```

Ràng buộc kiểm lúc parse: pattern phải hợp lệ và có nhóm bắt, tên phải là
identifier không trùng, `assert_capture` phải đứng sau `capture` cùng tên.

**Quan sát**
- `observe_load` — sample TPS-proxy phía client
- `observe_route` — checkpoint/fence/gate, có oracle
- `observe_crossing` — chứng minh đi qua một aperture (dùng cho gate A→B→C).
  Đặt `entityHalfWidth` (vd 0.3 cho NPC dạng người) để corridor tính theo mép
  thân thay vì tâm — không đặt thì NPC cạ tường vẫn được tính là qua hợp lệ.

## Evidence

Mỗi run tạo một bundle đã seal trong `REPORT_DIR`:
- `<runId>.json` — report đầy đủ (steps, timeline, manifest)
- `<runId>.bundle.json` — seal SHA-256 của toàn bộ artifact
- route map JSON/HTML nếu scenario có `observe_route`

Ghi bundle là **atomic**: lỗi giữa chừng rollback sạch, retry được cùng `runId`.

`manifest` gồm: capability manifest (Git commit, dirty, source fingerprint,
capability mode derive từ import graph thật), scenario SHA-256, target
(host/port/**auth mode**), observed (negotiated version, protocol, world,
dimension, account UUID).

## QA domain — trạng thái thật

Chỉ **negative-security** có producer chạy được qua HTTP (`qaPlanExecutor`).

Chín domain còn lại — permission, persistence, transaction/idempotency,
crash-recovery, compatibility, gameplay, GUI, multi-client, multi-account — **chỉ
có contract + report builder**, không có đường chạy cho operator. Chúng chỉ gọi
được từ test.

## Paper adapter (P0.3) — chưa dùng được

Có một Paper/Bukkit adapter + KeyStore companion để lấy số người chơi **đã xác
thực** từ phía server. Trạng thái: code đã wire, build sạch, có test offline —
nhưng **chưa từng chạy trên Paper thật**. Đừng dựa vào nó.

Hỗ trợ 1.21.11 → mới nhất: compile theo sàn 1.21.11 (bytecode 21), có gate
`npm run verify:paper-forward-compat` kiểm chứng lại với paper-api mới nhất.

## Những gì BotChecker KHÔNG làm được (đọc kỹ)

- Không đọc Bukkit event, cancel state, event priority
- Không đọc PDC/NBT authoritative — `assert_inventory` chỉ substring + số lượng.
  `capture` chỉ trích được từ text plugin **nói ra**, không phải state thật.
- Không có exact slot/cursor/stack identity assertion
- Không kéo-thả item giữa các ô (`drag`) — cần window click packet với `stateId`,
  sai một nhịp là desync im lặng. Cố ý chưa làm.
- Không chạy multi-client thật đồng thời (các runner chạy tuần tự)
- Không tự start/stop/restart server — persistence/crash phải do provider ngoài
- Không đọc DB/file/log của plugin
- Không có replay protocol offline
- Không có endpoint đọc lại bundle đã seal sau restart
- Không chứng minh được điều gì về server-side truth mà không có trusted probe

Ràng buộc thời gian (0.2.0): `timeoutMs` và `wait.durationMs` tối đa 1 giờ, nhưng
không được vượt `maxDurationMs` của scenario.
