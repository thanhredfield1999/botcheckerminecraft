# BotChecker Current State

Last reviewed: 2026-08-27

## Baseline

- Package version: `0.1.0`.
- Runtime: Node.js `22.18.0+`, TypeScript ESM.
- Product: Mineflayer-based Minecraft player-journey and GUI tester exposed through
  a private HTTP API.

## Implemented Behavior

## 2026-08-27 — P0 decoder/polling post-UAT hardening

- `VERIFIED offline`: Adventure decoder dùng recursion-path thay vì global dedupe, nên component object dùng lại không bị coi là cycle; traversal bị chặn bởi depth `16`, node budget `512`, selector text `4096` ký tự và `64` lore lines. Evidence vẫn tách riêng ở `256` ký tự/`16` lore lines, nên selector lore dòng 17 dùng được mà report không giữ dòng đó.
- `VERIFIED offline`: captured-shaped fixtures gồm string/JSON/translatable/nested lore, installed `prismarine-chat@1.13.0`, protocol-774 `prismarine-nbt`, shared object, cycle/throwing accessor và input rất lớn. Không còn `[object Object]` trên các shape được kiểm.
- `VERIFIED offline`: `assert_state` poll đồng thời health/food/GUI với cadence riêng `10 ms`, giữ default poll khác ở `100 ms`, abort theo step timeout và lưu last observed failures/evidence.
- Focused P0 gate cuối: `15/15` PASS; focused persistence/bundle + P0 gate sau race file song song: `21/21` PASS. Exact independent read-only review: `PASS`, `0` blocker/high/medium.
- Full ordered gate trên tree ổn định: `npm run typecheck && npm test && npm run build && git diff --check` exit `0`; `325` tests, `323` pass, `0` fail, `2` intentional Windows signal skips; typecheck/build/diff-check PASS.
- ItemGuard live rerun ở mục kế tiếp vẫn là runtime evidence authoritative cho source fingerprint đã archive. Hardening local này chưa được bind bằng runtime fingerprint mới, không hồi tố archive và không chạm Paper/production.

## 2026-08-27 — ItemGuard controlled UX authoritative rerun

- `VERIFIED live` trên isolated Paper `1.21.11-131`, protocol `774`: member run `d26d730e-6bff-4471-8c96-5d104d811f62` `24/24 PASS`; staff run `40698a9d-a0ff-4422-ac9a-3b5e21a1a33b` `38/38 PASS`.
- Live journey xác minh bounded Adventure title/name/lore decode, `assert_state` polling close, monotonic GUI generation, Unicode NFC `wait_for_text.allOf`, top/player section semantics, material/cardinality/absence selectors và top-only click guard.
- Staff fixture exact `29` items: page 1 `28`, page 2 `1`; filter/history/detail/back/code-history/final close đều PASS. Member permission/self-history journey PASS mà không dùng fixed sleep.
- Live RED `d9feae08-...` xác định protocol-774 prismarine-NBT `{type,value}` chưa được unwrap; captured fixture RED rồi GREEN với bounded `compound/list/string` unwrap. Staff RED `969fd096-...` là scenario selector quá rộng đếm back control; acceptance `exactly 2` được giữ bằng history-row marker riêng.
- Final BotChecker gate trước rerun: typecheck PASS; `318` pass, `0` fail, `2` intentional Windows skips; build/diff-check PASS. Runtime source fingerprint `fc7d4d7e1986bdfef35cc8dfac879ef97ed07344b5f84c1d7bc7a0506c4b2a10`.
- Post-report current-tree ordered gate sau các slice song song: typecheck PASS; `326` pass, `0` fail, `2` intentional Windows skips; build/diff-check PASS. Đây không phải runtime-bound fingerprint mới và không hồi tố archive UAT.
- Evidence archive SHA-256 `b64914fe00b7025ff644638a3d114a7a897f999325dc7d49448d254b6bf99a00`; historical RED/PARTIAL evidence retained. ItemGuard clone restored byte-exact/offline; production untouched.
- This verifies the exercised command/GUI UX capability only. P2 multi-account orchestration, typed attribution, full Paper/plugin/config binding and release readiness remain separate scopes.

## 2026-08-27 — ItemGuard controlled UX UAT gap checkpoint

- `OBSERVED live` trên controlled Paper `1.21.11-131`, protocol `774`, Mineflayer `4.37.1`: permission và functional GUI slot journeys chạy được; các run cũ đã tái hiện Adventure component decode, `assert_state` one-shot, text-event reuse và GUI transition gaps.
- `VERIFIED offline`: `snapshotGui` decode Adventure title/custom-name/lore thành plain text bounded, dùng recursion-stack để không coi shared object là cycle, và không giữ `[object Object]`.
- `VERIFIED offline`: `assert_state` poll chung health/food/GUI tới deadline, abort được và giữ last-state evidence khi timeout.
- `VERIFIED offline`: `wait_for_text.allOf` khớp nhiều predicate Unicode NFC trong cùng event mới; chưa có bounded lookback qua step cũ.
- `VERIFIED offline`: monotonic `windowGeneration` + `assert_gui.afterStep` chờ GUI generation mới, trong khi inspect-before-click/stale-window guard vẫn fail-closed.
- `VERIFIED offline`: GUI snapshot tách top/player inventory; selector hỗ trợ section/material/cardinality/absence/empty slot; click mặc định chỉ được top inventory và player slot cần opt-in explicit.
- Full backlog P0/P1/P2, tight repro và acceptance tests: `docs/ITEMGUARD_UX_UAT_BOTCHECKER_GAPS_2026-08-27.md`.
- Evidence archive ngoài controlled clone: `E:/AI.WORK/evidence/itemguard-ux-uat-20260827.tar.gz`, SHA-256 `ac6840fe4ea13279042d09c52781c431ec10265e18834b762a0b048e7b79c3da`.
- ItemGuard candidate không có runtime exception trong journey; không quy các harness/oracle failures thành product bug. Production không bị chạm.

## 2026-08-27 — Immutable report artifact slice

- `VERIFIED offline`: `src/evidence-writer.ts` ghi artifact bounded bằng temp file `wx`, fsync file, hard-link create-new tới destination, read-back và SHA-256 verify, rồi dọn temp.
- `VERIFIED offline`: collision và hai concurrent writer cùng destination chỉ cho một writer thắng; artifact đầu tiên được bảo toàn; path traversal và artifact vượt size bound bị từ chối.
- `VERIFIED offline`: `TestRun` dùng immutable writer cho report JSON và route-map JSON/HTML; integration regression chứng minh report collision không overwrite bytes có trước.
- Đây mới là lớp immutable artifact của P0.4. Chưa có full evidence-bundle manifest, exact Paper/plugin/probe/config binding, directory fsync policy, stale-candidate verifier hoặc final archive hash; không đánh dấu P0.4 hoàn tất.
- Focused decoder/GUI gate: `20/20` pass; focused immutable writer/report persistence gate cuối: `7/7` pass.
- Full ordered gate trên final tree: `npm run typecheck && npm test && npm run build && git diff --check` exit `0`; `310` tests, `308` pass, `0` fail, `2` intentional Windows signal skips; typecheck/build/diff-check pass.
- Không kết nối Minecraft/Paper, không mở API listener, không deploy/reload/restart và không chạm production trong slice này. ItemGuard controlled UAT rerun và exact candidate runtime vẫn `NOT VERIFIED`.

## 2026-08-27 — Independent review correction

- Review read-only đến sau implementation; các test/schema mismatch nó thấy thuộc snapshot cũ và không còn tái hiện trên final full gate.
- Ba counterexample còn hiệu lực đã RED rồi GREEN:
  - `assert_gui.afterStep` nay dùng `windowGeneration` khi step tham chiếu hoàn tất, nên không thể tái dùng GUI đã mở trong chính step đó;
  - GUI title/name/lore selectors dùng cùng Unicode NFC canonicalizer với text oracle;
  - timeline summaries do GUI sinh ra được sanitize và bound `<=256`, trong khi chat summary không bị cắt trước `wait_for_text` oracle.
- Focused review correction gate: `16/16` pass, gồm stale-window, completion-baseline, Adventure/NFC, timeline bound, text composite và GUI selectors.
- Full ordered gate sau correction: `npm run typecheck && npm test && npm run build && git diff --check` exit `0`; `313` tests, `311` pass, `0` fail, `2` intentional Windows signal skips.
- Finding formatter chưa gắn nhãn `section` trong console được giữ là readability P2; JSON evidence và click guard vẫn chứa/enforce `section`, nên không phải blocker proof hiện tại.
- P0 tiếp theo vẫn là capability manifest/exact binding: Git commit+dirty, source/package/lock fingerprints và candidate/provider/config identity. Immutable writer hiện tại không tự chứng minh những binding này.
- Không có Paper/runtime/production operation trong correction này.

## 2026-08-27 — Capability manifest provenance slice

- `VERIFIED offline`: report runtime mặc định được bind `RunManifest.capability` schema v1, gồm exact Git commit + dirty flag, Node/platform/arch, root `package.json` SHA-256, exact loaded package metadata path/hash, `package-lock.json` SHA-256, locked direct dependency versions, code-root, per-file hashes và aggregate source fingerprint.
- Collector hash đúng code được nạp: `src/*.ts` khi TSX và `dist/src/*.js` + `dist/package.json` khi chạy compiled build. Source traversal bounded `256` file, `2 MiB/file`, `32 MiB` tổng; symlink, path traversal, file đổi trong lúc đọc và working-tree status đổi trong lúc collect đều fail-closed.
- Capability entries phân biệt `runtime-wired` với `library-only`; callback contracts như multi-client/persistence/crash-recovery không bị quảng cáo thành live provider.
- Runtime collector được cache một lần và default server truyền cùng manifest/commit vào mọi `TestRun`; `sourceRevision` mâu thuẫn capability Git commit bị từ chối khi tạo run.
- Focused capability/report/server gate: `10/10` pass. Compiled collector xác minh `codeRoot=dist/src`, `54` compiled JS fingerprints, loaded package `dist/package.json`, dirty state explicit và capability modes đúng.
- Full ordered gate: `npm run typecheck && npm test && npm run build && git diff --check` exit `0`; `321` tests, `319` pass, `0` fail, `2` intentional Windows signal skips.
- P0 provenance vẫn `PARTIAL`: chưa bind exact Paper/server JAR, plugin candidate/probe JAR CodeSource, config/data baseline, provider/approval/boot token hoặc final evidence-bundle hash. Không gọi đây là candidate/runtime verified.
- Không mở API listener, không kết nối Minecraft/Paper, không deploy/reload/restart và không chạm production.

## 2026-08-27 — Evidence bundle seal slice

- `VERIFIED offline`: mỗi `TestRun` thành công ghi persistence hiện tạo raw report tương thích `<runId>.json` cùng seal create-new `<runId>.bundle.json`; route-map JSON/HTML nếu có được đưa vào cùng artifact graph.
- Seal schema v1 bind `runId`, scenario SHA-256, optional capability source fingerprint, sorted artifact roles/names/bytes/SHA-256 và canonical `bundleSha256`; seal được ghi cuối, vì vậy thiếu seal biểu thị bundle chưa hoàn tất thay vì giả complete.
- Writer preflight exact seal/report/run filename binding, duplicate/collision và toàn bộ artifact bytes được snapshot trước `await`. Verifier strict-schema từ chối unknown field, bundle hash sai, missing/tampered artifact, non-regular/symlink, oversized file và file đổi trong lúc đọc.
- Focused immutable/capability/report bundle gate: `22/22` pass. Compiled collector bind `dist/src`, `55` JS fingerprints và `evidence-bundle=runtime-wired`.
- Full ordered gate: `npm run typecheck && npm test && npm run build && git diff --check` exit `0`; `328` tests, `326` pass, `0` fail, `2` intentional Windows signal skips.
- P0.4 vẫn `PARTIAL`: artifact graph/seal đã có nhưng chưa bind Paper/server JAR, plugin/probe candidate JAR, config/data baseline, provider/approval/boot token; chưa có archive hash hoặc directory-fsync policy.
- Không mở listener/Paper/Minecraft, không deploy/reload/restart và không chạm production.

## 2026-08-27 — Structured failure envelope / multi-client slice

- `VERIFIED offline partial`: thêm strict bounded `FailureEnvelope` taxonomy gồm `code`, `phase`, `provider`, `causeClass`, `boundedDetail`, `artifactRefs`, `retryable`, `trustBoundary`; credential assignments/Bearer values được redacted trước persist và credential-like refs/metadata bị reject.
- `runMultiClient` không còn nuốt provider exception thành `skipped` với `{}`. Nested cause hiện được giữ theo client trong raw evaluation và `buildMultiClientReport`; validation failure cũng tạo structured aggregate failure.
- Multi-client aggregation giữ `FAIL_PRODUCT` ưu tiên hơn missing observer nhưng vẫn bảo toàn toàn bộ failures; status/code mâu thuẫn (`failed` + `INCONCLUSIVE_*`, `skipped` + `FAIL_*`) bị reject. Legacy failed/skipped observation không có envelope được gắn synthetic bounded failure thay vì evidence trống.
- Focused failure/multi-client/assert-state gate: `22/22` pass. Full ordered gate `npm run typecheck && npm test && npm run build && git diff --check` exit `0`; `334` tests, `332` pass, `0` fail, `2` intentional Windows signal skips.
- Một test `assert_state` cũ dùng ngưỡng wall-clock `<150ms` fail khi Node test files chạy song song và event loop bị contention, nhưng chạy focused lặp 3 lần đều xanh ~39–47ms. Oracle được sửa để xác minh semantic timeout, failure evidence và exact abort-signal wiring thay vì ngưỡng scheduler-dependent; đây không phải performance claim.
- P0.5 vẫn `PARTIAL`: gameplay/GUI/persistence/crash-recovery/transaction/compatibility/authorized-plan runners chưa được migrate toàn bộ sang envelope; protocol diagnostic chưa gắn taxonomy/phase/provider.
- Không mở listener/Paper/Minecraft, không deploy/reload/restart và không chạm production.

## 2026-08-27 — Opus 4.8 provenance/evidence correction

- Independent read-only Opus review `9e1f44c2-8d0d-4bf1-b72b-e3417707ea2f` audit capability provenance, immutable bundle và failure envelope. Hermes tái hiện hai false-evidence counterexample: report collision làm `start()` reject nhưng in-memory vẫn `passed/PASS`; malformed multi-client observation có thể che `FAIL_PRODUCT` của client khác.
- `VERIFIED offline`: mọi report persistence exception nay ghi `persist_error`, set `error`, chuyển run không-cancelled sang `failed/FAIL` rồi rethrow. Route sidecar dùng ordinal `step-0001` deterministic thay raw `step.id`, nên Unicode/space/slash trong ID không làm mất bundle.
- `VERIFIED offline`: default server collect/cache capability manifest ngay khi dựng `createServer()`, trước first run; injected `runFactory` không shell Git. Effective `sourceRevision` được pin ở constructor, gồm `GIT_COMMIT` fallback, reject mismatch và không để whitespace dependency vô hiệu hóa fallback.
- `VERIFIED offline`: multi-client validation cô lập malformed evidence nhưng giữ `FAIL_PRODUCT`; circular/token/oversized evidence không hạ FAIL. Duplicate/over-limit aggregate giữ existing/synthetic FAIL và synthetic skipped counterexamples; invalid status/failure metadata vẫn fail-closed thành INCONCLUSIVE.
- TDD evidence: 5 original regressions RED→GREEN; same-client malformed, duplicate aggregate, skipped aggregate consistency và empty-sourceRevision đều RED→GREEN. Focused final gate `32/32` PASS trước hai LOW hardenings; focused multi-client `19/19`, report contract `6/6` và final combined gate đều PASS.
- Opus correction `a6bc9c5a-2fcf-47ae-a4f4-6e1503ad5d57` tìm thêm same-client/aggregate counterexamples và chúng đã được sửa. Final narrow review `4ebd4c5d-cb83-4248-a017-f369da96a526` trả `PASS`, không blocker/high/medium; LOW skipped-evidence consistency cũng đã sửa sau review.
- Full exact-tree ordered gate: `npm run typecheck && npm test && npm run build && git diff --check` exit `0`; `344` tests, `342` pass, `0` fail, `2` intentional Windows signal skips.
- Rủi ro còn lại: report/timeline vượt `16 MiB` sẽ surface thành FAIL nhưng có thể không có sealed bundle; raw persistence error chưa scrub absolute filesystem path; exact Paper/server/plugin/probe/config/provider/approval binding và envelope migration cho runner khác vẫn mở. Không gọi đây là runtime/candidate/release verified.
- Không mở listener/Paper/Minecraft, không deploy/reload/restart và không chạm production.

## 2026-08-27 — Offline exact target artifact binding

- Design review Opus 4.8 `89f6c77b-842a-4fd6-94d4-28273c5a450a` bác proposal ban đầu vì một file offline có thể tự mint `runtime-bound`. Thiết kế đã thu hẹp: miền grade chỉ có `development-unbound | artifact-bound`; `releaseEligible` luôn `false`; không có observed/boot-token/runtime-bound producer.
- `VERIFIED offline`: `src/target-binding.ts` strict/canonical bind đúng 1 Paper JAR, đúng 1 candidate plugin JAR, tối thiểu 1 config baseline và tối đa 1 optional probe; provider/authorization/artifact role, logical ID/path và SHA-256 được bounded, NFC-safe, credential-rejecting, unique và deterministic.
- `VERIFIED offline`: `TARGET_BINDING_FILE` chỉ được default server stable-read một lần lúc `createServer()`, reject symlink/non-regular/oversized/changing/malformed file. Injected `runFactory` không đọc file hoặc shell. Mọi report ghi rõ evidence grade; offline LivingNPC report và run không binding là `development-unbound`.
- `VERIFIED offline`: artifact-bound `TestRun` snapshot canonical binding tại constructor, ghi cùng `targetBindingSha256` vào report và bundle seal. `verifyArtifactBoundBundle` verify seal/artifact bytes, parse report từ chính buffer đã verify, kiểm report/seal run ID, capability fingerprint, canonical binding hash và exact expected binding; kết quả luôn `releaseEligible:false` dù functional verdict là gì.
- TDD counterexamples RED→GREEN: forged runtime grade, unbound PASS, stale/mismatched target, role/path/scope/schema/secret/duplicate/cardinality violations, report/seal run ID mismatch, mutable caller binding, capability fingerprint divergence và invalid source revision.
- Opus correction `a1df4b1b-8349-4379-8ea4-efed4f772c67` và final hardening review `e6f94603-ba6f-4aef-a63b-676f8374412a` đều `PASS`, không blocker/high/medium cho boundary `offline artifact-bound only`.
- Final exact-tree gate: `npm run typecheck && npm test && npm run build && git diff --check` exit `0`; `356` tests, `354` pass, `0` fail, `2` intentional Windows signal skips.
- Tuyệt đối không suy ra JAR/config tồn tại, được JVM load, đúng server đã kết nối, runtime verified hoặc release-ready. Runtime proof cần trusted probe có chữ ký và nonce do verifier phát; hiện chưa triển khai. Không mở listener/Paper/Minecraft, không deploy/reload/restart và không chạm production.
- LOW backlog: áp commit validation chung cho offline LivingNPC report; có thể recompute capability source fingerprint từ embedded source list; scrub absolute path trong persistence errors; cân nhắc siết direct-call run ID namespace.

## 2026-08-28 — Offline signed-provider claim verifier

- Threat review độc lập của proposal kết luận `FAIL` nếu gọi đây là authenticated runtime proof, nhưng `PASS có điều kiện` cho boundary hẹp: possession của configured Ed25519 key + fresh correlated claim + exact declared artifact match trong một verifier process. Implementation và tên claim đã giữ đúng boundary hẹp này.
- `VERIFIED offline`: configured-key store strict/canonical Ed25519 SPKI, key ID là SHA-256 DER, immutable policy snapshot, exact provider/binding scope và key validity. Private/non-Ed25519/noncanonical key encodings bị từ chối; production module không nhận hoặc persist private key.
- `VERIFIED offline`: challenge bind domain/audience/verifier instance/sequence/run/key/provider/target hash/trust-store fingerprint, dùng nonce 32 byte, TTL bounded, dual wall/monotonic clocks, capacity và invalid-attempt budget. Replay, cross-instance, exact-expiry, clock rollback/overflow và caller mutation fail-closed.
- `VERIFIED offline`: canonical signed claim strict schema, safe integer/NFC/path guards, exact artifact set/role/path/hash, observed-time window và Ed25519 signature canonical base64url. Verify/consume đồng bộ; kết quả luôn `ACCEPTED_NON_RELEASE`, `artifact-bound`, `releaseEligible:false`; server/boot IDs chỉ là `claimed*` strings.
- Tại thời điểm slice này, capability `signed-provider-claim` là `library-only`, challenge store chỉ single-process/in-memory và multiprocess còn là gap. Trạng thái này đã được supersede bởi section `Shared signed-provider challenge state` bên dưới; boundary không report/server/Paper/JVM/release vẫn giữ nguyên.
- Reviewer phát hiện capability-manifest package/source snapshot TOCTOU; đã RED→GREEN bằng cách bracket toàn bộ reads với Git HEAD + status trước/sau. Public claim canonicalizer cũng đã được siết logical-path traversal; wall-clock expiry prune capacity và monotonic rollback latch đều có regressions.
- Final exact-tree ordered gate sau pre-commit corrections: `npm run typecheck && npm test && npm run build && git diff --cached --check` exit `0`; `374` tests, `372` pass, `0` fail, `2` intentional Windows signal skips.
- Pre-commit correction review trả `PASS`, `0` blocker/high/medium sau khi RED→GREEN ba finding: credential-like `qa.authorization` bị reject trước manifest; multi-account exception/report message được redact/reject; LivingNPC evidence dùng `timestampMillis` thay vì biến tick counter thành epoch.
- Opus 4.8 static correction review `0277f613-fb5f-4c19-8e87-c821b5b3cfcf` sau quota reset trả `PASS`, `0` blocker/high/medium cho đúng boundary library-only/non-release. Review xác nhận M1 capability snapshot TOCTOU và L2 public path-schema correction đã khép. LOW còn lại: có thể dời monotonic watermark sau input validation; network/multiprocess tương lai cần shared transactional nonce store + per-key/provider rate limiting.
- Trạng thái vẫn chỉ là `VERIFIED offline`: static review không chứng minh key custody, physical probe, JVM-loaded state, truth của server/boot claims, Paper runtime, security vận hành hoặc release readiness. Sonnet/design attempts trước bị HTTP `429` không được tính là verdict.
- Chưa mở Paper/listener, chưa deploy/reload/restart, chưa chạm production và chưa push.

## 2026-08-28 — Shared signed-provider challenge state (supersedes single-process gap)

- `VERIFIED offline/library-only`: optional `SqliteSignedProviderChallengeStore` dùng local file-backed `node:sqlite`, `BEGIN IMMEDIATE`, WAL và `synchronous=FULL`; shared sequence, expiry, atomic consume, invalid-signature burn và fixed-window rate limiting hoạt động qua nhiều connection/process. In-memory verifier vẫn là compatibility default.
- Shared scope pin exact trust-store SHA-256, verifier capacity/invalid-attempt policy và rate policy. Consuming verifier re-authorize trust store, provider và exact target binding. Durable retired-scope tombstone từ chối cả object cũ lẫn process mới tái dùng `verifierInstanceId` đã reclaim; không reset sequence hoặc policy namespace.
- Global scopes, retired tombstones và per-scope rate subjects đều bounded; expired challenges và idle scopes được reclaim transactionally. Khi tombstone budget đầy, store ngừng reclaim và từ chối scope mới thay vì quên retired identity; đây là fail-closed availability trade-off. Caller wall time được so với trusted wall-clock callback dưới SQLite write lock; durable high-water từ chối stale/rollback operation mà không poison worker khỏe.
- Runtime tối thiểu là Node `22.18.0`. Node v22 docs xác nhận `DatabaseSync.timeout` và `isTransaction` có từ `22.16.0`, còn constructor security options dùng trong store có từ `22.18.0`. Constructor còn kiểm runtime version, `isTransaction`, exact `PRAGMA busy_timeout`, WAL và FULL sync; CI matrix chạy Node `22.18.0` và `24`.
- Database, `-wal`, `-shm`, trusted clock và private parent directory là security roots. POSIX guard owner/mode, Windows/POSIX đều reject symlink/non-regular DB; chưa có keyed integrity MAC, distributed consensus, network-filesystem/HA support hoặc directory-fsync/archive proof. Corrupt/future schema và clock jump phải quarantine toàn bộ DB/WAL/SHM set; challenge cũ bị invalidated.
- Focused post-review correction gate đạt `45` tests, `44` pass, `0` fail, `1` POSIX-permission skip trên Windows. Full exact-tree gate `npm run typecheck && npm test && npm run build && git diff --check` exit `0`: `422` tests, `418` pass, `0` fail, `4` skip; TypeScript/Java build và diff-check PASS.
- Opus 4.8 correction review trả `PASS`, `0` blocker/high/medium; ba MEDIUM về retired-scope resurrection, runtime SQLite capability và CURRENT_STATE contradiction đều `CLOSED`. Reviewer không tự chạy gate do tool permission, nên verdict tĩnh được đối chiếu riêng với gate local ở dòng trên.
- Capability `signed-provider-shared-challenge-state` là `library-only`; không import vào HTTP server/report/Paper/JVM/release admission. Không mở listener/Paper, không deploy/reload/restart, không chạm production và chưa push.

## 2026-08-28 — Java 21 signed-claim interoperability fixture

- `VERIFIED offline/test-only`: `test/fixtures/java/SignedProviderClaimInteropFixture.java` compile bằng `javac --release 21`, tự dựng canonical JSON fixed-order và ký Ed25519 bằng PKCS#8 private key ephemeral do Node test tạo trong temp directory.
- Regression đã RED vì Java fixture chưa tồn tại rồi GREEN: canonical bytes Java khớp byte-for-byte `canonicalSignedProviderClaimV1`; chữ ký Java được `SignedProviderClaimVerifier.verifyAndConsume` chấp nhận thật, nonce bị consume và `releaseEligible:false`.
- Full exact-tree gate sau slice: `npm run typecheck && npm test && npm run build && git diff --check` exit `0`; `375` tests, `373` pass, `0` fail, `2` intentional Windows signal skips. Java interop test chạy thật, không skip trên host hiện tại.
- Opus 4.8 review `3b7884a6-7acf-4f83-ad67-ea3a7ca9f74a` trả `PASS`, `0` blocker/high/medium. Allowed claim chỉ là một Java 21 test-fixture vector đại diện tương thích canonical bytes + Ed25519 offline.
- Đây không phải production probe: không `src/` signer/private-key loader, không Paper/Bukkit/server/report integration, không key custody, loaded-JVM proof, runtime evidence hoặc release eligibility. LOW backlog: gate cả `java` runtime version để tránh false RED trên host lệch toolchain; thêm negative/optional-instance interop vectors trước khi suy rộng compatibility coverage.

## 2026-08-28 — Non-authoritative JVM artifact observation core

- `VERIFIED offline/library-only`: `java-src/vn/heomc/botchecker/probe/JvmArtifactObserver.java` quan sát bounded regular local `CodeSource` file cùng class resource do anchor loader trả, nhưng luôn ghi `authoritative=false`, `provesLoadedBytecode=false`, `atomicSnapshot=false` và `releaseEligible=false`. Declared role/ID/path tách khỏi observed class/hash; outward evidence chỉ giữ SHA-256 canonical URI, không raw path.
- Fail-closed coverage gồm null/non-file/network/directory/final-symlink contract, size/resource/total-memory/concurrency bounds, path alias/traversal, path swap trước open, không reopen path sau snapshot, parent-delegated resource, MRJAR runtime version 21, compressed inflated-scan bound và 4097-entry bound. Symlink fixture trên host hiện tại skip trung thực vì Windows trả `EPERM`; chưa có controlled symlink evidence trên host cho phép tạo link.
- `npm run build` compile Java bằng `javac --release 21`; capability manifest v2 bind build script, Java source và compiled `.class`. Legacy manifest không auxiliary vẫn là v1 với exact legacy fingerprint; explicit empty auxiliary fail-closed. Compiled collector được chứng minh từ trạng thái `dist/` vắng.
- Opus threat/correction reviews `3653363a-b3b2-4e32-97da-cec4fb038253` và `3c847af3-dc3b-4759-95ae-4d977ea694da` PASS production boundary; M1 MRJAR Unix-`cp` portability đã RED→GREEN bằng Node `copyFileSync` và correction `3a74e622-6b70-43e9-ac34-d1ee14a4cc5c` xác nhận CLOSED. Capability schema v2 review `7abba73d-ba80-45da-8c28-27d15081f843` PASS, `0` blocker/high/medium; hai LOW version-domain/empty downgrade đã được sửa sau review.
- `VERIFIED offline/library-only`: strict Node observation v1 parser/canonicalizer bind caller-declared `paper|candidate|probe` identity cùng whole-CodeSource file SHA-256 vào exact target binding. Exact file match chỉ trả `TARGET_FILE_MATCH_NON_AUTHORITATIVE`; hash/identity mismatch được giữ thành structured counter-evidence. Assessment tự chứa URI fingerprint, file/resource hashes + sizes, informational base-entry assessment và SHA-256 của toàn canonical observation.
- Java `canonicalJsonUtf8V1` khớp byte-for-byte Node cho vector ASCII và supplementary Unicode; producer/consumer cùng reject forged trust posture, role `config`, credential-like metadata, path alias/traversal và byte overflow. Capability `jvm-artifact-observation-assessment` là `library-only`, chưa import vào runner/server/report/signed-provider.
- Opus review `617fcd15-42d9-4897-b003-8d42ff0fc148` PASS `0` blocker/high/medium; correction `1f6e79c3-8200-4655-8b8d-3316e6a9cedd` xác nhận cả 4 LOW (path parity, class-resource signal, self-contained fields, Unicode UTF-8) CLOSED.
- Full exact-tree gate: `npm run typecheck && npm test && npm run build && git diff --check` exit `0`; `401` tests, `398` pass, `0` fail, `3` skip (2 intentional Windows signal skips cũ + 1 symlink `EPERM` skip); Java build, TypeScript build và diff-check PASS.
- Đây không phải trusted/prod probe hoặc runtime attestation: không signer/private-key/key custody, nonce/report/server/Paper integration, effective config observation, loaded-bytecode proof, runtime behavior hay release admission. Không mở Paper/listener, không deploy/reload/restart, không chạm production và chưa push.

## 2026-08-28 — Observation-bound signed-provider claim v2

- Opus design review chặn hướng làm opaque signer trước vì chữ ký mạnh hơn vẫn có thể ký artifact hoàn toàn do caller tự khai. Slice này thay vào đó thêm profile explicit `jvm-observation-bound-v2`; legacy envelope/canonical bytes v1 giữ nguyên tương thích.
- `VERIFIED offline/library-only`: challenge ID và SQLite `challenge_json` pin profile v2. Verifier từ chối v1 downgrade, strict-parse raw JVM observation, tự assessment lại với exact pending target binding và chỉ chấp nhận `TARGET_FILE_MATCH_NON_AUTHORITATIVE` cho đúng artifact role `candidate`. Signature Ed25519 bao phủ claims + canonical observation; bad signature dùng chung invalid-attempt budget trước semantic assessment; nonce vẫn consume một lần.
- Kết quả luôn `artifact-bound`, `authoritative:false`, `provesLoadedBytecode:false`, `releaseEligible:false`. `observedAtMs` chỉ `self-asserted-by-signer`; `observationFreshness` là `not-established`; toàn bộ caveat declared-identity, CodeSource-file, loader-mediated class resource và best-effort non-atomic snapshot được giữ trong result. `claimFreshness:'fresh'` chỉ nói challenge nằm trong cửa sổ thời gian, không chứng minh observation mới.
- Java 21 interop fixture không còn nhận JSON observation do Node canonicalize. Nó dựng production `JvmArtifactObserver.Observation`, gọi Java `canonicalJsonV1`, tự dựng wrapper/claims v2 và ký bằng ephemeral test-only PKCS#8; cả vector v1/v2 khớp byte-for-byte Node và được verifier thật chấp nhận.
- Shared-store regression dùng hai SQLite connections để issue/load cùng `challengeId`/profile, reject v1 downgrade rồi verify/consume v2; shared legacy-v1 round-trip vẫn chứng minh row không có profile tương thích. Focused exact-tree gate đạt `60` tests, `59` pass, `0` fail, `1` POSIX-permission skip trên Windows; cả hai Java interop tests chạy thật. Full ordered gate `npm run typecheck && npm test && npm run build && git diff --check` exit `0`: `427` tests, `423` pass, `0` fail, `4` skip; TypeScript/Java build và diff-check PASS.
- Opus correction review trả `PASS`, `0` blocker/high/medium. LOW còn lại: signed semantic mismatch có thể retry trong TTL; result chỉ surface observation summary; chưa có một số negative vectors cho hướng profile/hash/class-resource; `MISMATCH|NOT_A_JAR` vẫn được chấp nhận nhưng disclosure nguyên trạng vì class-resource consistency chỉ informational.
- Capability `signed-provider-observation-bound-claim` vẫn `library-only`; không production signer/key loader, key custody/provisioning, Paper/Bukkit adapter, effective-config/boot truth, report/server/release wiring hoặc controlled runtime evidence. Không mở Paper/listener, không deploy/reload/restart, không chạm production và chưa push.

Report contract update on 2026-08-16:

- Mỗi step và report tổng có verdict kiểu `PASS | FAIL | INCONCLUSIVE`; oracle mang mã lỗi `INCONCLUSIVE_*` và step optional không còn bị gộp vào lỗi sản phẩm.
- Report chứa manifest schema v1: phiên bản runner, source revision khi được cung cấp, SHA-256 scenario đã parse, target cấu hình và protocol/world/dimension quan sát được từ client.
- Manifest không chứa username, password hoặc credentials Minecraft.
- Scenario hỗ trợ `assert_gui` để chờ rồi xác minh hậu điều kiện GUI theo title và item selector (slot/name/lore/count); fixture ordering kiểm nút thanh toán nhưng không click thanh toán.
- GUI selector/click giữ toàn bộ slot cho logic, kể cả slot `>=64`; evidence, report và console GUI vẫn chỉ giữ tối đa 64 item đã sanitize. Regression coverage xác minh `assert_gui` và `click_gui` dùng được slot 80 trong GUI 90 slot, evidence GUI bounded `<=64`, và selectors trùng slot trả fail.
- Local verification: `npm run typecheck`, `npm test` (121 pass, 0 fail, 2 skip có chủ đích trên Windows), `npm run build`, focused report/crossing/GUI tests và `git diff --check` đều pass. Chưa chạy server hoặc live Minecraft cho thay đổi này.

- Connect with configured offline or Microsoft authentication.
- Capture player-visible chat, titles, action bars, deaths, kicks, and GUIs.
- Walk or use an explicitly authorized teleport command.
- Approach, face, and interact with a named NPC.
- Inspect, log, pause, revalidate, and then click GUI content.
- Persist completed reports under `reports/<runId>.json`.
- Run lifecycle now has an abort signal and idempotent cleanup primitive; runner waits through lifecycle cleanup when the scenario ends.
- Manual runs now pass through a single-account FIFO queue: one active run plus a bounded pending capacity configured by `RUN_QUEUE_CAPACITY`.
- Queue overflow returns HTTP `429`; cancelling a queued run does not start Mineflayer and persists a cancelled report.
- `GET /health` reports queue `active`, `pending`, and `capacity` values.
- `BotSession` owns telemetry listeners, pathfinder stop, open-GUI close, and bounded disconnect cleanup. Connect waiting removes temporary listeners on spawn, kick, error, end, timeout, or cancellation.
- Bounded disconnect cleanup keeps its timeout referenced while the returned cleanup promise depends on it. Unreferencing that timer allowed POSIX Node to drain the event loop and cancel the pending test/run before cleanup resolved when Mineflayer never emitted `end`.
- `TestRun` has a bot-factory seam for component tests and attaches the spawn wait synchronously after bot creation, avoiding a lost-spawn race.
- `assert_state` validates health, food, and GUI state without mutating the server. `assert_nearby_entity` polls the client entity stream within its bounded step timeout and records name, distance, and position evidence. Khi khai báo `requiredUuid`, locator bắt buộc khớp đồng thời tên và UUID, fail closed nếu chỉ có entity trùng tên sai UUID, đồng thời ghi exact UUID đã xác minh vào evidence.
- `inspect_entities` records a bounded, sanitized snapshot of the current Mineflayer entity stream and player-info identity fields. It is capped at 48 blocks, 64 entities, 32 metadata entries per entity, and 256 characters per string; it does not scan the world, force-load chunks, or retain arbitrary entity objects.
- Entity identity matching now also reads `prismarine-entity`'s `getCustomName()` component, allowing Citizens-like player entities without `username` to be matched by their client-visible custom name. Malformed custom-name metadata is isolated per entity; absence, ambiguity, missing required UUID, disappearance, or UUID change still fails closed.
- A failed `interact_entity` lookup now reports the bot position, configured range, and at most five nearest player-entity labels/distances already present in the client stream. This diagnostic remains bounded and does not weaken fail-closed matching or expand the tracking range.
- `observe_crossing` kiểm tra uniqueness ở mỗi sample và latch event-level trên `entitySpawn`, `entityUpdate`, `entityMoved`, `entityGone` và chuyển động `move` của chính bot; ambiguity hoặc range invalidation do entity/observer thay đổi hoàn toàn giữa hai poll vẫn kết thúc fail-closed. Vị trí trung gian của pinned entity từ `entityMoved` cũng đi qua oracle continuity/aperture/discontinuity và được ghi vào raw evidence, nhưng không tự tăng exit confirmation hoặc dwell; `death`/`respawn` hủy proof để trajectory không nối qua lifecycle hoặc world khác; mọi listener tạm được tháo trong `finally`.
- Crossing oracle dùng entry-side hysteresis nhưng nhận lần đổi dấu qua mặt phẳng ngay cả khi entity đi chậm qua deadband. Proof chỉ hợp lệ trên một chuỗi liên tục trong vertical/corridor aperture; rời aperture hoặc backtrack qua mặt phẳng sẽ xóa arm, crossing point và exit dwell để không tái dùng proof cũ.
- Scenario execution has an exhaustive action guard, so a schema action without a runner implementation cannot silently pass.
- Spawn diagnostics record configured and negotiated Minecraft versions, protocol number, dimension, and position. Client errors retain bounded name/message/stack context.
- Every connection receives a fresh copy of the configured Minecraft options. Mineflayer mutates `options.version`, and auto-version also writes `options.protocolVersion`; reusing `config.minecraft` previously allowed the first run to silently pin later runs. A regression test deliberately mutates the bot-factory input and verifies the shared configuration remains unchanged.
- Closing Fastify cancels queued and active runs and waits for queue idle. `SIGINT`/`SIGTERM` handlers close the app once, mark shutdown failures, and remove their listeners.
- `test/direct-entrypoint-shutdown.integration.test.ts` provides a bounded OS-level harness for the direct Node entrypoint. It allocates a loopback-only ephemeral port, creates no Minecraft run, signals only its own child PID, verifies clean exit/listener closure/PID disappearance, and always performs owned-child cleanup. The signal cases run on POSIX and skip explicitly on Windows, where Node child-process signals are not catchable.
- `scenarios/living-npc-smoke.json` is a fail-closed, non-destructive check: healthy client with closed GUI, named NPC within the 48-block activation range, bounded observation, then healthy postcondition. It sends no command, GUI click, teleport, or NPC interaction.
- `scenarios/restaurant-tycoon-ordering-gui.json` covers the implemented RestaurantTycoon ordering GUI only through draft selection and the payment-confirmation screen. It requires an authorized `plot_1` owner plus prepared supply setup and test database fixture, uses inspect-before-click for `Cà chua` and `Xác nhận đơn`, and deliberately never clicks payment or claims delivery, handoff, or warehouse behavior.
- Protocol decode errors have an offline-tested, opt-in diagnostic seam controlled by `PROTOCOL_DIAGNOSTICS=true` and disabled by default. When Protodef attaches the failing decompressed frame as `error.buffer`, BotChecker records only the bounded protocol field, frame length, and SHA-256; it does not retain frame bytes or arbitrary error properties. This does not change Protodef's array-size guard or add packet listeners.
- Route oracle added 2026-08-20: action `observe_route` independently verifies ordered checkpoints A→B→C, rejects A→C shortcut and discontinuous jumps, validates fence blocks from the client block cache, and requires each configured gate to be open during an independent signed-plane crossing. It never reads LivingNPC telemetry, phase, Citizens completion, or `GOING_TO_PLOT` state.

## Verification

GitHub Actions POSIX evidence on 2026-08-15:

- Run `31882776650` on Ubuntu 24.04 / Node.js 22 passed both direct-entrypoint `SIGINT` and `SIGTERM` shutdown tests with no skips, proving listener closure and process exit on a platform that delivers catchable signals.
- The same run exposed an independent BotChecker cleanup defect in the full suite: `cleanup is bounded when the bot never emits end` was cancelled because its only timeout had been unreferenced. A RED regression asserted the cleanup timeout remains referenced; the minimal fix removed only that `unref`, and local full verification then passed with 103 tests passed and 2 intentional Windows signal skips.
- Follow-up run `31899832804` on commit `822f320` passed in 27 seconds: locked install, typecheck, both direct-entrypoint POSIX signal tests, the full test suite, and build all completed successfully. The complete POSIX workflow is green; the remaining annotation concerns GitHub's Node runtime for `actions/checkout@v4` and `actions/setup-node@v4`, not the configured project runtime or test result.

Full local verification:

```powershell
npm run typecheck
npm test
npm run build
```

Latest local verification on 2026-08-14:

- `npm run typecheck`: passed.
- `npm test`: passed, 4 tests.
- `npm run build`: passed.

Verification after lifecycle slice on 2026-08-15:

- `node --import tsx --test test/lifecycle.test.ts`: passed, 2 tests.
- `npm run typecheck`: passed.
- `npm test`: passed, 6 tests.
- `npm run build`: passed.

Verification after bounded queue slice on 2026-08-15:

- `node --import tsx --test test/queue.test.ts test/server.test.ts`: passed, 6 tests.
- `npm run typecheck`: passed.
- `npm test`: passed, 12 tests.
- `npm run build`: passed.

Verification after `BotSession` integration on 2026-08-15:

- `node --import tsx --test test/bot-session.test.ts test/runner-session.test.ts`: passed, 6 tests.
- `git diff --check`: passed.
- `npm run typecheck`: passed.
- `npm test`: passed, 18 tests.
- `npm run build`: passed.

Verification after diagnostic, shutdown, and read-only assertion slices on 2026-08-15:

- Focused lifecycle/scenario/API tests: passed, 14 tests.
- `git diff --check`: passed.
- `npm run typecheck`: passed.
- `npm test`: passed, 28 tests.
- `npm run build`: passed.

Verification after crossing/schema completion and Citizens-like custom-name support on 2026-08-15:

- Focused crossing/entity/scenario/runner tests: passed, 23 tests.
- `npm run typecheck`: passed.
- Full ordered gate `npm run typecheck && npm test && npm run build && git diff --check`: passed, 39 tests.
- The custom-name behavior is covered by unit and component tests only. No server connection was made for this slice, so the actual Citizens metadata representation and LivingNPC smoke result remain runtime-unverified.

Hosted LivingNPC smoke on 2026-08-15:

- Target: the already-running local Paper 1.21.11 server at `127.0.0.1:11619`; no deploy, reload, restart, live YAML edit, command, GUI click, or direct NPC interaction was performed.
- The first run connected at the default-world spawn but failed during protocol decoding (`SlotComponent/ItemWrittenBookPage` abnormal array size) and disconnected cleanly.
- Follow-up run `397fbdb4-c40a-437d-9667-3f626f0acf21` passed in 10,154 ms at `StillCliff:23.5,-60,-18.5`, with health and food both 20 and no open GUI. Report: `reports/397fbdb4-c40a-437d-9667-3f626f0acf21.json`.
- Server log confirmed login, nearby LivingNPC activity (including the resident `ThanhRedfield` around `StillCliff:18,-61,-19`), and `lost connection: Disconnected` at scenario completion.
- The successful retry was served by the API process started without an explicit `MC_VERSION`; a second API launch with `MC_VERSION=1.21.11` failed with `EADDRINUSE`. Therefore protocol pinning is not a verified fix for the first-run decode failure.
- Stopping the tracked npm shell did not stop its child Node API process. PID ownership was checked before terminating only the BotChecker listener; port `18080` was clean afterward. Process-tree shutdown remains an operational issue to fix before unattended scheduling.

Follow-up deterministic protocol and precondition runs on 2026-08-15:

- BotChecker was built and started as a direct Node entrypoint with explicit `MC_VERSION=1.21.11`, target `127.0.0.1:11619`, and readiness/port ownership checks before each request. No npm-started stale API handled these requests.
- Run `e273092b-1188-42ac-ab70-e6ade62fc46e` proved configured version `1.21.11`, negotiated version `1.21.11`, protocol `774`, dimension `overworld`, and spawn `StillCliff:23.5,-60,-18.5`. The earlier fatal `ItemWrittenBookPage` decode failure did not recur, but one successful connection does not establish its root cause or prove protocol pinning eliminates every parser anomaly.
- The abnormal array size `1735156083` is `0x676c6173`, the ASCII bytes `glas`. This strongly indicates that Slot/component decoding had already crossed a wrong byte boundary rather than receiving a legitimate huge array. Protodef's array-size guard must not be disabled or raised; the exact packet/component still requires a captured raw-frame fixture before a decoder-level root cause can be claimed.
- Client-state precondition passed with health/food `20/20` and closed GUI. The named-entity precondition failed closed after its full 5-second polling window; report: `reports/e273092b-1188-42ac-ab70-e6ade62fc46e.json`.
- Server log for the same `03:44:14–03:44:22` window showed `ThanhRedfield` active around `StillCliff:41,-60,-12`, approximately 18.7 blocks from the tester and inside the 48-block activation range, followed by the tester's clean disconnect. Mineflayer still did not expose a matching nearby entity by the current username/displayName/name locator. Citizens client representation/metadata is therefore the next investigation target; the smoke must not be weakened merely to obtain a pass.
- Direct-process runs were stopped through the tracked process manager and ports `8080`/`18080` were verified clean. Unit tests cover graceful signal handling, but an OS-level direct-signal integration was not completed because the signal command required approval; do not claim that path as runtime-verified.
- A later isolated Windows probe removed the approval ambiguity: `child.kill('SIGTERM')` returned `true`, but the child exited with `signal: SIGTERM`, `code: null`, and its installed handler never ran. On this `win32` host, Node implements these child signals as forced termination rather than deliverable POSIX signals. Listener disappearance after that operation would not prove `app.close()` ran.

Process-tree shutdown harness verification on 2026-08-15:

- `node --import tsx --test test/process-shutdown.test.ts test/direct-entrypoint-shutdown.integration.test.ts`: passed 2 unit tests and skipped 2 OS integration cases with the explicit Windows signal-semantics reason.
- `npm run typecheck`: passed.
- Full ordered gate `npm run typecheck && npm test && npm run build && git diff --check`: passed with 52 tests passed and the same 2 Windows-only signal cases skipped.
- No BotChecker API listener or Minecraft connection was created by the skipped integration cases.
- Graceful direct-entrypoint `SIGINT`/`SIGTERM` shutdown remains runtime-unverified on Windows. The harness must run on POSIX CI or another environment that delivers catchable signals before this gate can be declared passed; the earlier npm-shell orphan issue is not resolved by the harness alone.

Offline protocol diagnostic gate on 2026-08-15:

- Dependency/source inspection confirmed Mineflayer `4.37.1` uses minecraft-protocol `1.66.2` and Protodef `1.19.0`. `minecraft-protocol` attaches the failing decompressed frame to parser errors before forwarding them, while `raw`/`packet` events are emitted only after successful parsing.
- TDD RED was observed first because `src/protocol-diagnostic.ts` did not exist, then because the opt-in runner integration returned no protocol diagnostic. The minimal implementation made both tests pass.
- `node --import tsx --test test/protocol-diagnostic.test.ts test/runner-session.test.ts`: passed, 11 tests.
- Full ordered gate `npm run typecheck && npm test && npm run build && git diff --check`: passed, 55 tests passed and 2 Windows-only signal cases skipped.
- No Minecraft connection, API listener, server operation, deployment, reload, restart, or production change was performed. The intermittent decode failure and diagnostic output remain runtime-unverified.

POSIX shutdown CI gate preparation on 2026-08-15:

- Added `.github/workflows/posix-shutdown.yml` with `push` and `pull_request` triggers, read-only `contents` permission, `ubuntu-latest`, Node.js 22, locked `npm ci`, and a 10-minute job timeout.
- The workflow runs `npm run typecheck`, the focused direct-entrypoint shutdown integration harness, `npm test`, then `npm run build`. It uses no secret, service, Minecraft connection, server operation, or artifact upload.
- Focused local Windows command `node --import tsx --test test/process-shutdown.test.ts test/direct-entrypoint-shutdown.integration.test.ts`: 2 tests passed and the 2 POSIX signal cases skipped with the explicit Windows signal-semantics reason.
- Static workflow policy check passed 8 assertions covering triggers, permission, runner, timeout, Node version, locked install, and verification order.
- Full local ordered gate `npm run typecheck && npm test && npm run build`: passed with 55 tests passed and the same 2 Windows-only signal cases skipped.
- Repository-wide whitespace inspection covered 46 text files and found two pre-existing untracked test files without a final newline: `test/entity-observer.test.ts` and `test/runner-session.test.ts`. They were preserved unchanged; the new plan, workflow, and this state update have no trailing whitespace and end with a newline.
- This is local Windows validation only. The workflow has not run on GitHub Actions/Ubuntu, so graceful direct-entrypoint `SIGINT`/`SIGTERM` shutdown is still not POSIX runtime-verified.

Crossing identity-window hardening on 2026-08-15:

- Regression runner-level tái hiện entity trùng tên spawn rồi biến mất hoàn toàn giữa hai `sampleMs`; trước fix trajectory crossing vẫn PASS, sau fix trả `INCONCLUSIVE_IDENTITY` và gỡ đủ listener `entitySpawn`/`entityUpdate`/`entityMoved`/`entityGone`.
- Các lát TDD tiếp theo tái hiện và sửa riêng ambiguity do custom-name metadata (`entityUpdate`), entity range (`entityMoved`) và observer range (`move`) đổi thoáng qua giữa hai poll, trajectory nối sai qua `death`/`respawn`, và excursion geometry ngoài aperture hoàn toàn giữa hai poll. Crossing oracle có regression RED→GREEN cho chuyển động chậm qua deadband, event geometry không tự tăng exit confirmation, hủy proof khi rời corridor/vertical aperture, không tái dùng entry cũ sau backtrack, và vẫn cho phép arm một trajectory mới khi entity quay lại đủ entry clearance.
- Focused crossing/entity/scenario/runner/report gate: 51/51 pass.
- Full ordered gate `npm run typecheck && npm test && npm run build`: 68 pass, 0 fail, 2 POSIX signal tests skipped có chủ đích trên Windows; typecheck và build pass. `git diff --check` pass.
- Snapshot source/test đã kiểm chứng: `src/crossing.ts` SHA-256 `e90bfa0ba772ff69b951f467e158139fffeafecaa5788f837b81f12b1d6d901e`; `src/entity-observer.ts` `0853919ef9d5b5e1989a9d54c86b26f4881e517fb3cb79fc63c87b76e8293d3a`; `src/scenario.ts` `0c5daca38be0958e55af3e24a52abda1f805cc0939fc2311cccc30d8927a707e`; `src/runner.ts` `b02fe01a17586395735a7dff33d792c6ea2dbd9c36b0dfbb82ea72b6acaaa8da`; `test/crossing.test.ts` `3f98ff74dd0e84d8ce73221442eff18ada89e5c464ed74b61138c33511215f3b`; `test/runner-session.test.ts` `fec70ff4d0f1c3d65d701d5f338b97886991a53ec1275270ff5f8fed4266c98c`.
- Không kết nối Minecraft, mở API listener, deploy, reload, restart hoặc thay đổi server trong slice này.

Bounded Citizens metadata probe on 2026-08-15:

- Ran one direct-entrypoint, read-only probe against the already-running authorized local Paper server at `127.0.0.1:11619` with the dedicated offline tester. The scenario waited three seconds, inspected only the existing client entity stream within 48 blocks, asserted health/food/closed GUI, and sent no command, click, movement, teleport, or NPC interaction.
- Run `5b70d8d2-70f1-4f85-bc56-edc1ca79c785` passed. Report: `reports/5b70d8d2-70f1-4f85-bc56-edc1ca79c785.json`.
- The probe proved that hosted Citizens NPCs can appear to Mineflayer as player entities with both `username` and `customName`: `Jumonka` and `Alaric` were present in the bounded snapshot. This validates the client-visible identity source for those hosted NPCs and rejects the broad hypothesis that Mineflayer cannot read Citizens custom names on this server.
- Follow-up run `dc533701-e3d0-4f7b-996f-bcd006ab04d0` live-verified the existing `assert_nearby_entity` locator against hosted Citizens NPC `Jumonka` at 24.65 blocks. The run passed in 3,749 ms with health/food `20/20` and closed GUI; it still sent no command, click, movement, teleport, or NPC interaction. Report: `reports/dc533701-e3d0-4f7b-996f-bcd006ab04d0.json`.
- `ThanhRedfield` was not present in that snapshot. The tester spawned at `StillCliff:23.5,-60,-18.5`, while the server log placed `ThanhRedfield` around `73,-61,-80` during the probe, approximately 79 blocks away and therefore outside the scenario's 48-block bound. This run does not prove or disprove direct matching of `ThanhRedfield`; the absence was an expected tracking-range limitation, not a locator defect.
- Follow-up direct smoke `4785e1f3-11d9-4a6f-8cce-5ff72fd8d134` attempted to walk the tester with the existing pathfinder from spawn to the latest observed `ThanhRedfield` area near `StillCliff:74,-61,-80`. The precondition passed, but `go_to` timed out after 45,014 ms at approximately `StillCliff:33.7,-59.6,-21.8`; the run never reached the entity assertion. No teleport or command was used.
- A second bounded waypoint smoke `c4e19b0f-1ddf-49ee-bcaa-c7f432c44a01` attempted a shorter first leg to `StillCliff:45,-60,-35`, then further waypoints. It also timed out on the first leg after 20,010 ms, with the tester still near `StillCliff:33.7,-60,-21.75`. This isolates the current blocker to the authorized fixture's walkable route/pathfinder geometry, not the Citizens identity locator. Reports are retained under `reports/`.
- Added a RED→GREEN regression for bounded missing-entity diagnostics and retained the safe range rather than widening it or force-loading chunks. Focused test and typecheck passed. Full ordered gate `npm run typecheck && npm test && npm run build` passed with 71 pass, 0 fail, and 2 POSIX signal tests skipped intentionally on Windows; build passed.
- The temporary BotChecker API was stopped and ports `8080`/`18080` were clean afterward. Paper remained running on its existing PID `43004`; no deploy, reload, restart, live YAML edit, or production operation occurred.

## Bounded performance research and passive load observation on 2026-08-15

- Research notes are stored in `docs/performance-threat-model.md`. Sources include Paper profiling/world configuration docs, Paper 1.21.11 inventory/crafting/redstone API docs, and the Java Edition protocol packet reference.
- Threat model separates GUI/container transaction load, item entity/NBT/component load, inventory crafting load, and redstone/block-update load. Redstone remains research/detection only and was not placed, activated, or mutated.
- Added schema action `observe_load`. It is passive only: duration max 30 seconds, sample interval min 100 ms, range max 48 blocks, max 64 entities, max 46 inventory items. The report explicitly returns `mutation: none`; it does not open GUI, click, craft, drop, place, chat, or send raw packets.
- Added schema regression coverage for all passive-observation bounds. Full ordered verification passed: typecheck, 74 tests with 72 pass and 2 intentional Windows signal skips, and build.
- Live journey report `reports/82c3c582-a150-40d2-b41c-fd0b59970d3e.json` records 2 passed preconditions and a bounded `ThanhRedfield` locator timeout after 8,007 ms. No right-click, GUI click, crafting, item mutation, redstone operation, command, teleport, or world change occurred. The temporary BotChecker API/listener was stopped and verified absent; Paper remained untouched.
- No active load benchmark is authorized or claimed. Active GUI/crafting/item testing requires an isolated approved fixture with baseline, rate/volume/payload/time limits, telemetry, stop thresholds, and cleanup. Redstone is prohibited in execution.

## Latest bounded live probe on 2026-08-15

- Approved read-only run `2ce81966-1abd-4fb1-a0ac-5b282f08a460` used the direct entrypoint with `MC_VERSION=1.21.11` against `127.0.0.1:11619` and account `HeoMC_Tester`. Negotiated version was `1.21.11`, protocol `774`, dimension `overworld`, and spawn `StillCliff:33.6993,-60,-21.7460`.
- `assert_state` passed with health/food `20/20` and closed GUI. Bounded `inspect_entities` within 48 blocks found only the tester itself; `ThanhRedfield` locator timed out after 8,003 ms. No command, teleport, GUI click, or NPC interaction occurred.
- Paper log evidence around the observation window places `ThanhRedfield` at approximately `StillCliff:75,-61,-80`, roughly 80 blocks from the tester and outside the 48-block client observation bound. The NPC repeatedly transitions `INACTIVE -> GOING_TO_BED`, then returns `GOING_TO_BED -> INACTIVE` after `reason=STUCK`; this is an unstable fixture, not evidence of a BotChecker identity-locator defect.
- Report: `reports/2ce81966-1abd-4fb1-a0ac-5b282f08a460.json`. BotChecker API was stopped and `18080`/`8080` listeners were verified absent; Paper remained on port `11619`, PID `43004`.
- Do not retry the same spawn or widen the 48-block bound. A meaningful next live gate requires an authorized stable fixture with the tester already within normal tracking range of `ThanhRedfield`, or an approved server-side fixture change. No such change was made in this BotChecker-only task.

## ThanhRedfield identity-only contract on 2026-08-15

- Added optional schema field `requiredUuid` to `assert_nearby_entity`. When present, bounded matching requires the configured UUID as well as the identity label; a same-name entity with another UUID returns `INCONCLUSIVE_IDENTITY` instead of falling back to the nearest candidate.
- Successful UUID assertions now include the exact verified `uuid` in step evidence. Name-only assertions preserve their existing evidence shape.
- Added `scenarios/citizens-thanhredfield-identity-only.json`, a read-only four-step gate using UUID `46a5553d-cedc-428f-b51a-4f5ddec03c9b`. It contains only `assert_state`, bounded `inspect_entities`, exact `assert_nearby_entity`, and final `assert_state`; it has no movement, command, teleport, GUI click, pathfinding, or entity interaction action, and retains the 48-block maximum.
- TDD coverage includes schema acceptance/rejection, UUID filtering under a name collision, missing-required-UUID fail-closed behavior, runner-level same-name/wrong-UUID failure, exact UUID report evidence, and a repository fixture policy test that rejects mutating or movement actions in this identity-only scenario.
- Focused identity tests passed: 3/3. Full local verification passed: `npm run typecheck`; `npm test` with 78 passed, 0 failed, and 2 intentional Windows signal skips; `npm run build`; relevant-file whitespace validation.
- This slice made no Minecraft connection, opened no API listener, and did not deploy, reload, restart, modify, or interact with Paper/LivingNPC. The identity-only scenario is implemented but not live-verified; the prior fixture remains outside the bounded tracking range and unstable.

## Exact-identity interaction contract on 2026-08-15

- Added optional `requiredUuid` support to `interact_entity`. When configured, initial selection uses the existing bounded unique-identity observer instead of `nearestEntity`; same-name/wrong-UUID, missing, out-of-range, and ambiguous candidates fail closed without calling `activateEntity`.
- The runner pins entity ID, UUID, and object identity, then revalidates after optional pathfinding and again after asynchronous `lookAt`, immediately before activation. Disappearance, object replacement, UUID mutation, or a duplicate matching identity during either race window returns an inconclusive identity/tracking result and performs no interaction.
- Successful pinned interaction evidence records the exact verified UUID. Legacy interaction scenarios without `requiredUuid` retain their previous name-only behavior for compatibility.
- `scenarios/citizens-thanhredfield-player-journey.json` now pins interaction to UUID `46a5553d-cedc-428f-b51a-4f5ddec03c9b` with the existing 48-block locator bound. A fixture regression prevents that UUID requirement from being removed accidentally.
- Plan artifact: `.hermes/plans/2026-08-15-interact-entity-exact-identity.md`.
- RED evidence reproduced the defect before the runner fix: with two same-name entities, `interact_entity` activated entity ID 1 even though `requiredUuid` identified entity ID 2. Schema and fixture tests also failed before their corresponding changes.
- Focused exact-interaction/schema gate passed: 10/10. `npm run typecheck`, `npm run build`, and relevant-file `git diff --check` passed.
- The earlier five concurrent `observe_crossing` fixture failures have been resolved by pairing each configured `gateBlock` with the exact two block-center endpoints LivingNPC controls. Current full local verification is green: `npm run typecheck`; `npm test` with 101 tests, 99 passed, 0 failed, and 2 intentional Windows signal skips; `npm run build`; `git diff --check`. SHA-256 of every paired source/test/scenario file matched before and after this full gate.
- The coordinated release fixture is read-only and pins Alex UUID `3d1d6e6d-6f19-4214-b794-f3ba0c202a1d`, server world `StillCliff`, dimension `overworld`, door block `(-17,-60,-67)`, approach `(-17.5,-60,-66.5)`, and exit `(-15.5,-60,-66.5)`. Schema validation rejects paired endpoints that are not axis-aligned and exactly one block on each side of the configured gate center. Runner evidence records expected and observed world/dimension plus the runtime gate name/facing/half/open state read from Mineflayer's client chunk cache. It fails closed when the block is unavailable, no longer a lower door/fence gate, faces the wrong axis, is replaced transiently, or its chunk unloads; normal open/close state changes remain valid and all gate listeners are removed during cleanup.
- This slice made no Minecraft connection, opened no API listener, and did not deploy, reload, restart, modify, or interact with Paper/LivingNPC. The hardened interaction path is locally verified only and has not been run live.

## Next Integration Gate

Run `scenarios/restaurant-tycoon-ordering-gui.json` only on an authorized isolated RestaurantTycoon fixture with PostgreSQL ready, `plot_1` owned by the dedicated tester, and structurally complete central/restaurant supply setup. The current gate must stop at the payment-confirmation GUI; it must not click `Thanh toán` until a separate mutating order/payment test is explicitly approved with balance, durable order, rollback, and cleanup assertions. Delivery, package handoff, and warehouse journeys remain blocked because the product runtime is not implemented.

Run `scenarios/citizens-thanhredfield-identity-only.json` only under separate authorization and from a safe position already within the normal client tracking range of `ThanhRedfield`, then assert the exact hosted NPC by UUID as well as name without command, GUI click, teleport, movement, pathfinding, or interaction. Treat absence outside the 48-block stream as an inconclusive fixture, not a reason to retry blindly or weaken the contract. The current local fixture cannot reach that area through `go_to` from the tester spawn: both a direct route and a short first waypoint timed out. Do not widen the 48-block bound, force-load chunks, or use `/tp` merely to make the assertion pass. Obtain a real successful run of the direct-entrypoint shutdown workflow on POSIX CI and retain readiness/PID/listener ownership checks before unattended scheduling.

Continue the first-login protocol decode investigation with repeated fresh-process runs and packet-level diagnostics; the current evidence proves the pinned process negotiated protocol 774 but does not isolate the original intermittent failure.

Before any such run, obtain explicit approval for the target/server/account and enable `PROTOCOL_DIAGNOSTICS=true` only on a fresh direct process with readiness, PID, port ownership, bounded run count, and cleanup checks. The redact-safe diagnostic can identify the failing field and correlate repeated frames, but a separately approved, securely handled raw-frame capture is still required before creating a replay fixture or claiming the exact packet/component/root cause.

Calibrate `scenarios/npc-quest.json` against an authorized isolated test server and
record exact NPC names, coordinates, expected GUI text, plugin/dependency versions,
and the generated report path.

## Repository Boundary

The active LivingNPC repository is `E:\AI.WORK\living-npc-plugin`. Old nested copies
are historical and must not be edited from this project.

## LivingNPC crossing observer attempt — 2026-08-20

- Target was isolated Paper clone `E:\AI.WORK\living-npc-paper-clean-smoke`, port `25578`; no production connection.
- BotChecker API used loopback port `18084`; run ID `860b0ca1-b648-4285-a75f-fbe8b8e0735e`.
- Run failed before scenario step execution. Server kicked client with `Internal Exception: io.netty.handler.codec.DecoderException: Failed to decode packet 'serverbound/minecraft:hello'`.
- This is a BotChecker/Minecraft protocol connection failure, not crossing evidence and not evidence of LivingNPC navigation or door behavior.
- Earlier persisted-spawn run on the same isolated target negotiated protocol `774` and passed entity visibility. Therefore protocol compatibility is intermittent or startup/run-state dependent; root cause remains `UNKNOWN`.
- `PROTOCOL_DIAGNOSTICS=true` remains required for a fresh bounded reproduction. Diagnostics must record only bounded field, frame length, and frame SHA-256; never raw frame bytes or credentials.
- Paper log also showed `UnsupportedClassVersionError` for WorldEdit/WorldGuard class file `69` under Java `21.0.4` (maximum `65`), so those dependencies were unavailable in this run. This is a fixture dependency mismatch and invalidates WorldGuard runtime conclusions.
- Do not retry crossing observer until fixture plugins are Java-21-compatible and BotChecker readiness/handshake is independently green.

## Plugin QA Platform Phase 1 — offline contract gate

- Added `docs/PLUGIN_QA_PLATFORM_PHASE_1.md` defining black-box multi-project QA boundary, persistence/restart, permission matrix and negative/security contracts.
- Scenario/report metadata now supports project, fixture, account role, authorization and phase without credentials.
- Added bounded pure evaluators: `src/persistence-contract.ts`, `src/permission-contract.ts`, `src/permission-matrix.ts`, `src/negative-contract.ts`.
- Regression coverage: persistence before/after restart evidence, permission allow/deny state invariants, matrix aggregation, negative reject/no-mutation and credential/evidence bounds.
- Full local gate after this slice: `npm run typecheck`, `npm test` (`185` pass, `0` fail, `2` intentional Windows signal skips), `npm run build`, `git diff --check` pass.
- Evidence level: offline contract/unit verification only. No live server, restart, multi-account permission matrix or production operation performed.
- Remaining: connect contracts to scenario/report execution, add external restart context, add multi-account runner, then run only on authorized isolated fixture.
- Persistence execution linkage now exists in `src/qa-execution.ts`; reports can carry bounded `executionId`, `beforeRunId`, `afterRunId`, `side` metadata. Same run ID is `INCONCLUSIVE`; credential-like IDs reject.
- `TestRun` accepts optional `qaExecution` and writes linkage into manifest. This remains metadata/evaluator support only; BotChecker still does not restart server.
- Full local gate after linkage: `npm run typecheck`, `npm test` (`191` pass, `0` fail, `2` intentional Windows signal skips), `npm run build`, `git diff --check` pass.
- Added `src/persistence-coordinator.ts`: bounded state machine requires before snapshot, then externally supplied authorized/observed restart evidence, then after snapshot. It never controls or restarts server.
- Coordinator regression suite: `5` tests pass; full gate after coordinator is `196` pass, `0` fail, `2` intentional Windows signal skips.
- Added `src/permission-plan.ts`: bounded multi-account permission plan. Each cell carries account reference, role/action and authorization; missing authorization is `INCONCLUSIVE`, duplicate account/action and credential-like account refs reject.
- Permission plan regression suite: `5` tests pass; full gate after plan is `201` pass, `0` fail, `2` intentional Windows signal skips.
- Evidence remains offline only. No multi-account live execution, server restart, deployment or production action performed.
- Added `src/negative-plan.ts`: bounded multi-account negative/security plan. Each case carries account reference, case ID and authorization; missing authorization is `INCONCLUSIVE`, mutation or accepted reject request is `FAIL`, duplicate/credential-like identifiers reject.
- Negative plan regression suite: `5` tests pass; full gate after plan is `206` pass, `0` fail, `2` intentional Windows signal skips.
- Evidence remains offline contract verification. No live negative/security run performed.
- Added `src/qa-plan-report.ts`: bounded report contract for permission/negative-security plans. `RunManifest.qaPlan` now carries validated verdict, summary, account refs and cell evidence counts; raw authorization and payload are excluded.
- QA plan report regression suite: `3` tests pass; full gate after manifest linkage is `209` pass, `0` fail, `2` intentional Windows signal skips.
- Runner accepts validated `qaPlan` through dependency input only; it does not execute multi-account plans, grant authorization, restart server or deploy.
- Added `src/multi-account-runner.ts`: callback-based sequential orchestrator; account execution starts only with authorization, executor errors become `INCONCLUSIVE`, FAIL propagates, evidence is bounded and credential-like evidence rejects.
- Multi-account runner regression suite: `5` tests pass; full gate after runner is `218` pass, `0` fail, `2` intentional Windows signal skips.
- Runner remains caller-controlled. It does not read credentials, create authorization, deploy, restart or control production.
- Added `src/multi-account-report.ts`: converts multi-account runner result into validated `qaPlan` cells for manifest; preserves per-account verdict/summary and bounded mutation count, excludes authorization/raw evidence.
- Multi-account report regression suite: `3` tests pass; full gate after report adapter is `221` pass, `0` fail, `2` intentional Windows signal skips.
- Evidence remains offline. No live multi-client run, account provider, server restart or production operation performed.
- `TestRun` now accepts `multiAccountResult` and builds validated `qaPlan` manifest metadata through `buildMultiAccountQaPlan`; caller no longer needs manual mapping.
- Full gate after runner-to-manifest linkage: `224` pass, `0` fail, `2` intentional Windows signal skips. No live multi-account, account provider, restart or deployment performed.
- Added `src/persistence-report.ts`: converts persistence execution result into bounded manifest evidence; keeps execution IDs, restart evidence ID and changed keys, excludes raw state payload.
- `TestRun` accepts `persistenceResult` and writes persistence report metadata without controlling restart.
- Persistence report regression suite: `3` tests pass; full gate after persistence report linkage: `224` pass, `0` fail, `2` intentional Windows signal skips.
- Evidence remains offline. No live restart, account provider, deployment or production action performed.
- Added `src/persistence-runner.ts`: before → caller-provided external authorized/observed restart → after orchestration; provider failure or missing authorization returns `INCONCLUSIVE`, never controls server restart.
- Persistence runner regression suite: `3` tests pass; callback order verified as `before`, `restart`, `after`.
- Full gate after persistence runner: `227` pass, `0` fail, `2` intentional Windows signal skips; typecheck/build/diff check pass.
- Added `src/authorized-plan-runner.ts`: permission/negative plans execute sequentially through caller-provided provider callbacks; missing authorization skips provider, provider failure becomes `INCONCLUSIVE`.
- Authorized plan runner regression suite: `3` tests pass; full gate after runner is `230` pass, `0` fail, `2` intentional Windows signal skips.
- Evidence remains offline. No live account provider, permission run, negative/security run, deployment or production action performed.
- Added `src/compatibility-matrix.ts`: bounded evaluator for Minecraft/Paper/plugin targets; compares observed protocol, negotiated version, plugin presence and scenario result.
- Compatibility matrix regression suite: `4` tests pass; full gate after compatibility slice is `234` pass, `0` fail, `2` intentional Windows signal skips.
- Compatibility evidence remains offline. Missing runtime evidence is `INCONCLUSIVE`; mismatch is `FAIL`; no live server/version compatibility claim made.
- Added `src/compatibility-report.ts` and `RunManifest.compatibility`; `TestRun` now accepts `compatibilityResult` and stores bounded target metadata, verdict, summary and evidence.
- Compatibility report regression suite: `2` tests pass; full gate after manifest linkage is `236` pass, `0` fail, `2` intentional Windows signal skips.
- No live compatibility matrix, server deployment, restart or production operation performed.
- Added `src/transaction-contract.ts`: bounded economy transaction evaluator for complete/reject expectations, balance/item deltas and no-mutation rejection.
- Transaction contract regression suite: `5` tests pass; full gate after transaction slice is `241` pass, `0` fail, `2` intentional Windows signal skips.
- Transaction evidence remains offline. No live economy provider, balance mutation, transaction execution, deployment or production action performed.
- Added `src/transaction-report.ts` and `RunManifest.transaction`; `TestRun` now accepts `transactionResult` and stores bounded transaction evidence without raw before/after state.
- Transaction report regression suite: `3` tests pass; full gate after report linkage is `244` pass, `0` fail, `2` intentional Windows signal skips.
- No live economy provider, transaction execution, deployment, restart or production operation performed.
- Added `src/transaction-runner.ts`: caller-provided before snapshot and transaction executor boundary; provider/validation failure returns `INCONCLUSIVE`, with no economy/server control.
- Transaction runner regression suite: `4` tests pass; full gate after provider boundary is `248` pass, `0` fail, `2` intentional Windows signal skips.
- Added `src/transaction-idempotency.ts`: bounded duplicate-submit evaluator; repeated same transaction must not add balance/item mutation, missing attempt evidence is `INCONCLUSIVE`, duplicate mutation is `FAIL`.
- Idempotency regression suite: `4` tests pass; full gate after idempotency slice is `252` pass, `0` fail, `2` intentional Windows signal skips.
- Added `src/crash-recovery-contract.ts`: bounded evaluator for authorized crash boundary and recovery readiness; missing authorization/observation is `INCONCLUSIVE`, observed non-ready recovery is `FAIL`.
- Crash/recovery regression suite: `5` tests pass; full gate after crash/recovery slice is `257` pass, `0` fail, `2` intentional Windows signal skips.
- No process kill, restart, deployment or production action performed.
- Added crash/recovery report + runner, GUI/inventory evaluator, gameplay journey evaluator and multi-client aggregate evaluator.
- New regression suites: crash report/runner `4` tests, GUI `4`, gameplay `4`, multi-client `4`; full gate after these slices is `273` pass, `0` fail, `2` intentional Windows signal skips.
- Crash/recovery report + runner được nối vào `RunManifest.crashRecovery`; GUI/gameplay/multi-client reports hiện được nối lần lượt vào `RunManifest.gui`, `RunManifest.gameplay`, `RunManifest.multiClient`.
- GUI, gameplay và multi-client report regression suites: `4` tests pass; full gate after report linkage is `277` pass, `0` fail, `2` intentional Windows signal skips.
- These remain offline contracts; no live client provider, isolated fixture, deployment, restart or production operation performed.
- Added `src/gui-runner.ts`, `src/gameplay-runner.ts`, `src/multi-client-runner.ts`: caller-provided provider boundaries; GUI runs before-click-after, gameplay runs ordered steps, multi-client runs sequentially; provider failures are `INCONCLUSIVE`.
- Journey runner regression suite: `5` tests pass; full gate after provider runners is `282` pass, `0` fail, `2` intentional Windows signal skips.
- Added `src/compatibility-runner.ts`: caller-provided target observation boundary, sequential target execution, provider failure mapped to bounded `INCONCLUSIVE` target results.
- Compatibility runner regression suite: `2` tests pass; full gate after compatibility provider boundary is `284` pass, `0` fail, `2` intentional Windows signal skips.
- LivingNPC Farmer/pathfinding capability assessment is `LOCAL_REPLAY_VERIFIED_NOT_PAPER_RUNTIME`. Added a strict read-only fixture scenario, RouteOracle replay regression and sanitized local validator artifact. Focused route/telemetry gate passed `18/18`; full BotChecker gate passed `286`, failed `0`, with `2` intentional Windows signal skips; typecheck/build/diff check pass.
- BotChecker can receive Farmer/pathfinding verification via exact UUID, continuous ordered route/gate geometry and telemetry diagnostics. Current LivingNPC artifact on controlled Paper was not run; production was not connected or changed. Handoff: `docs/FARMER_PATHFINDING_CAPABILITY_HANDOFF_2026-08-25.md`.
