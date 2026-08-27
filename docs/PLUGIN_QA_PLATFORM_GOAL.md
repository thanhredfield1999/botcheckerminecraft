# Goal: BotChecker Black-box QA Platform

## Mục tiêu

Biến `E:\AI.WORK\botcheckerminecraft-botchecker` thành nền tảng black-box QA đa dự án cho plugin Minecraft.

## Phạm vi kiểm thử

- Gameplay end-to-end
- GUI và inventory interaction
- Permission matrix
- Persistence/restart
- Transaction/economy
- Negative/security
- Multi-client/multi-account
- Crash/recovery
- Compatibility giữa Minecraft/Paper/plugin versions

## Acceptance contract

Mọi test run phải:

- Chỉ quan sát hành vi từ client/server black-box.
- Có evidence bounded, sanitized và reproducible.
- Trả đúng verdict `PASS | FAIL | INCONCLUSIVE`.
- Phân biệt plugin bug với fixture, handshake, protocol, provider hoặc infrastructure failure.
- Fail-closed khi thiếu authorization, observation, evidence hoặc identity.
- Không ghi credential, raw authorization, raw payload hoặc sensitive data.

## Safety boundary

- Chỉ chạy trên server/account được ủy quyền.
- Không sửa plugin mục tiêu.
- Không tự cấp permission.
- Không tự đọc hoặc tạo credential.
- Không tự deploy, restart hoặc sửa production.
- Persistence restart do external authorized provider thực hiện và cung cấp evidence.
- Multi-account chạy tuần tự, `maxConcurrent = 1`.
- Không teleport, force-load chunk hoặc nới assertion để tạo PASS giả.

## Phase order

1. Persistence/restart: before snapshot, external restart evidence, after snapshot, state comparison, execution linkage, report.
2. Permission matrix: allow/deny, state invariant, multi-account plan, sequential provider execution, report.
3. Negative/security: reject, no-mutation, unauthorized action, malformed/boundary input, sensitive payload rejection.
4. Transaction/economy: balance/item delta, reject/no-mutation, idempotency, report/provider boundary.
5. Compatibility matrix.
6. Crash/recovery.
7. Multi-client gameplay and GUI expansion.

## Implementation rules

- Tách pure contract/evaluator khỏi live provider.
- Provider do caller cấp; không hardcode server/account control.
- Scenario, plan, runner, evaluator và report schema tái sử dụng đa project.
- Không claim live PASS/FAIL nếu chỉ có offline verification.
- Mỗi slice phải đọc source/test trước, viết regression test trước production code, chạy focused test rồi full gate.
- Sau mỗi slice cập nhật `CURRENT_STATE.md` và tài liệu phase với evidence thật.

## Required verification

```text
npm run typecheck
npm test
npm run build
git diff --check
```

## Current status

- Offline contracts đã có cho persistence, permission, negative/security, compatibility và transaction/economy.
- Chưa có live authorized account provider, isolated fixture hoặc external restart provider.
- Full gate gần nhất sau transaction contract: `241 pass, 0 fail, 2 intentional Windows signal skips`.
- Không có live deployment/restart/production verification.

## Next concrete step

Đã tạo transaction/economy report bounded, nối `transactionResult` vào `RunManifest`, thêm provider boundary `transaction-runner.ts`, idempotency evaluator `transaction-idempotency.ts`, crash/recovery contract + report + provider boundary và nối `crashRecoveryResult` vào `RunManifest`; GUI/inventory, gameplay journey và multi-client contracts đã có. Đã tạo/nối report cho GUI, gameplay và multi-client vào `RunManifest`, thêm `gui-runner.ts`, `gameplay-runner.ts`, `multi-client-runner.ts` và `compatibility-runner.ts` làm provider boundaries tuần tự. Next là live provider/fixture khi được ủy quyền.

## Verdict discipline

- Offline contract verification: chỉ claim code/test PASS.
- Live plugin behavior: `INCONCLUSIVE` nếu chưa có fixture/provider/evidence thật.
- Không chuyển blocker infrastructure thành plugin FAIL.

## Maintenance

Cập nhật file này khi thay đổi scope, phase order, acceptance contract hoặc safety boundary. Ghi current evidence chi tiết ở `CURRENT_STATE.md`.

Chủ động không đồng nghĩa với tự vận hành production: mọi live server/account/deploy/restart action vẫn cần authorization rõ ràng.

Nếu thay đổi code chưa được commit, phải giữ nguyên thay đổi ngoài scope và không tự commit/push.

## Owner handoff

Goal này là nguồn giao việc cấp dự án. Trạng thái thực thi hiện tại xem ở `CURRENT_STATE.md` và `.hermes/WORKING_STATE.md`.

Bắt đầu từ Phase 1, tiếp tục từng slice nhỏ cho tới khi hoàn tất offline contract hoặc bị block bởi thiếu provider/fixture được ủy quyền.

## Completion condition

Goal chỉ được coi là hoàn tất khi:

- Tất cả phạm vi kiểm thử có contract, runner/provider boundary, report và regression tests.
- Có controlled live verification trên authorized isolated fixtures.
- Có evidence và verdict cho từng capability.
- Không còn blocker chưa được ghi rõ.
- Full verification pass và trạng thái production được phân biệt với trạng thái offline.

Không được tuyên bố hoàn tất chỉ dựa trên unit tests.

## Change log

- Tạo goal document để làm nguồn giao việc cấp dự án.
- Transaction/economy contract đã hoàn tất offline; report linkage là slice đang thực hiện tiếp theo.

## Explicit non-goals

- Không điều khiển production tự động.
- Không lưu secrets.
- Không thay plugin để làm test pass.
- Không giả lập live evidence rồi báo là runtime evidence.
- Không mở concurrency multi-account để rút ngắn thời gian nếu làm nhiễu state.

## Reporting format

Mỗi phase report phải nêu rõ:

- Implemented
- Verified
- Inconclusive
- Blocked
- Next Step

Mọi số liệu test phải lấy từ command output thật, không tự suy diễn.

## Project location

`E:\AI.WORK\botcheckerminecraft-botchecker`

## Branch policy

Làm việc trên working tree hiện tại, không tự commit, push, reset hoặc xóa thay đổi của người dùng.

## Runtime policy

Paper/Minecraft/plugin compatibility chỉ được kết luận bằng observed runtime evidence từ target được ủy quyền. Config hoặc unit test không thay thế runtime evidence.

## Data policy

Evidence phải bounded, sanitized, không chứa credential-like strings, authorization raw values, raw request payload hoặc private player data.

## Recovery policy

Crash/recovery test cần external process/server evidence; BotChecker chỉ ghi nhận và đánh giá evidence, không tự restart production.

## Review policy

Mọi defect đã xác nhận cần reproduction evidence, RCA, regression test, minimal fix và verification record trong repo.

## Handoff rule

Nếu thiếu input live, tiếp tục xây offline contract có giá trị; khi không thể tiến thêm mà không có provider/fixture, ghi rõ blocker và dừng live action.

## Current execution instruction

Tiếp tục ngay từ transaction/economy report linkage, không quay lại thay đổi các contract đã verified nếu không có regression evidence.

## Goal status

`IN_PROGRESS` — offline foundation đang được xây dựng; live verification chưa bắt đầu.

## Last verified boundary

Transaction contract: expected complete/reject, balance delta, item delta, no-mutation rejection, missing evidence and bounded sensitive evidence.

## Do not overclaim

`PASS` của evaluator chỉ chứng minh input observation thỏa contract; không chứng minh plugin/economy runtime ngoài fixture/provider đã chạy.

## Next report must include

Changed files, focused test result, full verification result, remaining live blockers và verdict boundary.

## End

Tiếp tục thực hiện từng slice nhỏ, có test trước và evidence thật.

## Scope guard

Nếu task mới không liên quan goal này, xác nhận scope trước khi thay đổi file trong repo.

## User language

Trao đổi và tài liệu dự án bằng tiếng Việt; giữ nguyên tên API, symbol, command và path.

## No production claim

Chưa có deployment hoặc production verification trong goal này.

## No credential handling

Không yêu cầu user gửi password/token/API key vào chat hoặc repo.

## Status authority

Source/tests hiện tại là source of truth kỹ thuật; `CURRENT_STATE.md` là trạng thái vận hành; file này là goal/scope.

## Goal acceptance

Goal acceptance cần review riêng sau khi live fixture/provider được cấp và evidence đã được kiểm tra.

## Immediate action

Implement `transaction-report` bằng TDD, sau đó nối vào `RunManifest` và chạy required verification.

## End of goal document

`IN_PROGRESS`
