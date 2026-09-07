# BotChecker completion audit — 2026-09-07

Trạng thái: `AUDIT / KHÔNG THAY ĐỔI SOURCE`
Tree được audit: HEAD `7501337`, branch `main` ahead `origin/main` 34 commit,
worktree cố ý dirty (3 tracked modified + ứng viên P0.3 untracked).

Reviewer độc lập: Claude Opus 5 (read-only, 75 turns, `--effort max`), báo cáo thô
tại `C:/Users/thanh/AppData/Local/Temp/botchecker-opus5-audit-result.md`.
**Mọi finding dưới đây đã được kiểm chứng lại bằng source hiện tại và/hoặc probe
thực thi; nhãn ghi rõ CONFIRMED / PARTIAL / REFUTED.** Self-report của model không
được dùng làm bằng chứng.

## Gate hiện tại (OBSERVED)

`npm run typecheck && npm test && npm run build && git diff --check` → exit `0`.
`761 total / 755 pass / 0 fail / 6 skip`, duration `118.9 s`. Java build PASS.

Gate này chỉ chứng minh logic Node + biên dịch Java. Nó **không** chứng minh Paper
lifecycle, custody khóa, hay bất kỳ claim runtime nào.

---

## Bảng kiểm chứng

| ID | Nhãn | Mức đúng | Ghi chú kiểm chứng |
|---|---|---|---|
| BC-001 | **ĐÃ SỬA (offline) 2026-09-07** | HIGH | config.yml strict + onEnable/onDisable compose runtime; runtime E2E chưa chạy |
| BC-002 | **ĐÃ SỬA (offline) 2026-09-07** | HIGH | Composition challenge→loopback→verify→consume; runtime E2E chưa chạy |
| BC-003 | **ĐÃ SỬA 2026-09-07** | HIGH | Reproduce → fix → probe đảo chiều |
| BC-004 | **ĐÃ SỬA 2026-09-07** | HIGH | Probe → fix → 401 + fail-closed bind |
| BC-005 | **ĐÃ SỬA 2026-09-07** | MEDIUM | `MC_AUTH` strict + `manifest.target.auth` + `observed.accountUuid` |
| BC-006 | **ĐÃ SỬA 2026-09-07** | MEDIUM | Mode derive từ import graph; phát hiện 1 mode khai sai |
| BC-007 | **ĐÃ SỬA 2026-09-07** | MEDIUM | 17 file adapter vào provenance + vào `npm run build` |
| BC-008 | **ĐÃ SỬA 2026-09-07** | MEDIUM | CI 2 nền tảng + JDK 21 + Gradle job + skip gate |
| BC-009 | **ĐÃ SỬA (eviction) 2026-09-07** | MEDIUM | Retention bounded; đọc bundle từ đĩa chưa làm |
| BC-010 | **ĐÃ SỬA (1 domain) 2026-09-07** | MEDIUM | negative-security có producer qua HTTP; 9 domain còn lại vẫn library-only |
| BC-011 | **ĐÃ SỬA 2026-09-07** | MEDIUM | Companion thành Gradle subproject + plugin.yml + JavaPlugin + ServicesManager |
| BC-012 | **ĐÃ SỬA (một phần) 2026-09-07** | LOW/MEDIUM | Timeout trước claim + sửa doc; peer-auth vẫn mở |
| BC-013 | **ĐÃ SỬA 2026-09-07** | MEDIUM | `claimedBootId` mint từ SecureRandom mỗi enable, không còn literal config |
| BC-014 | **ĐÃ SỬA 2026-09-07** | LOW cosmetic | Delimiter NUL thật + `caseId` vào `validatePlan` |
| BC-015 | **ĐÃ SỬA 2026-09-07** | LOW | 404 cố định, không lộ path |
| BC-016 | **PARTIAL** | LOW | Có `matchedItems`, xem dưới |
| BC-017 | **ĐÃ SỬA 2026-09-07** | LOW | Burn nonce ở ngưỡng 5 lần thất bại; contract retry cũ giữ nguyên |
| BC-018 | CONFIRMED | LOW | Đọc `git status` + checkpoint |

---

## Chi tiết các finding cần đính chính

### BC-003 — CONFIRMED, defect nghiêm trọng nhất (đã reproduce)

Probe thực thi trên `writeEvidenceBundle`, artifact thứ hai vượt `16 MiB`:

```
BC003 write1 threw: Evidence artifact exceeds 16777216 bytes
BC003 leftovers on disk: ["<runId>.json"]
BC003 retry THREW (unrecoverable): Evidence artifact already exists: <runId>
BC003 verify FAILED: ENOENT ... <runId>.bundle.json
```

Đây là bằng chứng trực tiếp: một lỗi I/O bất kỳ sau artifact đầu tiên để lại
orphan không seal, và **retry cùng `runId` là bất khả thi vĩnh viễn** vì
`assertDestinationMissing` (`src/evidence-bundle.ts:142`) và `link()` EEXIST
(`src/evidence-writer.ts:59`) đều fail. Evidence của run đó mất hoàn toàn.

Đường dẫn tạo ra kích thước đó cũng thật:

- `src/runner.ts:910,1007` — mảng `observations` của `observe_crossing` **không hề
  bị cắt**, trong khi `observe_route` có `evidence.observations.slice(-512)` tại
  `src/runner.ts:874`. Bất đối xứng này là bug rõ ràng.
- `src/runner.ts:302-305` — `this.events` không có cap; `report()` nhét toàn bộ
  `timeline: this.events` (`src/runner.ts:1285`).
- `src/scenario.ts:170` — `steps: z.array(stepSchema).min(1)` **không có `.max()`**.
- `observe_crossing` cho `timeoutMs` tới `300_000` với `sampleMs` tối thiểu `50`,
  cộng listener `entityMoved` đẩy thêm sample ngoài nhịp poll.

INFERRED (chưa reproduce ở đúng 16 MiB): một scenario nhiều bước crossing dài có
thể tự đẩy report vượt bound rồi rơi đúng vào lỗi trên.

### BC-012 — PARTIAL, Opus overclaim

Opus viết attacker "submit a self-constructed challenge frame with attacker-chosen
audience/verifierInstanceId/runId/bindingId/targetBindingSha256/trustStore fields,
and receive an Ed25519 signature". Sai một nửa:
`PaperBukkitOnlinePlayerRequestProcessor.requirePolicy`
(`paper-bukkit-adapter/.../PaperBukkitOnlinePlayerRequestProcessor.java:207-221`)
so khớp **exact** 11 trường policy — audience, verifierInstanceId, keyId, bindingId,
targetBindingSha256, provider id/version/instance, trustStore id/version/sha256.
Attacker không tự chọn được các trường đó.

Đúng phần còn lại:

- Không có peer-credential/shared-secret check
  (`PaperBukkitOnlinePlayerLoopbackListener.java:88-108`) — bất kỳ process local nào
  cũng bind được.
- `nonce`, `challengeId`, `runId`, `issuedAtMs/expiresAtMs` do caller chọn trong
  khung policy, nên có thể mint signed claim ngoài challenge của verifier thật.
  Claim đó bị Node verifier từ chối (không có trong `pending`), nên tác động thực
  tế là **DoS + ledger capacity exhaustion + rò rỉ số người chơi thật**, không phải
  signing oracle tùy ý.
- `socket.setSoTimeout` gọi trong `handle()` (`:140`) **sau** `claim()` (`:99`), nên
  connect-and-stall giữ slot single-flight tới `socketTimeoutMs` (bounded `60 s`).

Severity đính chính: MEDIUM → **LOW/MEDIUM**. Câu chữ "transport loopback
authenticated" trong `docs/P0_3_PAPER_ADAPTER_ED25519_DECISION_2026-08-31.md:35`
vẫn sai và phải sửa (chính dòng `:58` của file đó đã tự mâu thuẫn).

### BC-014 — REFUTED (không khai thác được)

Bug hình thức là thật: `src/authorized-plan-runner.ts:35,39` dùng
`` `${...}\\u0000${...}` `` (6 ký tự literal) trong khi `runPermissionPlan:16,20` và
`evaluateNegativePlan` (`src/negative-plan.ts:33`) dùng NUL thật.

Nhưng counterexample của Opus **không thể tạo được**. Probe thực thi:

```
literal-delimiter keys equal?  true
real-NUL keys equal?           false
OUTCOME plan REJECTED: Invalid negative case ID
```

`validateCaseId` (`src/negative-contract.ts:78-83`) ép `caseId` vào
`/^[a-zA-Z0-9_-]{1,96}$/`, nên `caseId` không chứa được backslash. Muốn hai split
khác nhau cho cùng một key thì delimiter phải xuất hiện hai lần, tức `caseId` phải
chứa `\u0000` literal — bất khả thi. Key được sinh và tra bằng **cùng** biểu thức
nên hành vi vẫn tự nhất quán.

Severity đính chính: MEDIUM → **LOW (cosmetic/latent)**. Vẫn nên sửa cho nhất quán
và thêm `caseId` vào `validatePlan`, nhưng đây không phải evidence-corruption bug.

### BC-016 — PARTIAL

`MAX_GUI_ITEMS = 64` (`src/snapshot.ts:5`) trong khi matching dùng danh sách raw
(`src/runner.ts:585`) — đúng. Nhưng test hiện có
(`test/assert-gui-findings.test.ts:119-138`) chứng minh item được chọn **vẫn** vào
evidence qua `matchedItems`, và `click_gui` ghi `item: evidenceItem`
(`src/runner.ts:601`). Nên auditor thấy được item nào được chọn; thứ thiếu là **tập
ứng viên** dùng cho ambiguity check. Giữ LOW, fix đúng là thêm
`totalItemCount` + `truncatedItemCount`, không phải nâng cap mù.

### Các finding còn lại — CONFIRMED nguyên văn

Bằng chứng chính đã tự đối chiếu:

- **BC-001/002**: `PaperBukkitOnlinePlayerPlugin.onEnable` (`:13-15`) chỉ gọi
  `getLogger().info(...)`, không `onDisable`, không tham chiếu lớp adapter nào.
  `src/main/resources/` chỉ có `plugin.yml` — **không có `config.yml`**. Grep toàn
  `src/`: chỉ 4 file nhắc `paper-bukkit-online-player`, và edge duy nhất là
  `loopback-client → transport-codec → claim`; `runner.ts` không import cái nào.
- **BC-004/005/015** (probe thực thi, cùng một lần chạy):
  `MC_AUTH=Microsoft` → `config.minecraft.auth === "Microsoft"` (cast không validate,
  `src/config.ts:31`); `API_HOST=0.0.0.0` được nhận thẳng; `GET /health` → `200`,
  `GET /api/scenarios` → `200` liệt kê scenario **không auth**;
  `POST /api/runs {scenario:"nope"}` → `500` với body chứa
  `E:\AI.WORK\botcheckerminecraft-botchecker\scenarios\nope.json`.
- **BC-006**: `authorized-provider-registry` khai `runtime-wired`
  (`src/capability-manifest.ts:242`) nhưng `src/index.ts:5` gọi `createServer()`
  không tham số → `providerRegistry` luôn `undefined`, nhánh `server.ts:86` không
  bao giờ chạy. Mode chỉ dựa trên `sourcePaths.has(...)` (`:504`) — sự tồn tại file.
- **BC-007**: `collectFilesByExtension(rootDir, 'java-src', ...)`
  (`src/capability-manifest.ts:482`) và `auxiliaryCode` hardcode một component
  `jvm-artifact-observer` (`:533-541`). `scripts/build-java.mjs` chỉ compile
  `java-src`. Toàn bộ `paper-bukkit-adapter/` nằm ngoài `sourceFingerprint`.
- **BC-008**: `.github/workflows/posix-shutdown.yml:12` chỉ `ubuntu-latest`, không
  JDK/Gradle step. Đếm thực tế: **13 file test** có guard
  `process.platform === 'win32' ? false : ...` (~23 test) và **14 file** guard
  `!javaInteropAvailable` (~48 test). CI xanh trên Linux mà không chạy nhóm này.
- **BC-009**: `const runs = new Map(...)` (`server.ts:51`), `runs.set` tại `:114`,
  **không có `runs.delete` ở đâu cả**. `readdir` trong `server.ts` chỉ dùng cho
  `scenarioDir` — không có route nào đọc bundle từ `reportDir`.
- **BC-010**: mọi `qaPlan/persistence/transaction/...` là dependency inject qua
  constructor (`runner.ts:136+`), default `runFactory` (`server.ts:62-74`) không
  truyền cái nào.
- **BC-011**: `paper-bukkit-adapter/settings.gradle.kts` chỉ có
  `rootProject.name = "botchecker-paper-bukkit-adapter"` — không `include(...)`, nên
  `keystore-companion/` không được Gradle build; nó cũng không extends `JavaPlugin`
  và không gọi `ServicesManager.register`.
- **BC-013**: `Policy.claimedServerInstanceId/claimedBootId` là `String` chỉ
  `requireNonNull` (`RequestProcessor.java:69-70`), copy nguyên vào payload ký
  (`:168`). Decision doc `:44` yêu cầu sinh `claimedBootId` ngẫu nhiên khi
  `onEnable` — chưa tồn tại.
- **BC-017**: `cryptoVerify` fail ném tại `paper-bukkit-online-player-claim.ts:468`
  **trước** `this.pending.delete(...)` ở `:471`; mismatch challenge cũng ném ở
  `:458-459`. Nonce sống hết TTL qua mọi lần thử sai, không rate limit.
- **BC-018**: `.hermes/WORKING_STATE.md:9-10` ghi HEAD `458308f` / ahead `19` trong
  khi thực tế `7501337` / ahead `34`. `.gitignore` không ignore
  `reports-anticheat*/` (3 thư mục đang untracked).

---

## Hỗ trợ phiên bản Paper: 1.21.11 → mới nhất (2026-09-07)

Yêu cầu: adapter phải chạy từ 1.21.11 lên bản Paper mới nhất, không pin một bản.

**Phát hiện quan trọng khi kiểm tra thực tế** — Paper đã đổi hoàn toàn versioning
scheme sau 1.21.11. Bản mới nhất trên Maven là `26.2.build.121-stable`, không còn
dạng `1.21.11-R0.1-SNAPSHOT`. `<latest>` và `<release>` của `paper-api` đều trỏ về
scheme mới; các artifact `1.21.x` vẫn tồn tại nhưng không còn là release.

**Cái bẫy, và vì sao không build theo bản mới nhất.** Thử nâng
`compileOnly` lên `26.2.build.121-stable` thì Gradle từ chối thẳng:

```
Dependency resolution is looking for a library compatible with JVM runtime
version 21, but 'io.papermc.paper:paper-api:26.2.build.121-stable' is only
compatible with JVM runtime version 25 or newer.
```

Nếu ép build theo API mới, bytecode lên 25 và JAR **mất khả năng chạy trên
1.21.11** (Java 21) — tức là đánh đổi ngược đúng yêu cầu. Nên chiến lược là:

- **Compile theo sàn** `1.21.11-R0.1-SNAPSHOT`, giữ `JavaLanguageVersion.of(21)`.
  Bytecode 21 là mẫu số chung: Paper 26.x chạy Java 25 nhưng vẫn load bytecode 21;
  chiều ngược lại thì không.
- **`api-version: '1.21'`** trong cả hai `plugin.yml` (trước là `'1.21.11'`).
  Paper coi đây là sàn tương thích, không phải pin. Pin patch version khoá plugin
  vào đúng một bản.
- **`paperApiVersion` thành Gradle property** override được, để thử API khác mà
  không phải sửa file build.

**Forward-compat là bằng chứng, không phải giả định.**
`scripts/verify-paper-forward-compat.mjs` + `npm run verify:paper-forward-compat`
hỏi Maven bản mới nhất, tải về, rồi **biên dịch lại nguyên bộ source** với API đó ở
`--release 21`. Paper xoá/đổi một API adapter đang dùng → lệnh này fail. Script
phân biệt rõ hai loại kết quả: hạ tầng thiếu (không có javac/mạng) là `SKIPPED`
exit 0 kèm câu "Forward compatibility is NOT verified"; API không tương thích là
`FAILED` exit 1. Nó không bao giờ báo thành công khi chưa thực sự biên dịch.

Evidence (OBSERVED 2026-09-07):

- `npm run verify:paper-forward-compat` → `PASSED — 19 file compile sạch với
  paper-api 26.2.build.121-stable ở --release 21`.
- Bytecode JAR thực tế: `cafe babe 0000 0041` → major 65 = **Java 21**, đúng cái
  cần để chạy trên 1.21.11.
- Toàn bộ API surface adapter dùng vẫn tồn tại trong 26.2: `Bukkit`,
  `ServicesManager`, `ServicePriority`, `Service(Un)RegisterEvent`,
  `RegisteredServiceProvider`, `BukkitTask`, `ConfigurationSection`, `JavaPlugin`.
- `gradlew clean build` cả hai module exit `0`.
- Test mới `test/paper-version-support.test.ts`, 3 test GREEN: khoá sàn build,
  khoá `api-version: '1.21'` (và cấm pin patch version), và khoá việc gate thật sự
  tồn tại + được CI gọi.
- CI: job `paper-adapter-gradle` thêm bước forward-compat (kèm Node setup).
- Full gate: `800 total / 794 pass / 0 fail / 6 skip`; `COVERAGE=0 BUILD=0
  DIFFCHECK=0`. Sàn nâng lên `794`.

Ghi chú trung thực: đây là **compile-level compatibility**. Nó chứng minh API
surface còn nguyên, không chứng minh hành vi runtime giống nhau giữa 1.21.11 và
26.x — thay đổi ngữ nghĩa scheduler, thứ tự event hay ServicesManager sẽ không lộ
ra ở bước biên dịch. Chỉ controlled Paper runtime trên từng bản mới trả lời được.

## Đánh giá tổng thể

Phần lõi gốc — Mineflayer journey/GUI tester sau HTTP API — là **thật và mạch lạc**:
`index.ts → server.ts → runner.ts` là call path hoàn chỉnh, GUI inspect-before-click
có window-generation guard thật, route/crossing oracle có test phủ phản ví dụ tốt.

Phần chồng lên trên **chưa nối vào runtime**. Không module runtime nào import
`paper-process-*`, `paper-bukkit-*`, signed-provider verifier, evidence-bundle
verifier hay Google Cloud KMS. Đây phần lớn là gap **đã được ghi nhận** trong
`CURRENT_STATE.md` (`library-only`, `BLOCKED / NOT VERIFIED`) — dự án trung thực về
điều đó. Vấn đề là **7 defect ở tầng đang chạy được** (BC-003, 004, 005, 006, 009,
015, 017) chưa từng được ghi nhận ở đâu.

Không được tuyên bố (nguyên trạng): authenticated Bukkit online-player fact; adapter
Paper Ed25519 đã triển khai; companion KeyStore tồn tại; claim bind server/boot
instance; report release-eligible hay đã xác thực chữ ký; capability mode là bằng
chứng wiring; QA domain nào dùng được ngoài test.

---

## Lộ trình hoàn chỉnh — 6 slice

Thứ tự tối ưu theo rủi ro giảm dần trên phần **đang thật sự chạy được**.

### Slice 1 — Siết biên HTTP (M2) — ✅ HOÀN TẤT 2026-09-07

Sửa BC-004, BC-015, BC-005 (phần config), BC-009 (phần eviction).

Đã làm:

- `src/config.ts` — thêm `isLoopbackHost`, `resolveApiCredential`,
  `resolveMinecraftAuth` là export thuần để test trực tiếp.
  `API_CREDENTIAL` bắt buộc (≥16 ký tự) khi `API_HOST` không phải loopback,
  fail-closed ngay lúc load module. `MC_AUTH` chỉ nhận đúng `offline`/`microsoft`.
  Thêm `MAX_RETAINED_RUNS` (mặc định 64).
- `src/server.ts` — hook `onRequest` chặn mọi `/api/*` bằng Bearer token so sánh
  `timingSafeEqual` (pad về cùng độ dài rồi vẫn kiểm tra độ dài thật, nên không
  rò rỉ độ dài qua thời gian). `/health` cố ý không yêu cầu credential.
- `src/server.ts` — `ScenarioNotFoundError` cho `ENOENT` → `404`
  `{"error":"Scenario not found"}`; ZodError → `400` `{"error":"Request is invalid"}`;
  còn lại → `500` `{"error":"Internal error"}` và chi tiết chỉ vào `request.log`.
- `src/server.ts` — `evictFinishedRuns()` chạy sau mỗi lần `runs.set`, xóa run đã
  kết thúc theo thứ tự chèn, không bao giờ đụng run `queued/connecting/running`.

Evidence (OBSERVED):

- Test mới `test/server-boundary.test.ts`, 8 test, RED trước fix
  (`resolveApiCredential` chưa tồn tại) → GREEN 8/8 sau fix.
- Probe đảo chiều so với lần audit:
  `host=0.0.0.0 no cred -> THROWS`; `MC_AUTH=Microsoft -> THROWS`;
  `GET /api/scenarios unauth -> 401`; `unknown scenario -> 404`, `leaks path: false`.
- Full gate: `774 total / 768 pass / 0 fail / 6 skip`; typecheck + build +
  `git diff --check` PASS.

Còn lại (không thuộc slice này): endpoint đọc bundle đã seal từ `reportDir` sau
restart (phần còn lại của BC-009); ghi auth mode + account UUID vào manifest
(phần còn lại của BC-005) — thuộc Slice 3.

### Slice 2 — Evidence atomic + bounded (M2) — ✅ HOÀN TẤT 2026-09-07

Sửa BC-003. **Ưu tiên cao nhất về mặt đúng đắn sản phẩm.**

Đã làm:

- `src/evidence-bundle.ts:241-275` — bọc vòng ghi artifact + seal trong
  `try/finally`, theo dõi `written[]` và `unlink` rollback mọi artifact của chính
  lần ghi hỏng. `written.length = 0` sau khi seal thành công nên happy path không
  đụng gì. Rollback chỉ xóa file lần này ghi, không chạm artifact run khác.
- `src/runner.ts:61` — thêm `MAX_CROSSING_OBSERVATIONS = 512`;
  `:1086-1089` cắt `observations` trong `finally` và ghi
  `evidence.truncatedObservationCount`, đối xứng với `observe_route` `slice(-512)`.
- `src/scenario.ts:170` — `steps: z.array(stepSchema).min(1).max(256)`.
  Scenario dài nhất hiện có 9 step nên bound này không phá gì.

Evidence (OBSERVED):

- Test mới `test/evidence-bundle-atomicity.test.ts`, 5 test, RED→GREEN thật:
  4 test fail đúng nguyên nhân trước fix, pass sau fix.
- Probe reproduce gốc đảo chiều hoàn toàn sau fix:
  `leftovers on disk: []` / `retry = SUCCESS (recoverable)` / `verify = OK`.
- Full ordered gate: `766 total / 760 pass / 0 fail / 6 skip`;
  typecheck + TypeScript/Java build + `git diff --check` PASS.

Ghi chú trung thực: test crossing dùng fake bot in-process, chứng minh cắt bounded
ở tầng runner. Nó không phải Paper runtime evidence.

### Slice 3 — Ngừng overclaim provenance (M2) — ✅ HOÀN TẤT 2026-09-07

Sửa BC-005 (phần report), BC-006, BC-007.

Đã làm:

- `src/capability-manifest.ts` — thêm export `collectEntrypointReachableModules()`
  đi BFS từ `index` theo cạnh import tương đối thật trong source. `import type` /
  `export type` và `import { type A, type B }` bị loại vì chúng bị xóa lúc biên
  dịch, không phải cạnh runtime. `CAPABILITY_MODULES` mất trường `mode`; mode nay
  được derive: `reachable.has(module) ? 'runtime-wired' : 'library-only'`.
- `src/capability-manifest.ts` — `paper-bukkit-adapter` thành auxiliaryCode
  component thứ hai, hash toàn bộ `.java` dưới root đó.
- `scripts/build-paper-adapter.mjs` (mới) — build wrapper gọi Gradle, đồng thời là
  neo provenance thỏa guard `buildScript` phải nằm dưới `scripts/`. Fail-closed:
  thiếu wrapper thì báo SKIPPED rõ ràng, không bao giờ báo thành công khi chưa
  biên dịch. Windows chạy `gradlew.bat` qua `cmd.exe` (spawnSync thẳng trả EINVAL).
- `package.json` — `npm run build` nay chạy `build:paper-adapter`.
- `src/runner.ts` + `src/types.ts` — `manifest.target.auth` ghi effective auth mode;
  `manifest.observed.accountUuid` ghi UUID tài khoản đã kết nối (qua
  `withDefinedValues` nên không sinh khóa `undefined`).

Phát hiện phụ đáng chú ý: import graph bác bỏ chính bảng tay. Capability
`jvm-artifact-observation-assessment` được khai `library-only`, nhưng
`src/runner.ts:53` import giá trị `assessJvmArtifactObservationAgainstBinding` và
gọi ở `:1475`, tức `index → server → runner → jvm-artifact-observation` là cạnh
runtime thật. Test cũ đã pin nhầm giá trị sai; đã sửa test theo fact. Đây đúng là
loại lệch mà BC-006 dự đoán, và nó tự lộ ra ngay khi mode được derive.

Evidence (OBSERVED):

- Test mới `test/capability-provenance.test.ts`, 4 test, RED → GREEN 4/4.
- Probe: `auxiliary components: jvm-artifact-observer(5), paper-bukkit-adapter(17)`;
  `fingerprint CHANGES when adapter .java edited: true`; `fingerprint restored: true`;
  `authorized-provider-registry: runtime-wired`, `paper-bukkit-online-player-claim:
  library-only`, `multi-client: library-only`.
- `node scripts/build-paper-adapter.mjs` → `built 17 Java sources`, exit `0`.
- Full ordered gate `FINAL_GATE_EXIT=0`; `778 total / 772 pass / 0 fail / 6 skip`.

Ghi chú trung thực: mode nay phản ánh **reachability tĩnh từ entrypoint**, chưa
phải "capability đã thực sự chạy trong run này". Một `capabilitiesExercised` dựng
từ invocation thật vẫn là việc mở.

### Slice 5 — CI đủ nền tảng (M2) — ✅ HOÀN TẤT 2026-09-07

Sửa BC-008.

Đã làm:

- `.github/workflows/verification-gate.yml` (mới, thay `posix-shutdown.yml`) —
  matrix `ubuntu-latest` × `windows-latest` × Node `22.18.0`/`24`, cộng **JDK 21
  trên cả hai nền tảng** để ~48 test Java interop thực sự chạy thay vì skip im
  lặng. Job thứ hai `paper-adapter-gradle` chạy `./gradlew --no-daemon clean build`
  trực tiếp (kèm `wrapper-validation`) để lỗi biên dịch adapter là lỗi CI rõ ràng,
  không bị che bởi nhánh SKIPPED của build wrapper.
- `scripts/verify-test-coverage-floor.mjs` (mới) + `npm run verify:coverage-floor`
  — chạy full suite rồi fail khi `pass` tụt dưới sàn hoặc `skipped` vượt trần đã
  pin theo từng nền tảng. Đây là thứ biến "test biến mất im lặng" thành lỗi.
  Sàn Windows `772/6` pin theo quan sát thật; Linux `720/40` thấp hơn đúng phần
  Windows-only, không thấp hơn nữa.
- `posix-shutdown.yml` bị xoá vì workflow mới bao trùm hoàn toàn (bước
  direct-entrypoint shutdown vẫn còn, có `if: runner.os != 'Windows'`).

Evidence (OBSERVED) — gate được kiểm chứng **hai chiều**, không chỉ chiều xanh:

- Sàn thật: `tests=778 pass=772 fail=0 skipped=6` → `SKIP GATE PASSED`, exit `0`.
- Giả lập nhóm test biến mất (nâng sàn lên 900): `SKIP GATE FAILED — chỉ 772 test
  chạy, dưới sàn 900`, exit khác 0. Nếu không có bước này thì gate chỉ là trang trí.
- Full ordered gate: `COVERAGE_GATE=0`, `BUILD=0`, `DIFFCHECK=0`.

6 skip trên Windows đều là điều kiện môi trường chính đáng, đã đọc từng cái:
2 signal handler (Windows cưỡng bức kết thúc child), 3 symlink `EPERM`, 1 POSIX
ownership/mode.

Ghi chú trung thực: workflow này **chưa từng chạy trên GitHub** — nó chỉ được kiểm
ở tầng cú pháp và ở phần script chạy được cục bộ. Con số sàn Linux `720/40` là suy
ra từ số Windows-only test đếm được, chưa phải quan sát từ một lần chạy Linux thật;
lần chạy CI đầu tiên có thể phải chỉnh lại.

### Slice 4 — QA domain có producer thật (M3) — ✅ HOÀN TẤT 2026-09-07

Sửa BC-014, BC-010 (một domain).

Đã làm:

- `src/authorized-plan-runner.ts:35,39` — delimiter đổi từ 6 ký tự literal
  `\u0000` sang NUL thật, khớp `runPermissionPlan` và `evaluateNegativePlan`.
- `src/negative-plan.ts` — `validatePlan` nay kiểm `caseId` theo
  `/^[a-zA-Z0-9_-]{1,96}$/` và chặn chuỗi credential-like, thay vì để free text.
- `src/server.ts` — thêm option `qaPlanExecutor`; producer chạy **trước** scenario
  trong cùng queue task, kết quả đi thẳng vào `run.attachQaPlan(...)`.
- `src/runner.ts` — `TestRun.attachQaPlan()` nhận kết quả producer, chuẩn hóa cả
  hai shape `cells`/`cases` thành section `qaPlan`. Nó thắng dependency inject sẵn
  vì phản ánh cái đã thực sự chạy trong run này; ném nếu gọi sau khi run kết thúc.

Evidence (OBSERVED):

- Test mới `test/qa-plan-producer.test.ts`, 3 test, RED → GREEN 3/3.
- Test end-to-end đi qua `POST /api/runs` (có credential) → chờ run xong →
  `GET /api/runs/{id}/report`, rồi assert `manifest.qaPlan.kind ===
  'negative-security'`, `summary.total === 2`, `summary.pass === 2`,
  `verdict === 'PASS'`, và executor thật được gọi đúng thứ tự
  `['malformed-input', 'unauthorized-give']`. Đây là verdict non-vacuous đi ra từ
  public entrypoint, không phải từ test gọi thẳng runner.
- Full ordered gate: `COVERAGE=0`, `BUILD=0`, `DIFFCHECK=0`;
  `781 total / 775 pass / 0 fail / 6 skip`. Sàn skip gate nâng lên `775`.

Ghi chú trung thực: mới **một** domain (negative-security) có producer. Chín domain
còn lại — permission, persistence, transaction/idempotency, crash-recovery,
compatibility, gameplay, GUI, multi-client, multi-account — vẫn chỉ là contract +
report builder, không có đường chạy cho operator. Interface `qaPlanExecutor` đã mở
sẵn cho `permission` nên domain đó là bước kế tiếp rẻ nhất.

### Slice 6 — Adapter Paper thành thật (M4) — ⏸ TẠM DỪNG, CHỜ DUYỆT

Đã làm phần **offline an toàn** (không chạm server):

- `PaperBukkitOnlinePlayerLoopbackListener.java` — thêm `claimWithTimeout()`:
  `setSoTimeout`/`setTcpNoDelay` được áp **trước** khi chiếm slot single-flight.
  Trước đây timeout chỉ đặt trong `handle()` sau `claim()`, nên một client kết nối
  rồi im lặng giữ slot duy nhất tới hết `socketTimeoutMs`. Socket không cấu hình
  được nay bị loại thay vì chiếm chỗ.
- `docs/P0_3_PAPER_ADAPTER_ED25519_DECISION_2026-08-31.md:35` — sửa câu
  "transport loopback authenticated" thành mô tả đúng: transport **không** xác
  thực, tính toàn vẹn dựa vào public-key pin + chữ ký + challenge. Dòng `:58` của
  chính file đó đã nói vậy; hai dòng từng mâu thuẫn nhau.

Evidence: `node scripts/build-paper-adapter.mjs` → `built 17 Java sources`;
4 test Java loopback listener (gồm busy/quiescence) PASS; full gate
`781/775/0/6`, `COVERAGE=0 BUILD=0 DIFFCHECK=0`.

**BC-017 — ĐÃ SỬA 2026-09-07, chọn đường giữa.** Opus đề xuất burn nonce ngay lần
chữ ký sai đầu tiên. Nhưng `test/paper-bukkit-online-player-claim.test.ts:84-88`
pin hành vi ngược lại: gửi envelope sai chữ ký, rồi assert envelope đúng ngay sau
đó **vẫn được chấp nhận**. Đó là contract có chủ đích. Burn-ngay vừa phá nó vừa cho
phép một client lỗi mạng tự khoá mình.

Giải pháp: `MAX_FAILED_ATTEMPTS_PER_CHALLENGE = 5`. Mỗi challenge đếm số lần verify
thất bại; chạm ngưỡng thì nonce bị burn và phải xin challenge mới. Bộ đếm nằm ở cả
ba nhánh thất bại — mismatch challenge, key unavailable, signature invalid — nếu chỉ
đếm nhánh chữ ký thì attacker chỉ cần đổi nhánh để né.

Evidence: `test/paper-bukkit-attempt-threshold.test.ts`, 3 test GREEN (4 lần sai vẫn
retry được; 5 lần thì burn; mismatch cũng tính vào ngưỡng). Bốn test cũ trong
`paper-bukkit-online-player-claim.test.ts` vẫn PASS — contract retry không đổi.

**BC-001 + BC-013 — ĐÃ SỬA (phần offline) 2026-09-07.**

- `PaperBukkitOnlinePlayerAdapterConfig.java` (mới) — parser strict, fail-closed:
  mọi field bắt buộc và bounded (port, timeout, ledger, các ID, ba SHA-256 hex chữ
  thường). Lỗi ném mã cố định, **không bao giờ echo giá trị sai**.
- `PaperBukkitOnlinePlayerPlugin.java` — không còn chỉ log. Nay: parse config →
  resolve companion plugin → dựng `AdapterRuntimeFactory` → `RuntimeComposition
  .register(...)`. `onDisable` đóng composition. Ba nhánh lỗi (config sai, companion
  vắng, register hỏng) đều log mã cố định rồi `return` ngay — không bind socket.
- `paper-bukkit-adapter/src/main/resources/config.yml` (mới) — chỉ chứa public
  identifier. Ghi rõ hai thứ **cố ý không cấu hình được**: bind address luôn
  `127.0.0.1`, và `claimedBootId`.
- **BC-013**: `claimedBootId` nay mint từ `SecureRandom` mỗi lần `onEnable`, giữ
  trong memory, đúng như quyết định P0.3 yêu cầu. Hai boot của cùng một server cấu
  hình giống nhau nay tạo claim khác nhau, nên claim của boot A không thể dùng làm
  bằng chứng về boot B. `server.instance-id` vẫn durable — nó trả lời "server nào",
  không phải "boot nào".

Evidence (OBSERVED):

- `gradlew build` cả hai module exit `0`.
- Test mới `test/paper-adapter-lifecycle-wiring.test.ts`, 5 test GREEN: khoá việc
  compose runtime, ba nhánh fail-closed, boot id không đến từ config, parser không
  echo giá trị, và config.yml không chứa key material.
- Bốn test cũ pin trạng thái "chưa wire" đã được cập nhật **có chú thích lý do**:
  `paper-bukkit-adapter-package`, `java-bukkit-snapshot-adapter`,
  `java-lifecycle-composition`, `java-services-bootstrap`. Các invariant an toàn
  giữ nguyên — plugin main vẫn không import `java.net`/`java.security`, không tự
  gọi `getOnlinePlayers`, không tự mở socket/KeyStore/Signature, không tự resolve
  service.
- Full gate: `794 total / 788 pass / 0 fail / 6 skip`; `COVERAGE=0 BUILD=0
  DIFFCHECK=0`. Sàn nâng lên `788`.

Ghi chú trung thực: đây là **lifecycle wiring**, không phải runtime evidence. Chưa
có gì chứng minh Paper thật load đúng thứ tự hai plugin, rằng coordinator nhận được
service-register event, rằng listener bind được port, hay rằng một claim ký được.

**Còn lại của Slice 6**: chỉ còn controlled Paper 1.21.11 E2E — **bước duy nhất
chạm server thật, cần approval riêng**.

**BC-002 — ĐÃ SỬA (phần offline) 2026-09-07.**

`src/paper-bukkit-online-player-runtime.ts` (mới) —
`createPaperBukkitOnlinePlayerVerifiedOnlinePlayerSource()` sở hữu một verifier
instance và chạy trọn vòng: phát challenge cho exact target binding của run → đẩy
qua loopback client → `verifyAndConsume` phản hồi đã ký → kiểm lại
`targetBindingSha256` khớp binding mong đợi. Lỗi ở bất kỳ bước nào đều sanitize
thành một thông điệp cố định, không rò chi tiết transport/verifier.

`toPreflightFacts()` là chỗ thay thế thật sự cho fact caller-supplied: nó **ném**
nếu caller cố truyền `onlinePlayers`, và gắn nhãn `onlinePlayersFactSource:
'verified-signed-claim'` để reviewer đọc report phân biệt được scalar đã ký với
metadata do người gọi tự khai.

Evidence (OBSERVED):

- Test mới `test/paper-bukkit-online-player-runtime.test.ts`, 3 test RED → GREEN:
  vòng đầy đủ trả `onlinePlayers: 7` với `signatureVerified/nonceConsumed` true và
  `releaseEligible: false`; adapter ký bằng khoá khác bị từ chối; caller bơm
  `onlinePlayers: 999` bị ném.
- Import graph tự phản ánh thay đổi: `paper-bukkit-online-player-claim` nay có
  **hai** importer (`transport-codec` và `runtime`) thay vì một. Test cũ pin một
  importer đã được cập nhật kèm lý do — chính con số đó là bằng chứng verifier
  trước đây không bao giờ được gọi ngoài test.
- Full gate: `797 total / 791 pass / 0 fail / 6 skip`; `COVERAGE=0 BUILD=0
  DIFFCHECK=0`. Sàn nâng lên `791`.

Ghi chú trung thực: composition được test bằng adapter giả in-process ký đúng
canonical payload. Nó chứng minh **wire contract và trust boundary**, không chứng
minh Paper thật, custody khóa, hay danh tính process. Composition cũng chưa được
`server.ts`/`runner.ts` gọi — nó là API sẵn sàng cho operator, chưa phải default
path, đúng như thiết kế "mặc định tắt".

### Slice 6 — kế hoạch gốc (giữ để tham chiếu)

**BC-011 — ĐÃ SỬA 2026-09-07.** Companion từ một class lẻ không ai biên dịch thành
artifact triển khai được:

- `paper-bukkit-adapter/settings.gradle.kts` — `include("keystore-companion")`.
- `keystore-companion/build.gradle.kts` (mới) — JDK 21, Paper API compile-only,
  `compileOnly(project(":"))` để dùng **chung exact service Class** của adapter.
  Không shade/relocate: nếu shade, `ServicesManager` sẽ thấy hai Class khác nhau và
  lookup của adapter không bao giờ khớp.
- `PaperBukkitOnlinePlayerKeyStoreCompanionPlugin.java` (mới) — `extends JavaPlugin`,
  mở PKCS12 rồi đăng ký qua `PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration
  .register(...)`. `onDisable` đóng **registration trước, custody sau** — ngược lại
  thì adapter có thể còn lease trỏ vào key đã đóng.
- `plugin.yml` + `config.yml` (mới) — `depend: [BotCheckerPaperAdapter]`;
  config chỉ giữ metadata: path, alias, và **TÊN** biến môi trường chứa password,
  không bao giờ giữ chính password.
- Fail-closed: config thiếu/không hợp lệ → không đăng ký service, log một mã cố
  định. Adapter khi đó không tìm thấy provider và nằm im — đúng ý đồ, nó không được
  phép rơi xuống nguồn khóa yếu hơn.

Evidence (OBSERVED):

- `gradlew build` (cả hai module) exit `0`; JAR companion thật sự chứa
  `PaperBukkitOnlinePlayerKeyStoreCompanionPlugin.class`, `plugin.yml` đã expand
  `version: '0.1.0-SNAPSHOT'`, `config.yml`, và `depend: [BotCheckerPaperAdapter]`.
- Test mới `test/keystore-companion-package.test.ts`, 5 test GREEN, gồm một test
  khoá **thứ tự teardown** và một test quét mọi lệnh log để chắc không có giá trị
  động (path/alias/password/exception) lọt vào log.
- `build-paper-adapter.mjs` nay báo `built 18 Java sources (adapter +
  keystore-companion subproject)`; capability provenance vẫn khớp.
- Full gate: `786 total / 780 pass / 0 fail / 6 skip`; `COVERAGE=0 BUILD=0
  DIFFCHECK=0`. Sàn skip gate nâng lên `780`.

Ghi chú trung thực: đây là bằng chứng **đóng gói và biên dịch**, không phải bằng
chứng lifecycle. Chưa có gì chứng minh Paper thật load được cặp plugin này, rằng
`ServicesManager` resolve đúng một provider, hay rằng adapter ký được — những điều
đó chỉ controlled Paper runtime mới trả lời được.

**Phần còn lại của Slice 6 chưa bắt đầu** (BC-001, 002, 013): `config.yml` strict + wire `onEnable/onDisable`; boot
identity derive từ fact quan sát được thay vì literal; Node composition
challenge → loopback → `verifyAndConsume`. Sau đó mới tới controlled Paper E2E —
**bước duy nhất chạm server thật, cần approval riêng**.

### Slice 6 — kế hoạch gốc (giữ để tham chiếu)

Sửa BC-001, BC-002, BC-011, BC-012, BC-013.

- `keystore-companion` thành Gradle subproject có `plugin.yml` + `JavaPlugin` +
  `ServicesManager.register/unregister`.
- `config.yml` strict cho adapter; `onEnable/onDisable` compose đúng một
  `RuntimeComposition`; thiếu config → không bind socket.
- Boot identity derive từ fact quan sát được (session-lock identity / TCP owner PID
  / boot token mint lúc enable), không phải literal config.
- Chốt và ghi đúng posture xác thực của transport; `setSoTimeout` trước `claim()`.
- Node: một composition module issue challenge → loopback → `verifyAndConsume` →
  feed scalar đã verify vào preflight.
- Sau đó mới chạy **một** controlled Paper 1.21.11 runtime E2E.

Done when: controlled Paper load cả hai plugin; adapter bind đúng port cấu hình;
Node hoàn tất challenge → signed response → verify → one-time consume với boot
identity preflight cross-check được; nonce replay bị từ chối; disable/stop sạch
không sót listener/thread — tất cả nằm trong một sealed bundle.

Slice 6 là slice duy nhất chạm server Paper thật và **cần approval riêng**. Năm
slice trước làm giảm blast radius của nó.

---

## Nonclaims của chính tài liệu này

Audit này là static + probe cục bộ. Nó không chứng minh Paper lifecycle, custody
khóa, restart/crash, performance hay production. Không có deploy, restart, hay
thay đổi production nào xảy ra. Không source file nào bị sửa trong đợt audit này.
