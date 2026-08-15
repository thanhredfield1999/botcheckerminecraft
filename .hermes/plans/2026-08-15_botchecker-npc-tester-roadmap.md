# BotChecker NPC Tester – Kế hoạch nghiên cứu và triển khai

**Mục tiêu:** Xây dựng một hệ thống tester tự động có thể đăng nhập Minecraft như người chơi thật, thực hiện hành trình có kiểm chứng, thu thập bằng chứng, chạy theo lịch và phát hiện hồi quy của server/plugin mà không gây tác động ngoài phạm vi được cấp phép.

**Kiến trúc đề xuất:** Tách BotChecker thành một sản phẩm độc lập dùng Mineflayer làm protocol client; scenario deterministic là nguồn hành động được kiểm soát; một scheduler/queue điều phối run; report store lưu bằng chứng bất biến; health/alert adapter chỉ báo cáo sau khi run hoàn tất. Không dùng Citizens NPC gameplay để thay thế protocol client vì Citizens entity không kiểm tra được nhiều logic chỉ áp dụng cho real player.

**Phạm vi ban đầu:** Server test/isolated được cấp phép, một test account riêng, các journey có cấu hình rõ ràng. Không deploy/restart server, không dùng staff account, không gửi credential vào scenario/report/log.

---

## 1. Bằng chứng hiện trạng

- Sản phẩm chính trong repo standalone: `E:\AI.WORK\botcheckerminecraft-botchecker`.
- Bản clone đang lẫn source LivingNPC và BotChecker tại `E:\AI.WORK\botcheckerminecraft`; không dùng làm workspace triển khai đầu tiên để tránh chỉnh nhầm boundary.
- BotChecker hiện có `mineflayer`, `mineflayer-pathfinder`, Fastify và Zod.
- `src/runner.ts` đã hỗ trợ connect, walk/teleport, chat, GUI inspection, click có revalidation, NPC interaction, fishing, planting, inventory/position assertion, timeline và report JSON.
- `src/server.ts` hiện chỉ có API chạy thủ công `POST /api/runs`; chưa có scheduler, queue giới hạn, retry policy, lock chống chạy đè, retention, alert hay persistent run index.
- `scenarios/npc-quest.json` vẫn là template với `NPC_NAME_HERE`, tọa độ `0,64,0` và `QUEST_ITEM_TEXT_HERE`; chưa thể coi là scenario production-calibrated.
- Test hiện tại chủ yếu kiểm tra Zod schema và helper snapshot; chưa có test cho lifecycle run, timeout cleanup, concurrency, persistence, API error, scheduler, retry, report integrity hoặc server integration.
- `npm run typecheck`, `npm test`, `npm run build` đã chạy pass ở cả bản clone và standalone; đây chỉ chứng minh compile/unit baseline, chưa chứng minh kết nối Minecraft hoặc end-to-end.

## 2. Vấn đề cần giải quyết

### P0 – Độ tin cậy và an toàn

1. **Không có queue/concurrency control:** gọi nhiều `POST /api/runs` sẽ tạo nhiều Mineflayer client cùng account; server có thể kick, test đè state, hoặc làm sai kết quả.
2. **Không có scheduler bền vững:** process restart là mất lịch và run đang theo dõi; chưa có trạng thái queued/running được lưu lâu dài.
3. **Timeout chưa đảm bảo lifecycle sạch:** `withTimeout` reject nhưng promise scenario có thể tiếp tục chạy; cần cancellation token/abort và chờ disconnect trước khi kết thúc.
4. **Khả năng chạy sai server/account:** cấu hình hiện lấy environment đơn giản, chưa có startup validation, server identity check, allowlist và test account policy.
5. **API private nhưng chưa có authentication/rate limit:** bind localhost mặc định là tốt, nhưng nếu đổi host sẽ có nguy cơ người khác gửi command Minecraft.
6. **Report chưa có schema/version/metadata đầy đủ:** thiếu server version, plugin versions, scenario revision, config fingerprint, exit reason và phân loại lỗi để so sánh các lần chạy.

### P1 – Chất lượng kiểm thử

7. **Scenario chỉ deterministic tuyến tính:** chưa có setup/teardown, điều kiện branching, optional assertion có severity, retry từng bước, cleanup sau test.
8. **Hành vi “như người thật” mới một phần:** có walk, look, delay và inspect GUI nhưng timing/path/action còn dễ đoán; cần realism có kiểm soát, không biến thành random khó tái hiện.
9. **Entity selector có thể nhầm:** name/UUID/entity type chưa có yêu cầu uniqueness, khoảng cách/visibility/line-of-sight hoặc xác nhận entity ổn định trước interaction.
10. **GUI assertion chưa đủ ngữ nghĩa:** có đọc item/lore nhưng chưa có assertion title, slot, count, component, transition và kết quả sau click chuẩn hóa.
11. **Chưa có visual testing:** Mineflayer không thấy resource-pack render, font, texture, layout; cần xác định visual scope riêng, không tuyên bố protocol test là visual test.
12. **Plugin-specific mechanics chưa được adapter hóa:** fishing minigame, custom GUI click mode, hologram NPC, anti-bot/login plugin cần capability detection và action riêng.
13. **Không có evidence khi connect/path fail:** cần snapshot state, event timeline, position, last GUI, disconnect reason và bounded diagnostic để phân biệt server bug với tester bug.

### P2 – Vận hành

14. **Không có baseline/regression comparison:** chưa so sánh pass rate, latency, step duration, kick/death, GUI diff giữa các run.
15. **Không có cảnh báo hoặc báo cáo định kỳ:** chưa có Discord/Telegram/webhook adapter và cơ chế chống alert storm.
16. **Không có retention/cleanup:** report JSON sẽ tăng vô hạn.
17. **Có hai workspace/repo dễ sửa nhầm:** cần chốt standalone repo là nguồn triển khai BotChecker; clone lẫn LivingNPC chỉ read-only tham khảo.

## 3. Giải pháp theo tầng

### Tầng A – Core run engine

- Tạo `RunController` với state machine rõ: queued → connecting → running → stopping → passed/failed/cancelled.
- Dùng cancellation token nội bộ cho timeout/cancel; mọi poll, travel, wait và step phải dừng theo token.
- Tách `BotSession` khỏi `TestRun` để quản lý connect, disconnect, event listeners và cleanup đúng một lần.
- Mỗi run có `runId`, `scenarioId`, scenario hash, start/end, server identity, tester identity không chứa secret, step results và failure classification.
- Bắt buộc teardown: stop listeners, cancel pathfinder, đóng GUI nếu được, quit bot, chờ end/kick/error bounded.

### Tầng B – Scenario engine có kiểm chứng

- Giữ deterministic làm mặc định; thêm `setup`, `steps`, `teardown` và `finally` semantics.
- Mỗi step có timeout, retry bounded, optional/severity, precondition và postcondition.
- Chuẩn hóa assertion: text, title, GUI item/lore/material/count/component, inventory delta, position tolerance, entity identity.
- Selector NPC phải validate uniqueness; nếu nhiều entity match thì fail-closed thay vì chọn entity gần nhất âm thầm.
- Mọi hành động phá hoại hoặc command phải có policy allowlist; test scenario không được tùy ý gửi command.

### Tầng C – Queue và scheduler

- Một account chỉ chạy một session tại một thời điểm; queue có max pending và backpressure.
- Job model: `manual`, `scheduled`, `retry`; có idempotency key.
- Scheduler hỗ trợ interval/cron nhưng không chạy khi process không healthy hoặc server lock chưa nhả.
- Retry chỉ áp dụng lỗi transient (connect timeout, temporary kick nếu policy cho phép); không retry assertion failure và gameplay mutation không idempotent.
- Có cooldown giữa run, max attempts, jitter có seed để vừa giống người vừa tái hiện được.
- Persistent store ban đầu có thể JSON/SQLite; ưu tiên SQLite nếu cần restart recovery và query lịch sử.

### Tầng D – Evidence và triage

- Report schema versioned, atomic write, checksum hoặc immutable run record.
- Chuẩn hóa lỗi: `AUTH`, `CONNECT`, `KICK`, `TIMEOUT`, `PATHFINDING`, `ENTITY_NOT_FOUND`, `GUI_CHANGED`, `ASSERTION`, `SERVER_ERROR`, `TESTER_ERROR`.
- Lưu timeline bounded nhưng giữ evidence bắt buộc khi fail.
- Có report summary và diff với baseline: pass/fail, p50/p95 duration, first failing step, changed GUI/text.
- Không log password/token; redact URLs có query secret và nội dung nhạy cảm.

### Tầng E – Vận hành

- Health endpoint có trạng thái queue, active run, last success/failure và server reachability; không leak config secret.
- API auth token cho non-localhost, request size/rate limit, allowlist scenario.
- Retention theo số ngày/số report và disk budget.
- Webhook notifier với dedupe theo scenario + failure signature + cooldown.
- CLI wrapper cho `list`, `run`, `cancel`, `report`, `doctor` để không phụ thuộc curl.

## 4. Lộ trình thực hiện theo vertical slices

### Slice 1 – Chốt boundary và baseline

- Chỉ làm trên `botcheckerminecraft-botchecker`.
- Thêm/đồng bộ `CURRENT_STATE.md`, inventory repo, test commands.
- Chạy baseline đã biết và ghi rõ giới hạn: chưa kết nối server.
- Không đụng `living-npc-plugin` hay production.

### Slice 2 – Lifecycle an toàn

- Viết test đỏ cho timeout/cancel không để step tiếp tục và cleanup chỉ một lần.
- Implement `BotSession`/cancellation tối thiểu.
- Test lifecycle bằng fake transport/session; sau đó chạy full suite.

### Slice 3 – Queue một account

- Test đỏ: hai run không được cùng connect; pending overflow trả lỗi rõ; cancel queued không tạo bot.
- Implement FIFO queue, active slot per account, bounded pending.
- API trả trạng thái queue chính xác.

### Slice 4 – Scenario pre/postcondition

- Test đỏ cho setup/teardown, retry classification, selector ambiguity và GUI assertion.
- Implement schema + engine từng hành vi, không viết một horizontal mega-feature.

### Slice 5 – Persistent scheduler

- Chọn SQLite sau khi test dữ liệu cần query; migration/schema version ngay từ đầu.
- Test restart recovery, duplicate prevention, missed schedule và retention.
- Chỉ scheduler local trước; chưa gửi notification.

### Slice 6 – Calibrate trên server isolated

- Thu thập server version, plugin/dependency versions, exact NPC UUID/name, coordinates, GUI title/items, expected transitions.
- Chạy từng scenario thủ công một lần, lưu report path và evidence.
- Chạy lặp tối thiểu nhiều vòng để phân biệt lỗi flaky với lỗi deterministic.
- Không dùng production account; không restart/deploy server.

### Slice 7 – Regression/alert/reporting

- Baseline comparison, severity, dedupe, webhook adapter tùy cấu hình.
- Test notifier bằng fake endpoint; không gửi thật khi chưa được phê duyệt.
- Dashboard/CLI chỉ sau khi dữ liệu run ổn định.

### Slice 8 – Release gate

- Unit + integration + protocol smoke trên server test.
- Kiểm tra security: bind, auth, scenario allowlist, secret redaction.
- Soak test bounded, đo RAM/file growth/session cleanup.
- Chỉ đóng gói artifact sau khi tất cả gate pass; không tự deploy production.

## 5. Test strategy

- Unit: schema, state machine, retry classification, selector, assertion, redaction, report migration.
- Component: queue + fake BotSession; API + in-memory/persistent store.
- Integration: Mineflayer client với test server thực, NPC/GUI thật, resource-pack policy.
- Regression: scenario fixture cố định với expected report signature.
- Reliability: connect timeout, kick, server restart giả lập, GUI đổi giữa inspect/click, entity despawn, path stuck, duplicate requests.
- Soak: chạy chuỗi run có cooldown, xác nhận không tăng listener/bot/socket/report bất thường.
- Visual: tách thành phase riêng bằng client/render capture; không gắn nhãn đạt visual nếu chỉ có protocol evidence.

Lệnh verification chuẩn của standalone repo:

```text
npm run typecheck
npm test
npm run build
```

Khi có server test được cấp phép mới thêm protocol smoke command và ghi server/report evidence cụ thể.

## 6. Tiêu chí sản phẩm đạt

- Không chạy đồng thời hai bot trên cùng test account.
- Timeout/cancel luôn cleanup bounded và không để action hậu kỳ chạy ngầm.
- Một run có report đầy đủ, versioned, có thể truy nguyên từ scenario/config/server.
- Scenario fail-closed khi NPC mơ hồ, GUI đổi hoặc precondition không đạt.
- Scheduler restart-safe, retry có phân loại và không lặp mutation nguy hiểm.
- Có thể chứng minh bằng test và report thật: bot join, walk, interact, inspect GUI, click, assert kết quả.
- Có cảnh báo rõ nhưng không spam; có retention và bảo vệ API.
- Không tuyên bố kiểm tra được những thứ Mineflayer không quan sát được.

## 7. Rủi ro và quyết định cần giữ nguyên

- Không dùng LLM để quyết định click/pathfinding ở bản đầu; LLM chỉ có thể hỗ trợ phân loại/summarize sau khi evidence đã được thu thập.
- Không dùng Citizens NPC gameplay làm substitute cho real player protocol tester.
- Không chạy auto-check trên production khi chưa có approval và maintenance window.
- Không trộn source BotChecker với LivingNPC; cross-project integration chỉ read-only cho đến khi có phiên bản và server matrix cụ thể.
- Không thêm random thuần túy; mọi randomness phải bounded, có seed và được ghi trong report nếu ảnh hưởng kết quả.

**Trạng thái:** Đây là kế hoạch nghiên cứu/triển khai, chưa sửa source production. Bước tiếp theo hợp lý là Slice 1–2 trên standalone repo, viết test đỏ cho lifecycle trước khi thêm scheduler hoặc “human-like” behavior.
