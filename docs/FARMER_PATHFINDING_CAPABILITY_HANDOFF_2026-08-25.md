# BotChecker capability handoff: LivingNPC Farmer/pathfinding

Ngày: 2026-08-25

## Kết luận

`VERIFIED — LOCAL CAPABILITY`, `NOT VERIFIED — CURRENT CONTROLLED PAPER`.

BotChecker đủ primitive để **nhận kiểm chứng** Farmer/pathfinding theo black-box:

- pin Citizens entity bằng exact UUID và giữ identity/object xuyên suốt trajectory;
- `observe_route` kiểm thứ tự checkpoint, continuity, shortcut/backtrack, gate order;
- đọc fence/gate từ Mineflayer block cache, không dùng LivingNPC phase làm route PASS;
- signed-plane gate crossing yêu cầu entry, aperture, exit samples và dwell;
- telemetry parser nhận identity, role, precise position, target, navigation/path, obstacle/probes, semantic point;
- report/pixel-map bounded và sanitized.

BotChecker chưa tự tạo/khởi động controlled Paper fixture, không deploy LivingNPC và không tự sửa server.

## Source evidence đã đọc

BotChecker:

- `src/scenario.ts`: strict `observe_route` schema, exact UUID, bounded checkpoints/fences/gates/sampling.
- `src/runner.ts`: entity pin/revalidation, block-cache fence/gate observation, `RouteOracle`, bounded 512 observations.
- `src/route-oracle.ts`, `src/crossing.ts`: ordered route và continuous aperture proof.
- `src/livingnpc-telemetry.ts`: strict schema, timeline adapter và fail-closed diagnostic evidence.
- `test/fixtures/livingnpc-telemetry-snapshot.json`: Farmer identity/navigation/probe fixture.

LivingNPC read-only references:

- `src/main/java/vn/heomc/livingnpc/NpcTelemetryCollector.java`: producer hiện có identity, precise position, target, navigation, path, probes và semantic point.
- `docs/evidence/2026-08-24-controlled-farmer-gate-journey.json`.
- `docs/evidence/2026-08-25-controlled-794b-pregate-failclosed-and-full-journey.json`.

## Local validation mới

Files:

- `scenarios/livingnpc-farmer-pathfinding-readonly.json`
- `test/farmer-pathfinding-capability.test.ts`
- `scripts/validate-farmer-pathfinding-capability.mjs`

Scenario dùng UUID/tọa độ fixture từ controlled evidence lịch sử, chỉ có authorization read-only. Không dùng scenario này cho production hoặc fixture khác khi chưa xác nhận lại identity/geometry.

Regression chứng minh:

1. Scenario parse strict.
2. Exact Farmer UUID bắt buộc.
3. Synthetic replay liên tục đi `P0 -> STAGING -> A -> B -> C -> FINAL` và gate crossing hợp lệ thì PASS.
4. Bước nhảy `P0 -> FINAL` bị reject bởi discontinuity/shortcut.
5. Telemetry fixture có Farmer identity và navigation evidence.

Artifact ignored bởi Git:

- `reports/local-farmer-pathfinding-capability.json`
- Verdict: `PASS`.
- Evidence level: `LOCAL_REPLAY_VERIFIED_NOT_PAPER_RUNTIME`.
- Chỉ lưu SHA-256/checks/counts; không embed raw telemetry, credential hoặc authorization payload.

## Commands và kết quả

Focused:

```text
npm run typecheck
node --import tsx --test test/farmer-pathfinding-capability.test.ts test/route-oracle.test.ts test/livingnpc-telemetry.test.ts
```

Kết quả: `18 pass, 0 fail`.

Full:

```text
node --import tsx scripts/validate-farmer-pathfinding-capability.mjs
npm run typecheck
npm test
npm run build
git diff --check
```

Kết quả: local capability artifact `PASS`; full suite `286 pass, 0 fail, 2 intentional Windows signal skips`; typecheck/build/diff check pass.

## Evidence boundary

- `OBSERVED`: source/test wiring và fixture fields hiện có.
- `VERIFIED`: local replay, schema, oracle, telemetry parser và bounded artifact.
- `INFERRED`: BotChecker có thể nhận current Farmer run nếu isolated fixture cung cấp đúng entity/block stream.
- `NOT VERIFIED`: exact current LivingNPC JAR trên controlled Paper, arbitrary terrain, unloaded chunks, multi-NPC FIFO, restart và performance.
- Production: `UNCHANGED`; không connect/start/stop/deploy/reload.

## Controlled Paper acceptance đề xuất

Một run có thể PASS chỉ khi cùng execution window chứng minh:

1. Exact artifact/JAR SHA-256, Paper/Citizens versions và isolated fixture manifest.
2. Dedicated authorized observer account trong tracking range; không teleport/command.
3. Exact Farmer UUID duy nhất; entity không disappear/replace/duplicate.
4. Client trajectory liên tục qua toàn bộ configured checkpoints.
5. Owned gate open trong aperture crossing; unowned gates không mở/bị target bypass.
6. Không discontinuity, shortcut, backtrack, wall/fence crossing hoặc fixture pairing mismatch.
7. Server telemetry bổ sung diagnostic state/path/cancel reason; không dùng telemetry phase thay route oracle PASS.
8. Cleanup: observer disconnect, process/port của fixture đóng nếu fixture được start theo approval, durable data hash kiểm tra.

## User intervention cần thiết

Để chuyển từ local capability sang controlled Paper verification, cần user xác nhận:

- isolated disposable server root/port được phép dùng;
- exact LivingNPC candidate JAR hash;
- Paper/Citizens/WorldGuard versions;
- dedicated test account/provider và quyền read-only;
- Farmer UUID/name và fixture coordinates đã chuẩn bị;
- approval riêng nếu cần start/stop controlled server.

Không cần user intervention cho local replay đã hoàn tất.

## Next action

Khi đủ controlled fixture/authorization, copy scenario thành fixture-specific scenario mới, xác nhận lại UUID/coordinates/materials từ manifest rồi chạy observer. Không sửa scenario hiện tại để khớp production bằng suy đoán.
