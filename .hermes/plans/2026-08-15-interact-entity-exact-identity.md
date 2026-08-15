# Kế hoạch harden exact identity cho `interact_entity`

Ngày: 2026-08-15
Phạm vi: chỉ BotChecker local; không kết nối Minecraft, không mở API listener, không deploy/reload/restart hay tương tác server.

## Vấn đề và root cause

`assert_nearby_entity` có thể khóa `requiredUuid`, nhưng `interact_entity` hiện tự chọn lại bằng `nearestEntity(nameIncludes, maxDistance)`. Vì vậy một identity-only gate đã PASS không bảo đảm entity được right-click là cùng NPC; player/NPC trùng tên hoặc entity thay thế trong lúc `goto`/`lookAt` có thể bị chọn hoặc tương tác nhầm.

Pattern an toàn hiện hữu là `pinUniqueEntity` + `validateUniquePinnedEntity`: name + UUID + range + uniqueness, đồng thời phát hiện disappearance, UUID change và object replacement.

## Contract đích

1. `interact_entity.requiredUuid` là UUID bắt buộc cho scenario interaction được harden; schema trim và validate UUID.
2. Lookup ban đầu phải pin duy nhất entity khớp tên + exact UUID trong bound; không fallback nearest cùng tên.
3. Giữ nguyên object/ID/UUID đã pin qua pathfinding.
4. Revalidate toàn bộ set entity, observer range, name, exact UUID, uniqueness và object identity:
   - sau pathfinding, trước `lookAt`;
   - sau `lookAt`, ngay trước `activateEntity`.
5. Mọi identity/tracking failure phải fail closed và tuyệt đối không gọi `activateEntity`.
6. Evidence thành công phải ghi exact UUID đã tương tác.
7. Fixture `citizens-thanhredfield-player-journey.json` phải truyền cùng UUID đã dùng ở identity gate.
8. Không chạy live interaction trong slice này.

## Các bước TDD

### 1. Schema RED → GREEN

- Thêm test chấp nhận UUID hợp lệ và trim input cho `interact_entity`.
- Thêm test từ chối UUID sai.
- Thêm `requiredUuid` vào schema action.
- Chạy focused `test/scenario.test.ts`.

### 2. Selection RED → GREEN

- Component test với hai entity cùng tên: wrong UUID gần hơn/đứng trước và exact UUID mục tiêu.
- Xác minh chỉ exact UUID được `lookAt`/`activateEntity`, evidence chứa UUID.
- Test chỉ có same-name wrong UUID: `INCONCLUSIVE_IDENTITY`, không activate.
- Thay `nearestEntity` bằng `pinUniqueEntity(..., true, requiredUuid)`.

### 3. Revalidation RED → GREEN

- Dùng controllable promises ở `pathfinder.goto` và `lookAt` để thay đổi entity stream đúng race window.
- Bao phủ tối thiểu:
  - target biến mất trong lúc tiếp cận;
  - object cùng ID/UUID bị thay thế;
  - UUID đổi trước activation;
  - ambiguity exact identity xuất hiện;
  - thay đổi xảy ra trong `lookAt`, ngay trước activation.
- Gọi `validateUniquePinnedEntity` ở cả hai điểm; chỉ activate object đã pin nếu cả hai lần hợp lệ.

### 4. Fixture và tài liệu

- Thêm `requiredUuid: 46a5553d-cedc-428f-b51a-4f5ddec03c9b` cho bước `interact_entity` trong player journey.
- Thêm regression fixture/schema để không thể bỏ khóa UUID khỏi journey này.
- Cập nhật `CURRENT_STATE.md`: implementation local đã xác minh, interaction live vẫn chưa được chạy/phê duyệt.

### 5. Verification

Theo thứ tự:

1. Focused schema test.
2. Focused runner interaction tests.
3. `npm run typecheck`.
4. `npm test`.
5. `npm run build`.
6. `git diff --check` và kiểm tra newline/trailing whitespace các file liên quan.

## Tiêu chí hoàn thành

- RED được quan sát trước mỗi implementation slice.
- Exact UUID và uniqueness được kiểm tra tại selection và ngay trước side effect.
- Không có failure path identity/tracking nào gọi `activateEntity`.
- Focused + full local gates pass.
- Không có hoạt động live/server trong quá trình triển khai.

## Kết quả triển khai

- Hoàn tất RED → GREEN cho schema, exact selection, fail-closed wrong UUID, revalidation sau travel và ngay trước activation, evidence UUID, cùng fixture guard.
- Focused gate pass 10/10.
- Final local verification pass: `npm test` đạt 92 pass, 0 fail và 2 intentional Windows signal skips; typecheck, build và full-worktree `git diff --check` đều pass.
- Năm `observe_crossing` failure từng xuất hiện trong một lượt chạy trung gian không còn tái hiện ở focused crossing/schema/runner reruns hoặc full suite cuối. Geometry fixture hiện thỏa strict contract center ±1 block; không có thay đổi crossing thiếu căn cứ trong lát interaction này.
- Không thực hiện kết nối hay side effect server/live.
