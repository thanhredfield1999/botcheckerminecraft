# LivingNPC route oracle độc lập

Ngày: 2026-08-20
Trạng thái: implemented, unit/typecheck verified; Paper runtime NOT VERIFIED.

## Contract

BotChecker không đọc LivingNPC telemetry, phase, `GOING_TO_PLOT`, Citizens `NavigationCompleteEvent` hoặc `GateRoute` để quyết định pass.

Route pass khi entity được pin bằng UUID và quan sát liên tục:

`A → B → C`

- Chạm checkpoint A trước.
- Chạm checkpoint B sau A.
- Chạm checkpoint C sau B.
- Bỏ qua B rồi xuất hiện ở C là fail.
- Bước nhảy quá `maxStepDistance` là discontinuity, không pass.
- Tọa độ A/B/C do fixture scenario cung cấp.
- Fence blocks được kiểm từ Mineflayer client block cache. Fence evidence thiếu/sai là `INCONCLUSIVE_FIXTURE` khi `requireFenceEvidence=true`.

## Gate tại B

Nếu B có gate:

1. BotChecker đọc gate block tại B.
2. Gate phải có state open trong lúc crossing.
3. Entity phải có mẫu liên tục ở phía approach.
4. Entity phải cắt signed plane qua aperture/corridor.
5. Entity phải có exit samples và dwell theo config.
6. Chỉ sau crossing B hoàn tất mới route oracle cho phép C hoàn tất.

Gate open state chỉ là evidence phụ trợ; không tự biến thành crossing pass.

## Code

- `src/route-oracle.ts`: pure route state machine + fence matcher.
- `src/runner.ts`: action `observe_route`, pin UUID, đọc block cache, poll entity movement, ghi bounded evidence.
- `src/crossing.ts`: signed-plane crossing primitive.
- `src/scenario.ts`: strict schema cho checkpoints, fences, gates, threshold.
- `test/route-oracle.test.ts`: route pass, A→C shortcut reject, discontinuity reject, fence-gate distinction.

## Fence geometry fixture cần có

Fixture phải dựng fence chặn shortcut A→C, nhưng mở hành lang A→B→C. Không dùng “NPC phase” để chứng minh fence. BotChecker chỉ pass route sau khi trajectory chứng minh thứ tự; fence evidence chứng minh obstacle tồn tại tại các tọa độ đã cấu hình.

Cần ghi trong scenario:

- `checkpoints`: A, B, C, mỗi point có radius.
- `fences`: từng block fence và expected material.
- `gates`: gate checkpoint B (nếu có), block, approach, exit và thresholds.
- `targetUuid`, world/dimension, max step, sample interval.

## Giới hạn hiện tại

`observe_route` đã nối vào runner nhưng chưa có scenario runtime với tọa độ A/B/C đã kiểm chứng trên clean Paper fixture. Không tự điền tọa độ bằng suy đoán. Cần fixture preparation riêng, manifest JAR/hash và WorldGuard/WorldEdit chạy được dưới Java 21.

## Verification

- `node --import tsx --test test/route-oracle.test.ts`: 4 pass.
- `npm run typecheck`: pass.
- Full BotChecker suite sau khi runner integration: cần chạy tiếp.
- Paper route: `NOT VERIFIED`.

## Nguồn route bên LivingNPC

LivingNPC `GateRoute` có internal legs `STAGING → APPROACH → EXIT → FINAL`; Citizens navigator nhận target location và active parameters. Đây chỉ là implementation context. BotChecker verdict vẫn dựa entity movement + block geometry độc lập.

Production: `UNCHANGED`.
