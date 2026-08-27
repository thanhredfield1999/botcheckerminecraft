# Plugin QA Platform — Phase 1

## Goal

Biến BotChecker thành nền tảng black-box QA đa dự án cho plugin Minecraft. BotChecker chỉ dùng client-visible behavior, hoạt động trên server/account được ủy quyền, không sửa plugin và không tự deploy/restart production.

Mọi run phải tạo evidence bounded và verdict `PASS | FAIL | INCONCLUSIVE`.

## Phase 1 scope

1. Persistence/restart testing.
2. Permission matrix testing.
3. Negative/security testing fail-closed.

## Contract chung

Mỗi scenario cần khai báo:

- `project`: tên project/plugin đang kiểm thử.
- `fixture`: target fixture identifier, server version, dependency versions, world/dimension.
- `accountRole`: role/permission profile của account được cấp quyền.
- `authorization`: phạm vi hành động được phép, đặc biệt restart, command, payment và destructive action.
- `maxDurationMs` và timeout từng step.
- expected observable result.

Manifest phải ghi project, fixture, role, target và scenario hash; không ghi credentials.

## Persistence/restart

BotChecker không tự restart server. Restart là external lifecycle action do operator hoặc harness được ủy quyền thực hiện.

Thiết kế scenario theo hai run liên kết:

### Phase A — before restart

- tạo hoặc kích hoạt state bằng hành động được cấp quyền;
- ghi baseline observable state;
- ghi `persistenceKey` không chứa secret;
- kết thúc sạch;
- report `PASS` chỉ khi state baseline đã được quan sát đầy đủ.

### External restart boundary

- operator/harness kiểm tra đúng server fixture;
- restart theo quy trình riêng;
- ghi thời điểm và kết quả restart vào execution context;
- BotChecker không tự suy đoán restart thành công.

### Phase B — after restart

- kết nối fresh client;
- xác minh world/dimension/server version;
- đọc lại state bằng assertion read-only;
- so sánh baseline với observed state;
- thiếu fixture hoặc restart evidence trả `INCONCLUSIVE`, không trả `FAIL` cho plugin.

Không dùng username, password, token hoặc raw private payload làm persistence key/evidence.

## Permission matrix

Một test case chạy cùng action/expectation trên nhiều role profile:

- `unauthenticated`;
- `player`;
- `member`;
- `moderator`;
- `admin`.

Mỗi cell phải khai báo expected outcome:

- `allow`: action thành công và state mutation đúng;
- `deny`: action bị từ chối, state không đổi;
- `inconclusive`: fixture/identity/permission state không xác minh được.

Negative permission assertion phải kiểm tra cả response visible và invariant state sau thao tác. Không coi message riêng lẻ là bằng chứng đủ.

Multi-account permission matrix cần account profile riêng, không đổi role bằng command trong cùng run trừ khi scenario ghi rõ và được cấp quyền.

## Negative/security

Primitive ưu tiên:

- thiếu/sai argument;
- permission thiếu;
- entity sai UUID hoặc trùng tên;
- GUI đổi/đóng trước click;
- click selector mơ hồ;
- double submit/retry;
- disconnect giữa transaction;
- timeout giữa state transition;
- out-of-range hoặc chunk unavailable;
- reconnect sau kick/death/respawn.

Expected fail-closed behavior:

- không activation nếu identity không duy nhất;
- không click GUI đã đổi;
- không mutation khi assertion precondition fail;
- không trả `PASS` khi evidence thiếu;
- không retry vô hạn;
- không log credentials hoặc dữ liệu player riêng tư;
- bounded evidence, bounded candidates, bounded timeline.

## Verdict rules

- `PASS`: expected observable behavior và invariant đều được chứng minh.
- `FAIL`: fixture/authorization hợp lệ, hành vi plugin trái expectation hoặc invariant bị phá.
- `INCONCLUSIVE`: handshake, identity, fixture, restart boundary, tracking hoặc evidence không đủ để quy trách nhiệm plugin.

Một step optional vẫn không được che giấu lỗi sản phẩm; report phải giữ verdict step riêng.

## Boundary và safety gate

- Chỉ chạy target/account đã được ủy quyền.
- API giữ private/loopback.
- Không `/reload`, PlugMan, deploy hoặc restart production.
- Không tự sửa YAML/plugin/server để làm test pass.
- Không force-load chunk, không quét vô hạn, không load toàn world/entity không bounded.
- Live report phải giữ `runId`, target, scenario hash, fixture, account role và report path.

## Acceptance criteria cho implementation

- Scenario schema reject metadata thiếu cho phase có yêu cầu fixture/role.
- Report manifest giữ metadata phase 1 mà không chứa credential.
- Có test unit cho verdict rules và fail-closed negative cases.
- Có persistence contract test mô phỏng before/restart/after mà không cần Minecraft live.
- Có permission matrix test với ít nhất allow/deny/inconclusive.
- Full verification vẫn theo thứ tự:

```text
npm run typecheck
npm test
npm run build
```

## Current limitation

BotChecker hiện có single-account FIFO queue và chưa có lifecycle orchestration cho external restart hoặc multi-account matrix. Không claim persistence live, permission matrix live hoặc concurrency live cho tới khi các capability này được triển khai và chạy trên fixture được cấp quyền.

## Metadata foundation

Scenario metadata cho `project`, `fixture`, `accountRole`, `authorization` đã được truyền vào report manifest. Đây là nền móng để phân biệt plugin failure với fixture/authorization failure.

## Implemented offline contracts

Ba evaluator thuần đã được thêm, không tự kết nối Minecraft và không tự restart server:

- `src/persistence-contract.ts`: so sánh before/after snapshot qua restart evidence; giữ `PASS | FAIL | INCONCLUSIVE`; reject credential-like key/payload và payload vượt giới hạn.
- `src/permission-contract.ts`: đánh giá từng permission matrix cell; kiểm response allow/deny và state invariant.
- `src/negative-contract.ts`: đánh giá negative case; yêu cầu reject hoặc no-mutation, reject evidence thiếu và payload nhạy cảm.
- `src/negative-plan.ts`: kế hoạch negative/security nhiều account bounded; mỗi case khóa account/case ID và authorization; thiếu authorization là `INCONCLUSIVE`, mutation là `FAIL`.
- `src/permission-matrix.ts`: aggregate tối đa 64 permission cells, reject duplicate role/action và chọn verdict fail-closed.
- `src/permission-plan.ts`: kế hoạch permission nhiều account bounded; mỗi cell khóa `accountRef`, role/action và authorization; thiếu authorization là `INCONCLUSIVE`, credential-like account ref bị reject.
- `src/qa-execution.ts`: liên kết before/after run ID trong một persistence execution; reject credential-like IDs và đánh dấu cùng run là `INCONCLUSIVE`.
- `src/persistence-coordinator.ts`: state machine bounded `before → external restart evidence → after`; không điều khiển server, không tự restart; thiếu thứ tự/evidence trả `INCONCLUSIVE` hoặc reject fail-closed.
- `src/qa-plan-report.ts`: chuẩn hóa report evidence cho permission/negative-security plan; chỉ giữ verdict, summary, account refs, authorization count và mutation count bounded; không giữ authorization/raw payload.
- `src/multi-account-plan.ts`: tạo execution plan tuần tự tối đa 16 account; khóa order, role, authorization và `maxConcurrent = 1`; không chứa credential hoặc tự tạo client.
- `src/multi-account-runner.ts`: thực thi plan qua callback executor do caller cấp, tuần tự theo order; aggregate `PASS | FAIL | INCONCLUSIVE`, chặn execution khi thiếu authorization và sanitize evidence bounded.
- `src/authorized-plan-runner.ts`: chạy permission/negative plan tuần tự qua provider callback; provider failure là `INCONCLUSIVE`, thiếu authorization không gọi provider.
- `src/multi-account-report.ts`: chuyển multi-account runner result thành `qaPlan` report; giữ verdict từng account, summary và mutation count bounded; loại authorization/raw evidence.
- `TestRun` nhận `multiAccountResult` và chuyển qua `buildMultiAccountQaPlan` khi tạo manifest; kết quả runner không cần caller tự map lại.
- `src/persistence-report.ts`: chuyển `PersistenceExecutionResult` thành manifest persistence evidence bounded; giữ execution IDs, restart evidence ID và changed keys, loại raw state payload.
- `TestRun` nhận `persistenceResult`; manifest tự ghi persistence report mà không tự restart server.
- `src/persistence-runner.ts`: orchestration before → external authorized/observed restart callback → after; provider lỗi hoặc thiếu authorization trả `INCONCLUSIVE`, không tự điều khiển server.
- Persistence runner regression suite: 3 tests pass; callback order được kiểm chứng `before`, `restart`, `after`.

Regression tests:

- `test/persistence-contract.test.ts`
- `test/permission-contract.test.ts`
- `test/negative-contract.test.ts`
- `test/qa-execution.test.ts`
- `test/qa-manifest.test.ts`
- `test/persistence-coordinator.test.ts`
- `test/permission-plan.test.ts`
- `test/negative-plan.test.ts`
- `test/qa-plan-report.test.ts`
- `test/multi-account-plan.test.ts`
- `test/multi-account-runner.test.ts`
- `test/authorized-plan-runner.test.ts`
- `test/multi-account-report.test.ts`

- Evidence local mới nhất: full gate pass với `181` tests pass, `0` fail, `2` Windows signal skips có chủ đích. Đây là offline contract verification, chưa phải live server verification.
- Execution linkage local mới nhất: full gate pass với `191` tests pass, `0` fail, `2` Windows signal skips có chủ đích. Manifest giữ `executionId`, `beforeRunId`, `afterRunId`, `side`; không giữ credentials.

## Transaction/economy slice

- `src/transaction-contract.ts`: evaluator thuần cho giao dịch economy; kiểm tra expected complete/reject, balance delta, item delta, duplicate-safe rejection/no-mutation và bounded sanitized evidence.
- Verdict fail-closed: thiếu before/observed là `INCONCLUSIVE`; accepted/rejected sai hoặc delta sai là `FAIL`; dữ liệu hợp lệ là `PASS`.
- Contract không kết nối economy provider, không sửa balance/item và không tự thực thi giao dịch.
- Regression: `test/transaction-contract.test.ts`.
- `src/transaction-report.ts` và `TestRun` chuyển transaction evaluation vào `RunManifest.transaction`; chỉ giữ transaction ID, expected, accepted, deltas và message bounded, không giữ raw before/after state.
- Regression: `test/transaction-report.test.ts`.
- `src/transaction-runner.ts`: caller-provided `before` snapshot and transaction executor boundary; provider failure or validation failure returns `INCONCLUSIVE`, no economy/server control is embedded.
- Regression: `test/transaction-runner.test.ts`.
- `src/transaction-idempotency.ts`: kiểm tra duplicate submit cùng transaction ID; lần lặp không được tạo thêm balance/item delta; thiếu attempt evidence là `INCONCLUSIVE`, duplicate mutation là `FAIL`.
- Regression: `test/transaction-idempotency.test.ts`.

## Crash/recovery slice

- `src/crash-recovery-contract.ts`: evaluator bounded cho crash boundary được ủy quyền và recovery readiness evidence.
- Crash boundary thiếu authorization/observation hoặc recovery evidence thiếu: `INCONCLUSIVE`.
- Crash có evidence hợp lệ nhưng runtime không ready sau recovery: `FAIL`; crash và recovery ready đầy đủ: `PASS`.
- Contract không tự kill process, restart server hoặc điều khiển production.
- Regression: `test/crash-recovery-contract.test.ts`.

## Crash/recovery, GUI, gameplay and multi-client slices

- `src/crash-recovery-report.ts` + `src/crash-recovery-runner.ts`: bounded report và caller-provided crash/recovery provider boundary; provider failure là `INCONCLUSIVE`, không tự kill/restart.
- `src/gui-contract.ts`: GUI/inventory black-box evaluator cho title, slot/material, click button và observable item effect; thiếu observation là `INCONCLUSIVE`.
- `src/gameplay-contract.ts`: ordered gameplay journey evaluator; step fail/out-of-order là `FAIL`, thiếu step evidence là `INCONCLUSIVE`.
- `src/multi-client-contract.ts`: bounded multi-client aggregate; duplicate client ref reject, client fail là `FAIL`, skipped/empty evidence là `INCONCLUSIVE`, tối đa 16 client.
- Regression: `test/crash-recovery-report.test.ts`, `test/crash-recovery-runner.test.ts`, `test/gui-contract.test.ts`, `test/gameplay-contract.test.ts`, `test/multi-client-contract.test.ts`.
- Các slice chỉ là offline contract/evaluator; chưa có live client provider, fixture, deployment, restart hoặc production operation.
- Provider boundaries mới: `src/gui-runner.ts`, `src/gameplay-runner.ts`, `src/multi-client-runner.ts`, `src/compatibility-runner.ts`; caller cấp observation, runner không tự điều khiển server/account.

## Compatibility matrix slice

- `src/compatibility-matrix.ts`: bounded cross-target evaluator cho Minecraft/Paper/plugin compatibility; đối chiếu protocol, negotiated version, plugin presence và scenario result.
- Verdict fail-closed: target thiếu runtime evidence là `INCONCLUSIVE`; protocol/plugin/scenario mismatch là `FAIL`; mọi target hợp lệ là `PASS`.
- Không suy luận live compatibility từ config; evaluator chỉ nhận observed evidence do caller/provider cấp.
- Regression: `test/compatibility-matrix.test.ts`.
- `src/compatibility-report.ts` và `TestRun` chuyển matrix result vào `RunManifest.compatibility`; report chỉ giữ target metadata, verdict, summary và bounded evidence.
- Regression: `test/compatibility-report.test.ts`.

## Remaining phase 1 work

- Gắn evaluator vào scenario execution/report pipeline.
- Thêm execution context cho before/restart/after run liên kết.
- Thêm account profile và permission matrix runner; hiện queue chỉ hỗ trợ một account.
- Thêm scenario primitives negative có authorization rõ ràng.
- Gắn `qaPlan` đã validate vào `RunManifest`; runner không tự chạy plan hoặc tự cấp authorization.
- Thêm multi-account runner thật với account provider được ủy quyền và fixture cô lập.
- Chạy live trên isolated authorized fixture; không chạy production.
