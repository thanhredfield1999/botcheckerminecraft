# BotChecker capability gap report — 2026-08-27

## Kết luận

BotChecker hiện đã có nền tảng tốt cho scenario Mineflayer đơn client, GUI read-before-click, entity pinning, route/crossing oracle, bounded telemetry và nhiều QA contract offline. Tuy nhiên, phần lớn kiểm chứng release-gate phức tạp vẫn phải dùng script/probe riêng vì BotChecker chưa có lớp live provider, orchestration Paper, evidence sealing và primitive client/server đủ sâu.

Ưu tiên nên làm theo thứ tự:

1. **P0 — thống nhất canonical repo và khóa provenance**;
2. **P0 — live provider/orchestration an toàn cho Paper**;
3. **P0 — evidence bundle append-only, bind exact candidate/runtime**;
4. **P1 — multi-client đồng thời và primitive inventory/entity/packet**;
5. **P1 — GUI component/state-machine và protocol replay**;
6. **P2/P3 — assertion DSL, visual merge, trend/dashboard**.

Báo cáo này phân biệt:

- `OBSERVED`: trực tiếp thấy trong source hoặc runtime evidence hiện tại;
- `NEEDED`: capability cần bổ sung;
- `BOUNDARY`: điều BotChecker client không thể tự chứng minh, cần trusted server-side probe/provider.

## Baseline đã có

`E:\AI.WORK\botcheckerminecraft-botchecker` hiện có:

- scenario schema và runner Mineflayer;
- timeout/cancel lifecycle, cleanup listener và client;
- read-before-click, chặn selector GUI mơ hồ và chặn stale GUI ID trước click;
- entity inspection, UUID pinning, crossing/route oracle, gate/fence evidence;
- bounded load observation, route pixel map;
- permission, persistence, compatibility, transaction, crash-recovery, GUI, gameplay và multi-client **contract/evaluator**;
- protocol error summary giới hạn ở field, frame length và SHA-256;
- report có scenario SHA-256, runner version, protocol/world/dimension quan sát được.

Không được báo lại các mục trên là “chưa có”. Gap nằm ở wiring live, độ sâu oracle và provenance.

---

## P0 — phải xử lý trước khi mở rộng tính năng

### P0.1. Chọn một canonical repo và hợp nhất hai nhánh capability

**IMPLEMENTATION STATUS — 2026-08-27**

- `VERIFIED offline partial`: canonical workspace hiện phát sinh capability manifest bind Git dirty/commit, package/lock/dependency hashes, exact loaded `src` hoặc `dist/src` tree và capability mode `runtime-wired|library-only` vào report.
- Chưa merge vision/OCR từ implementation còn lại và chưa có CI/release policy cấm source dirty. Vì vậy P0.1 giữ `PARTIAL`.

**OBSERVED**

- `E:\AI.WORK\botcheckerminecraft-botchecker` và `E:\AI.WORK\botcheckerminecraft` cùng trỏ remote `thanhredfield1999/botcheckerminecraft` nhưng có working tree rất khác nhau.
- Repo `-botchecker` chứa route oracle, QA contracts và khoảng 286-test working state.
- Repo không hậu tố chứa vision/OCR/frame authorization nhưng đồng thời là working tree/monorepo LivingNPC, có source BotChecker khác và không có `CURRENT_STATE.md` riêng.
- Phần lớn capability mới ở repo `-botchecker` vẫn là modified/untracked so với `origin/main` commit `3339f22`.

**Rủi ro**

- Sửa nhầm repo; mất tính năng khi copy/cherry-pick; CI kiểm nhánh không chứa runtime source thực tế.
- Không thể xác định “BotChecker version X” đã gồm route, vision hay QA providers nào.

**NEEDED**

- Chọn `E:\AI.WORK\botcheckerminecraft-botchecker` làm canonical workspace hoặc quyết định khác một lần duy nhất.
- Import vision/OCR bằng commit có review, không copy tay giữa hai dirty trees.
- Mỗi build sinh `capability-manifest.json`: Git commit, dirty-state flag, source fingerprint, lockfile hash, Node version, dependency versions và enabled capabilities.
- CI chạy typecheck/test/build trên canonical repo; cấm release từ source dirty không có exact fingerprint.

**Acceptance**

- Một đường dẫn canonical được ghi ở README/AGENTS/CURRENT_STATE.
- Không còn hai implementation độc lập của `runner.ts`/`scenario.ts`.
- Report runtime luôn bind exact capability manifest.

### P0.2. Live provider registry thay cho callback skeleton

**OBSERVED**

Các file `persistence-runner.ts`, `crash-recovery-runner.ts`, `gui-runner.ts`, `gameplay-runner.ts`, `multi-client-runner.ts` chủ yếu nhận callback `before/restart/after`, `crash/recovery`, `observe`, v.v. API `server.ts` hiện chỉ tạo `TestRun` từ một scenario Mineflayer; không có endpoint/provider wiring cho các evaluator trên.

**Tác động thực tế**

- ItemGuard phải dùng Python sealer + Java smoke probe + Mineflayer `.mjs` riêng.
- ForceItem/BastionForge duy trì hàng chục journey script riêng cho restart, hard-kill, concurrency, combat, GUI và packet.
- Contract unit xanh không đồng nghĩa live provider đã tồn tại.

**NEEDED**

- Provider registry typed, ví dụ:
  - `minecraft-client`;
  - `paper-process`;
  - `server-probe`;
  - `filesystem-snapshot`;
  - `sqlite-readonly`;
  - `log-observer`;
  - `vision-frame`.
- Provider declaration phải có capability, scope, authorization ID, target root và mutation class.
- Plan compiler phải fail-closed nếu thiếu provider; không silently `skipped` rồi tổng hợp thành kết quả dễ hiểu nhầm.
- Endpoint submit `authorizedPlan`, không chỉ tên scenario.

**Acceptance**

- Có một controlled fixture chạy end-to-end persistence `before → clean restart → after` hoàn toàn qua BotChecker.
- Report ghi provider identity/version, authorization và từng boundary.
- Thiếu provider trả reason code có cấu trúc `INCONCLUSIVE_PROVIDER_UNAVAILABLE`.

### P0.3. Paper process orchestration an toàn và có approval boundary

**OBSERVED**

BotChecker không tự có Paper lifecycle provider. Các run thật phải dùng Python/Node ngoài để:

- kiểm port/session lock;
- backup/restore fixture;
- start JVM và chờ `Done (`;
- chạy bot/probe;
- gửi `stop`, chờ save marker/JVM exit;
- kiểm port/PID/log và archive evidence.

`crash-recovery-runner.ts` chỉ gọi callback bên ngoài; chưa thực thi/kiểm chứng crash boundary.

**NEEDED**

- `PaperProcessProvider` chỉ hoạt động với isolated approved root.
- Guard bắt buộc:
  - root allowlist và reject production path mặc định;
  - exact Paper/candidate/probe hashes;
  - port/PID/session-lock offline check;
  - zero-player check trước mutation;
  - readiness marker + health probe;
  - clean `stop` và natural JVM-exit proof;
  - hard-kill chỉ với explicit crash authorization, exact PID/boot token;
  - backup/restore byte-identical, quarantine và read-back;
  - không `/reload`, PlugMan hoặc broad process kill.
- Boot/restart phase token chống nối nhầm evidence giữa hai JVM.

**Acceptance**

- Dry-run hiển thị toàn bộ mutation trước khi chạy.
- Sai root/hash/port/PID/approval → fail trước JVM/file mutation.
- Clean restart và authorized crash test tạo evidence phase-bound, không cần orchestration script ngoài.

### P0.4. Evidence bundle append-only và exact candidate binding

**IMPLEMENTATION STATUS — 2026-08-27**

- `VERIFIED offline partial`: report và route-map artifacts hiện đi qua immutable writer bounded, temp `wx` + file fsync + hard-link create-new + read-back SHA-256; collision/concurrent writer/path traversal/size-bound regressions GREEN.
- `VERIFIED offline partial`: report nay còn bind exact Git/dirty state, package/lock/dependencies, loaded source/build fingerprints và capability modes; `sourceRevision` mâu thuẫn capability commit bị từ chối.
- `VERIFIED offline partial`: `<runId>.bundle.json` seal nay bind scenario/source context với sorted artifact graph (role/name/bytes/SHA-256) và canonical bundle hash. Verifier fail-closed với unknown schema, seal hash sai, missing/tampered/non-regular/oversized/changing artifact; writer snapshot toàn bộ bytes và bind exact report/seal filename với run ID trước mọi `await`.
- `VERIFIED offline partial`: persistence exception không còn để in-memory report giữ PASS giả; lỗi được surface bằng `persist_error` và non-cancelled run chuyển `failed/FAIL`. Route artifacts dùng ordinal filename an toàn; capability manifest được pin eager tại server creation và effective source revision phải khớp commit.
- `VERIFIED offline partial`: strict declared target binding bind Paper/candidate/config/optional-probe identities, provider và authorization vào report + seal. Artifact verifier exact-match expected binding, reject unbound/forged-runtime/stale/mismatch/tamper và luôn trả `releaseEligible:false`.
- Opus design review loại bỏ đường tự mint runtime proof từ file offline; correction/final reviews đều `PASS`, không blocker/high/medium. Full exact-tree gate `356 total / 354 pass / 0 fail / 2 skip`.
- `VERIFIED offline partial` (2026-08-28): library-only signed-provider claim verifier đã có strict configured Ed25519 key snapshot, verifier-issued nonce, canonical signature, exact provider/target/artifacts và synchronous one-time consume. Default compatibility store vẫn in-memory; optional SQLite store dùng local file, `BEGIN IMMEDIATE`, WAL/FULL sync, durable sequence/expiry/high-water, bounded global scopes/rate subjects/capacity, bounded retention, shared invalid-signature burn và per-key/provider fixed-window rate limits qua nhiều process. Hai Node process riêng chỉ cho đúng một consume winner; một child process giữ writer lock chứng minh busy timeout hoạt động dưới contention. Trust-store hash/policy được pin và consuming verifier re-authorize provider/binding/trust store; schema future/corrupt state, clock rollback/skew, transaction rollback và policy split-brain fail-closed.
- Independent proposal review chỉ PASS có điều kiện cho configured-key possession + fresh correlated claim; nó FAIL nếu được gọi runtime attestation. Opus 4.8 static correction review `0277f613-fb5f-4c19-8e87-c821b5b3cfcf` sau quota reset trả `PASS`, `0` blocker/high/medium cho boundary library-only/non-release; đây không phải runtime evidence.
- Chưa hoàn tất loaded-runtime proof và release binding: trusted key custody/provisioning, actual probe/JVM CodeSource/config observation, boot/server-instance truth, report/bundle/server integration, controlled Paper evidence, directory fsync policy và archive hash vẫn mở. SQLite store là library-only local-file primitive trên Node `22.18.0+` (module còn experimental), không phải distributed consensus/network-filesystem/HA proof. Database/WAL/SHM và private parent directory là security root; POSIX owner/mode được guard nhưng attacker đã có quyền ghi vẫn có thể inject/restore state vì chưa có keyed integrity MAC.
- Vì vậy P0.4 giữ trạng thái `PARTIAL`, không được dùng slice này để tuyên bố candidate/runtime provenance đã verified.
- `VERIFIED offline/test-only` (2026-08-28): một Java 21 fixture vector tạo canonical signed-provider claim bytes khớp byte-for-byte Node và chữ ký Ed25519 được verifier thật chấp nhận; Opus review `3b7884a6-7acf-4f83-ad67-ea3a7ca9f74a` PASS, full gate `375/373/0/2`. Đây chỉ là crypto interoperability fixture, không phải Paper probe/key custody/runtime proof.
- `VERIFIED offline/library-only` (2026-08-28): Java 21 JVM artifact observer core đã có bounded local regular-file `CodeSource` snapshot, anchor class-resource observation, loader/MRJAR caveats, fail-closed race/path/bounds/concurrency guards và capability-manifest v2 provenance cho source/build/classes. Mọi output hardcode non-authoritative/non-atomic/non-release và không chứng minh loaded bytecode. Opus correction `3c847af3-dc3b-4759-95ae-4d977ea694da` PASS production boundary; MRJAR portability correction `3a74e622-6b70-43e9-ac34-d1ee14a4cc5c` CLOSED; schema v2 review `7abba73d-ba80-45da-8c28-27d15081f843` PASS.
- `VERIFIED offline/library-only` (2026-08-28): strict Node observation assessment bind exact declared identity + whole-CodeSource file hash vào target binding, giữ structured hash/identity counter-evidence, surface class-resource consistency là informational và bind toàn canonical observation bằng SHA-256. Java `canonicalJsonUtf8V1` khớp Node byte-for-byte cho ASCII + supplementary Unicode. Opus `617fcd15-42d9-4897-b003-8d42ff0fc148` PASS; correction `1f6e79c3-8200-4655-8b8d-3316e6a9cedd` xác nhận 4 LOW CLOSED. Full gate `401/398/0/3`; symlink test skip trung thực do Windows `EPERM`.
- `VERIFIED offline/library-only` (2026-08-28): optional signed-provider profile `jvm-observation-bound-v2` pin profile vào challenge ID/shared SQLite state, ký canonical claims + raw JVM observation và tự assessment lại exact `candidate` CodeSource-file hash trước one-time consume. V1 downgrade bị chặn; Java production observation canonicalizer khớp Node trong test-only v2 signing vector. Result giữ `observationFreshness:not-established`, time `self-asserted-by-signer`, toàn caveat non-authoritative/non-atomic và `releaseEligible:false`. Focused gate `60/59/0/1`; full ordered gate `427/423/0/4`; Opus correction PASS, `0` blocker/high/medium.
- `VERIFIED offline/library-only` (2026-08-28): production Java canonical builder cho profile v2 đã snapshot/sort claims, validate exact candidate observation/hash và tạo bytes khớp Node cho supplementary Unicode cùng `provider.instanceId` absent/present. Producer-side cardinality/time-window checks là hardening trước ký, không phải observation-freshness/runtime truth. Builder không có signing/key/filesystem/environment API; capability chỉ xuất hiện khi exact Java source nằm trong auxiliary provenance. Focused correction `15/15/0/0`; full hậu-correction `430/426/0/4`; Opus correction PASS, `0` blocker/high/medium.
- `VERIFIED offline/library-only` (2026-08-28): canonical signature primitive strict-parse signed content v1/v2, canonicalize nội bộ và derive key/provider/binding/trust từ chính claims được ký; raw bytes + detached metadata không còn là API. Exact compiled Ed25519 key ở private trust snapshot; result không giữ bytes/key và pin freshness/replay/consume đều false. Verifier dùng chung primitive, giữ local/SQLite invalid-signature burn semantics. Focused final `34/34`; full `440/436/0/4`; Opus final correction PASS, `0` blocker/high/medium.
- `VERIFIED offline/library-only` (2026-08-28): bounded opaque signing adapter preflight exact trust/key/provider/binding/window, callback bằng canonical payload copy + opaque safe handle, recheck time và verify chữ ký độc lập trước khi tạo immutable v2 envelope. Timeout abort và giữ khóa instance tới callback settle; reentrancy, late result, mutation, wrong key/type, leakage và Java parity đều có regression. Focused final `46/46`; full `455/451/0/4`; Opus review/correction PASS, `0` blocker/high/medium. Đây chỉ là callback orchestration, không phải custody/HSM/KMS hay production signer transport.
- `VERIFIED offline/library-only` (2026-08-29): Google Cloud KMS backend D1 dùng official ADC client, pin exact `ENABLED`/`EC_SIGN_ED25519`/`HSM` key version và Ed25519 SPKI fingerprint, kiểm CRC32C request/response, verify chữ ký độc lập, bound timeout/payload và sanitize transport errors. Fake-HSM integration đi qua opaque adapter rồi verifier consume; capability không có server/report/Paper wiring. Focused gate `44/44`; full ordered gate hậu-hardening `473/469/0/4`, TypeScript/Java build và diff-check PASS. Máy hiện không có `gcloud`/ADC project, nên IAM least privilege, provisioning policy, real HSM signing operation và custody vẫn `NOT VERIFIED` và được tách sang D2.
- Correction review muộn phát hiện public-input/SDK-response hostile getter có thể ném message nhạy cảm trước vùng sanitize. Correction đã RED→GREEN cho ADC options, client methods, attestation/binding/sign inputs, `AbortSignal`, key/public/sign responses và protobuf checksum wrappers; field snapshots vẫn single-read. Focused correction `46/46`; full ordered gate `475/471/0/4`, TypeScript/Java build và diff-check PASS. Verdict FAIL trước correction supersede mọi review PASS của tree cũ; correction review riêng trả `PASS`, không blocker/high/medium.
- `VERIFIED offline/manual-tool` (2026-08-29): D2 thêm strict manual CLI `verify:kms-hsm` dùng trực tiếp ADC production flow, exact key-version + lowercase SPKI fingerprint + bounded timeout, một random 32-byte probe và chỉ trả `OBSERVED` sau D1 metadata/integrity/local-signature verification. Success report giữ hashed resource/probe provenance nhưng vẫn đặt custody, IAM least privilege, provisioning policy và runtime wiring false. Focused D2+D1 `54/54`; full ordered gate `483/479/0/4`, TypeScript/Java build và diff-check PASS; independent review `PASS`, không blocker/high/medium; local executable build trả exit `1` + đúng một bounded `NOT_VERIFIED` JSON line khi thiếu identifiers. Real live operation vẫn `BLOCKED / NOT VERIFIED` vì không có `gcloud`, standard ADC file/project env hay exact key resource/fingerprint; không thử resource giả, không provision hoặc sửa IAM.
- `VERIFIED offline/manual-tool` (2026-08-29): D3 nâng live report lên schema `2` và yêu cầu metadata consistent với generated-not-imported (`generateTime` hợp lệ, không import metadata, không reimport) cùng bounded HSM attestation format/content hash trước signing probe. Regression reject malformed protobuf timestamp/Long, imported/reimportable/missing metadata, shared backing store và giữ D1 không đọc getter D3 khi không yêu cầu. Đây chỉ là metadata posture: certificate chain/PKCS#11 attributes chưa được cryptographically verify, nên custody, IAM least privilege và provisioning policy vẫn false; focused D1–D3/adapter/capability `58/58`; independent Sonnet review `PASS`, không blocker/high/medium và hai LOW getter-coverage/local-cap wording đã đóng; full ordered gate `487/483/0/4`, TypeScript/Java build và diff-check PASS; live operation vẫn `BLOCKED / NOT VERIFIED`.
- `VERIFIED offline/library-only` (2026-08-29): D4a thêm exact `CAVIUM_V2_COMPRESSED` envelope verifier tương đối với hai caller-pinned root fingerprints. Primitive kiểm distinct CA roots whose certificate signatures verify under their embedded public keys, manufacturer/owner chain signatures, card/partition public-key cross-certification, certificate validity tại caller-supplied time, bounded gunzip và một RSA PKCS#1 v1.5/SHA-256 attestation signature. Nó cố ý giữ production trust roots, revocation/full RFC 5280 policy, trusted time, PKCS#11 attributes, resource/public-key binding, key-created-in-HSM, non-extractability và custody false. Tại checkpoint D4a capability chưa có runtime importer; D4c-b về sau trở thành sole direct importer. Focused D1–D4/adapter/capability `67/67`; full ordered gate `496/492/0/4`, TypeScript/Java build và diff-check PASS; exact correction review `PASS`, không blocker/high/medium và xác nhận prior M1 signature-negative coverage đã đóng. Production integration vẫn `BLOCKED / NOT VERIFIED` vì official Marvell root URL trả HTTP `403`; không pin mirror; tại checkpoint đó D3 preflight chưa request/call D4a.
- `VERIFIED offline/library-only` (2026-08-29): D4b enforce distinct root SPKI và distinct card/partition key; result schema `2` pin root SPKI cùng manufacturer/owner partition certificate và partition SPKI. Public-only vectors phủ card-key signature, exact compressed/decompressed bounds và truncation. Google owner root reproducible nhưng Marvell ZIP vẫn HTTP `403`, nên production trust set/rotation/cardinality, PKCS#11 parsing, resource/public-key binding và custody vẫn `BLOCKED / NOT VERIFIED`. Focused `71/71`; full `500/496/0/4`; hai independent read-only review đều `PASS`, không blocker/high/medium/low. Claude Sonnet không chạy được vì session quota.
- `VERIFIED offline/library-only` (2026-08-29): D4c-a thêm strict bounded Cavium V2 response/info/object/TLV parser và generated-Ed25519 PKCS #11 attribute-policy matcher. Nó reject size/offset/object mismatch, unknown/duplicate/truncated/trailing TLV, malformed bool/key ID/public-point shape; tại checkpoint đó capability không có runtime/network importer. Parser khi đó chưa compose với D4b signature verifier, vì vậy signature, HSM origin/non-extractability proof, resource/public-key binding, custody, live KMS và production vẫn `NOT VERIFIED`; D4c-b/D4c-c về sau supersede riêng phần composition/import graph, không supersede parser evidence. Focused parser/capability sau correction `24/24`; exact-final full ordered gate `509/505/0/4`, TypeScript/Java build và diff-check PASS; independent correction review `PASS`, `0` high/medium/low, prior H1/M1 và exact-prefix correction đều `CLOSED`.
- `VERIFIED offline/library-only` ở source/test/build level (2026-08-29): D4c-b compose D4b signature verification và corrected D4c-a parser trên cùng owned gzip snapshot, match exact statement hash, bind nửa SHA-256 thứ hai của `CKA_ID` với exact caller-supplied CryptoKeyVersion path bytes và bind raw 32-byte Ed25519 `CKA_EC_POINT` với caller-pinned SPKI. Normative review sửa D4c-a từ DER-like `04 20` wrapper sang raw RFC 8032 bytes; review cũ về wrapper bị supersede. Output chỉ claim selected attributes/relationships trong scope caller-pinned roots; không chứng minh resource tồn tại; origin/non-extractability, production roots, trusted time/revocation, custody/live KMS vẫn false. Focused D4a–D4c/capability `42/42`; exact-current full `515/511/0/4`, typecheck/TypeScript-Java build/diff-check PASS. Initial implementation review FAIL với một HIGH project-ID regex; signed `projects/abcde-` fixture RED rồi correction 6–30 ký tự/không trailing hyphen GREEN. Signed `projects/123` RED rồi GREEN theo project-number `int64`; signed overflow reject. Final correction review trên exact current tree `PASS`, `0` blocker/high/medium/low; prior HIGH `CLOSED` và old FAIL bị supersede.
- `VERIFIED offline/library-only` ở source/test/build level (2026-08-29): D4c-c thêm injected-client single-call bridge trong KMS backend. D1 copies exact CAVIUM_V2 gzip, exact `2/1/1` SDK chain arrays và public PEM vào private `WeakMap`; bridge chỉ nhận exact D1 object + client identity rồi gọi D4c-b, không nhận caller-materialized preflight report. Input/nested roots snapshot trước `await`; malformed local bounds fail trước RPC; legacy D1/D3 không đọc getter/chain của slice sau khi chưa yêu cầu. D1/D2/D4c-b dùng chung bounded local resource validator, chấp nhận `projects/123` và reject project-ID malformed/int64 overflow nhưng không claim authoritative Cloud KMS naming/resource existence. Output giữ origin metadata chỉ observed, không cryptographically bound; live KMS/resource existence/signing, production roots, origin/non-extractability, custody, IAM/provisioning/runtime false. Manual ADC CLI không request/call bridge do production root pinning policy vẫn blocked. Focused `87/87`; exact-current full `531/527/0/4`; typecheck/TypeScript-Java build/diff-check PASS. Hai independent implementation/claim reviews và final D4c-c code/test + claim correction review `deleg_659db8d0` PASS, `0` blocker/high/medium/low.
- P0.4 vẫn `PARTIAL`: chưa có production Paper/Bukkit observer-to-signer adapter, trusted key custody/provisioning, effective config/boot/server-instance truth, report/bundle/server integration hoặc controlled runtime evidence. Shared local SQLite challenge state và signed observation bytes không tự giải quyết các khoảng trống đó. Không được gọi CodeSource/resource hashes, signed `observedAtMs` hay `TARGET_FILE_MATCH_NON_AUTHORITATIVE` là loaded-artifact/fresh-runtime attestation.

**OBSERVED**

`runner.ts` ghi `${runId}.json` bằng `writeFile`; chưa dùng `CREATE_NEW`, temp+atomic promote, manifest hash hoặc read-back. Manifest hiện bind scenario SHA và optional source revision nhưng chưa bắt buộc bind:

- exact BotChecker source/build/lockfile;
- Paper/server JAR;
- plugin candidate và probe JAR;
- loaded CodeSource/class/resource identity;
- config/data baseline;
- process boot token/PID;
- Paper logs, raw provider evidence và archive hash;
- approval ID/scope.

**Rủi ro**

- Report có thể bị partial write/overwrite/collision hoặc được ghép với candidate/run khác.
- PASS cũ có thể bị dùng cho JAR mới.

**NEEDED**

- `EvidenceBundleWriter`:
  - destination create-new;
  - bounded files;
  - SHA-256 từng artifact;
  - manifest schema/version/context strict;
  - write temp → fsync tùy policy → atomic move → read-back;
  - final `bundleSha256` và archive create-new;
  - raw report immutable, summary chỉ tham chiếu raw artifact;
  - redact credentials/private player data trước persist.
- Verdict consumer phải reject stale candidate/source/provider identity.

**Acceptance**

- Negative tests: collision, partial file, stale candidate, changed scenario, changed provider, missing artifact, bad hash, duplicate/unknown manifest field.
- Không thể đánh PASS khi candidate hash chưa biết hoặc khác loaded artifact.

### P0.5. Structured failure taxonomy; không nuốt counterexample

**IMPLEMENTATION STATUS — 2026-08-27**

- `VERIFIED offline partial`: strict bounded/redacted failure envelope đã được triển khai và nối end-to-end cho multi-client runner → evaluator → journey report. Provider exception không còn thành `skipped {}`; nested cause, phase/provider, retryability, trust boundary và artifact refs được giữ.
- FAIL blocker ưu tiên aggregation nhưng không xóa observer counterexample; status/code mâu thuẫn bị reject. Opus/Hermes counterexamples cho same-client circular/token/oversized evidence, different-client malformed evidence, duplicate aggregate, failed-thiếu-envelope và skipped-thiếu-envelope đều RED→GREEN.
- Final exact-tree full gate: `344 total / 342 pass / 0 fail / 2 skip`; typecheck/build/diff-check PASS. Final narrow Opus 4.8 review `PASS`, không blocker/high/medium.
- Các runner khác và protocol diagnostics chưa migrate hoàn toàn, nên P0.5 giữ `PARTIAL`.

**OBSERVED**

- Nhiều runner catch lỗi rồi trả `INCONCLUSIVE_*` với message cắt 128 ký tự.
- `multi-client-runner.ts` catch observation error rồi chỉ lưu `{status:'skipped', evidence:{}}`.
- Protocol diagnostic chỉ giữ field/frame length/hash.

**Rủi ro**

Counterexample cụ thể, phase và provider cause bị mất; reviewer/agent dễ đọc một summary thiếu dữ kiện và kết luận sai.

**NEEDED**

- Error envelope có `code`, `phase`, `provider`, `causeClass`, `boundedDetail`, `artifactRefs`, `retryable`, `trustBoundary`.
- Không biến provider validation failure thành skipped trống.
- Verdict aggregation bảo toàn blocker/high và concrete counterexample.

**Acceptance**

- Unit test chứng minh nested provider failure vẫn xuất hiện trong raw report và summary.
- Report schema phân biệt `FAIL_PRODUCT`, `FAIL_FIXTURE`, `INCONCLUSIVE_PROTOCOL`, `INCONCLUSIVE_OBSERVER`, `INCONCLUSIVE_LIFECYCLE`.

---

## P1 — capability cần cho các release gate hiện tại

### P1.1. Multi-client thực sự đồng thời, có barrier và deterministic schedule

**OBSERVED**

`multi-client-runner.ts` và `multi-account-runner.ts` chạy `for ... await` tuần tự. Điều này không chứng minh race, contention, isolation hoặc simultaneous transaction.

**NEEDED**

- N client session lifecycle độc lập.
- Barrier phases: `connected`, `fixture-ready`, `armed`, `release`, `observed`, `cleanup`.
- Đồng hồ monotonic, per-client sequence và shared correlation token.
- Modes: simultaneous, staggered, deterministic interleaving, bounded soak.
- Fail one client không được làm mất evidence client khác; cleanup all.

**Acceptance**

- Reproduce 2-player same-tick inventory transfer và 8-client bounded load mà không dùng script riêng.
- Report có per-client timeline và aggregate p50/p95/max.

### P1.2. Exact inventory/item oracle

**OBSERVED**

Action `assert_inventory` hiện chỉ match substring `name/displayName` và minimum count. Runtime ItemGuard/ForceItem cần exact slot, cursor, amount, max stack, components/PDC/NBT/serialized bytes, UUID/code và before/after identity.

**NEEDED**

- `snapshot_inventory` bounded: slot, container/window ID, state ID, material, amount, max-stack, damage, enchantments, components, custom model/data, normalized display/lore, raw item payload hash.
- `assert_inventory_exact`, `assert_slot`, `assert_cursor`, `assert_equipment`, negative/unchanged assertions.
- Client-visible and trusted server-probe snapshots phải tách source rõ ràng; so sánh cross-source bằng correlation token.
- Secret/PDC allowlist; không dump arbitrary private NBT.

**Acceptance**

- Chứng minh exact physical item sống qua click/restart và phân biệt hai item cùng material/display nhưng khác identity payload.

### P1.3. Ground-item/entity lifecycle oracle

**OBSERVED**

ItemGuard ground merge phải dùng Java probe để đọc entity UUID, amount, max stack, event counts/cancellation và persistence qua restart. Mineflayer `inspect_entities` hiện chưa giải mã authoritative item stack/PDC hoặc event causality.

**NEEDED**

- Entity observation: stable UUID/id, type, item payload hash, amount, position, velocity, spawn/gone/merge sequence, chunk visibility gap.
- Server-probe contract cho event priority/cancel state, tick, source/target UUID và authoritative item bytes.
- Oracles: merged, intentionally not merged, despawned, picked up, persisted/rebound after restart.

**BOUNDARY**

Bukkit event cancellation, PDC và authoritative server item serialization không thể suy từ client packet; phải do signed/bound probe evidence cung cấp.

### P1.4. Raw protocol/client action library có kiểm soát

**OBSERVED**

Nhiều harness ngoài phải tự gửi raw packet cho window click/stateId, shift-click, creative mode, `use_entity`/`INTERACT_AT`, combat và drag/drop.

**NEEDED**

- Typed primitives theo protocol version:
  - click/shift/right/drag/drop/swap/hotbar/cursor;
  - `use_entity`, `INTERACT`, `INTERACT_AT`, attack;
  - window/state revision precondition;
  - packet acknowledgment/postcondition.
- Raw packet action chỉ được bật bằng scenario authorization và bounded allowlist.
- Ghi exact logical packet fields, không lưu auth/encryption/session secret.

**Acceptance**

- Các ItemGuard craft/merge và VillageDefense revive-interact fixtures chạy không cần `.mjs` riêng.

### P1.5. GUI component decoder và state machine

**OBSERVED**

Runtime ItemGuard ghi nhận:

- Adventure component title/custom-name/lore từng render `[object Object]`;
- Unicode oracle không match `Phát hiện`;
- assertion GUI closed chạy trước close packet;
- click selector/GUI ID đã được harden, nhưng semantic component và post-click transition vẫn thiếu.

**NEEDED**

- Decode Text/Adventure components thành canonical plain text + preserve structured component hash.
- Unicode NFC, locale-aware comparison tùy explicit setting; exact/contains/regex tách rõ.
- GUI state machine: window ID + state ID + revision + open/close/replace sequence.
- Actions: `wait_for_gui_closed`, `wait_for_gui_replaced`, `assert_gui_stable`, `assert_gui_transition`, `assert_no_gui` với dwell.
- Selectors exact material/name/lore/custom-data; ambiguity luôn fail.

**Acceptance**

- ItemGuard member/staff journeys không còn FAIL giả do `[object Object]`, Unicode hoặc close race.

### P1.6. Protocol diagnostics, bounded capture và deterministic replay

**OBSERVED**

Mineflayer/Paper 1.21.11 từng lỗi decode component/handshake. Diagnostic hiện chỉ có field, frame length và frame SHA nếu error object có buffer; không đủ tái hiện decoder lỗi.

**NEEDED**

- Bounded pre-error packet metadata ring: direction, packet name/id, protocol, sequence, length/hash.
- Optional sanitized payload capture cho packet allowlist, mặc định off.
- Fixture replay offline vào decoder exact dependency versions.
- Automatic compatibility report: Mineflayer, minecraft-protocol, minecraft-data, negotiated protocol và failing field.
- Redaction hard guard cho encryption/auth/chat/private data.

**Acceptance**

- Một decode incident tạo fixture nhỏ có thể RED trước fix và GREEN sau fix, không cần live server.

### P1.7. Correlation nonce và synchronized client/server timeline

**OBSERVED**

Các run hiện phải dò chat marker/log/file và tự ghép UTC với Paper local timestamp. B3/ItemGuard dùng run token ngoài để tránh nối nhầm phase.

**NEEDED**

- Run/boot/phase nonce duy nhất được truyền qua client command, probe telemetry, log marker và evidence file.
- Monotonic elapsed time per source; wall-clock chỉ hỗ trợ đối chiếu.
- Sequence/gap/duplicate validation; reject artifact khác token/boot.
- Server probe clock sample để ước lượng offset, không giả định timezone log.

### P1.8. Dynamic observer preconditions cho entity/route

**OBSERVED**

Incident ThanhRedfield timeout vì bot spawn khác dự kiến, NPC ở ngoài range/chunk và client pathfinder bị `moved too quickly`; không phải bằng chứng locator hỏng. Route oracle hiện mạnh khi target đã visible/pinned, nhưng fixture preparation vẫn phụ thuộc waypoint tĩnh.

**NEEDED**

- Observe-only wait cho target xuất hiện tự nhiên trong bounded range/chunk.
- Separate preconditions: bot route reachable, target visible, identity unique, world/gate pairing valid.
- Classify movement/pathfinder fail riêng với product locator fail.
- Không teleport/force-load/broad scan mặc định.

---

## P2 — nâng chất lượng và giảm script riêng

### P2.1. Assertion DSL tổng quát

Bổ sung combinator:

- `eventually`, `always`, `never`, `stable_for`, `sequence`, `exactly_n`, `delta`, `unchanged`;
- monotonic deadline và sample-gap bound;
- numeric threshold/percentile (`<50 ms`, tolerance `<=0.15`);
- explicit negative control và counterfactual pairing.

Mục tiêu: B3 có thể diễn đạt timing/journey/arbitration guard mà không hard-code vào plugin-specific runner.

### P2.2. Trusted server-probe protocol chuẩn hóa

Tạo protocol JSON-lines hoặc local socket/file journal strict schema:

- probe identity/JAR hash/capability manifest;
- run/boot/phase token;
- bounded event/tick/entity/inventory observations;
- create-new artifact + hash/read-back;
- no arbitrary command execution;
- no Bukkit access async;
- unavailable/tampered evidence → fail-closed.

Đây là cách đúng để chứng minh `unownedPathfindBlocks`, Bukkit event priority, scheduler callback/tick time, persistence state và exact PDC. Mineflayer không thể tự chứng minh các claim này.

### P2.3. Read-only filesystem/SQLite/log snapshot providers

ItemGuard đang tự viết Python để:

- `PRAGMA integrity_check`;
- counts/states/history/logical DB SHA;
- exact config/JAR/probe hashes;
- clean shutdown markers và residue absence.

Nên có provider khai báo allowlist query/path, stable no-follow read, size bounds, strict UTF-8/schema, before/after diff và hash. Tuyệt đối không cho scenario gửi SQL/shell tùy ý.

### P2.4. Visual/OCR merge vào canonical repo

Vision/OCR hiện nằm ở repo khác. Sau P0.1:

- merge frame artifact verification, OCR, stable target authorization;
- thêm real frame source/detector provider;
- giữ vision là observer/inconclusive khi thiếu grounding;
- không click theo OCR đơn frame; cần multi-frame stability + semantic/geometry corroboration.

### P2.5. Resource/performance telemetry

- Bot-side event-loop lag, heap/RSS, packet rate, samples dropped.
- Server-side TPS/MSPT/chunk/entity counts chỉ qua trusted provider.
- Bounded soak, warmup tách khỏi measured window.
- Không cho startup warmup thay runtime timing PASS.

### P2.6. Cleanup ledger

Mỗi plan khai báo fixture ownership và cleanup ledger:

- entities/items/files/DB rows/config changes/accounts;
- created-before/after IDs;
- cleanup exact-owned only;
- preserve unknown/pre-existing data;
- cleanup failure không xóa forensic evidence.

---

## P3 — vận hành dài hạn

- Capability discovery UI/API và dry-run plan graph.
- Evidence browser với raw artifact refs, không chỉ summary.
- Trend/flakiness dashboard theo exact candidate/protocol/fixture.
- Fixture pack versioning và compatibility matrix.
- Export JUnit/SARIF nhưng giữ `INCONCLUSIVE` riêng, không ép thành PASS/FAIL.
- Retention/quarantine policy; redaction audit.
- Reviewer integration: bind verdict vào exact candidate/source/evidence bundle; model/provider failure hoặc fallback không bao giờ được tính PASS.

---

## Những thứ không nên đưa vào BotChecker core

1. **Không tự deploy/restart production.** Production cần user approval và runbook dự án.
2. **Không cho scenario chạy shell/SQL tùy ý.** Chỉ typed allowlisted provider.
3. **Không coi client observation là server truth.** Bukkit events, PDC, scheduler, persistence và classloader cần trusted provider/probe.
4. **Không lưu credential/raw private packets/player data.** Chỉ credential reference ngoài report.
5. **Không tự force-load chunk/teleport/OP account** để làm fixture PASS.
6. **Không biến build/unit/contract xanh thành Paper runtime PASS.**
7. **Không gọi report hash là chữ ký/MAC.** Nếu cần chống hostile rewrite, phải dùng signing key nằm ngoài fixture.

---

## Roadmap đề xuất

### Milestone 1 — Trustworthy core (P0)

- canonical repo;
- capability manifest;
- structured error taxonomy;
- evidence bundle writer;
- authorized provider registry;
- Paper lifecycle provider cho isolated fixture.

### Milestone 2 — Real plugin journeys (P1)

- concurrent clients/barriers;
- exact inventory/entity/packet primitives;
- GUI component/state machine;
- protocol replay;
- correlation nonce/timeline.

### Milestone 3 — Server truth adapters (P2)

- strict server-probe protocol;
- filesystem/SQLite/log providers;
- assertion DSL/performance;
- cleanup ledger.

### Milestone 4 — Visual and operations (P2/P3)

- merge vision/OCR;
- dashboard/trend/export/retention.

## Ba vertical slice nên làm đầu tiên

1. **Evidence slice:** một scenario đơn client tạo create-new sealed bundle bind BotChecker/source/scenario/Paper/candidate/probe/log.
2. **Restart slice:** typed Paper provider chạy isolated clean boot → client journey → clean stop → boot2 → after snapshot.
3. **Concurrency slice:** hai client có barrier, exact slot/cursor snapshots và server-probe correlation token.

Ba slice này loại phần lớn Python/`.mjs` orchestration lặp lại đang xuất hiện ở ItemGuard, LivingNPC, VillageDefense và ForceItem.

## Source/evidence chính đã đối chiếu

- `src/runner.ts`, `src/server.ts`, `src/scenario.ts`, `src/types.ts`.
- `src/multi-client-runner.ts`, `src/multi-account-runner.ts`.
- `src/persistence-runner.ts`, `src/crash-recovery-runner.ts`.
- `src/gui-runner.ts`, `src/gameplay-runner.ts`.
- `src/protocol-diagnostic.ts`.
- `CURRENT_STATE.md`, `docs/PLUGIN_QA_PLATFORM_GOAL.md`, `docs/PLUGIN_QA_PLATFORM_PHASE_1.md`.
- `docs/VILLAGEDEFENSE_HANDSHAKE_RCA_20260820.md`.
- `E:\AI.WORK\living-npc-plugin\docs\incidents\2026-08-15-botchecker-thanhredfield-route-timeout.md`.
- ItemGuard runtime evidence và external orchestration scripts cho ground merge/GUI UAT.
- ForceItem/BastionForge `run/runtime-harness` concurrency/restart/combat journeys.

Trạng thái: **OBSERVED backlog**, chưa sửa source BotChecker và chưa chạy production/live server trong audit này.
