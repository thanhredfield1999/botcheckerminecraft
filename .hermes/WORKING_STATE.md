# BotChecker working state

## 2026-09-19 — CONTROLLED PAPER JOURNEY VERIFIED (runtime evidence đạt)

- Đã chạy thành công journey Paper thật lần đầu: Paper 1.21.11 + JDK21, isolated root
  `E:/AI.WORK/botchecker-runtime/controlled-paper-journey-20260919b`, adapter loopback 25680 /
  Minecraft 25681, flat offline world. Kết quả evidence (`docs/evidence/controlled-paper-journey-20260919/`):
  ready=true; claim.verified=true, onlinePlayers=0, claimedServerInstanceId=controlled-paper-a,
  bootId per-boot (boot-0a1377...), replayRejected=true; stop exit 0, cả 2 plugin
  Disabling trong log; port đóng, không orphan java. 2 lượt chạy (round1 initial + round2
  refactored) đều PASS.
- Code mới (đã trong tree, chưa commit): `src/e2e/controlled-paper-executor.ts` (14 test;
  config builders/spawn args/readiness/replay/stop fail-closed) + `scripts/controlled-paper-journey.mjs`
  + `scripts/provision-controlled-paper-keystore.mjs` + 2 npm scripts. Runtime composition
  `paper-bukkit-online-player-runtime.ts` thêm `replayAttemptRejected()` (test RED→GREEN).
  Executor tiêu thụ composition (đường sanctioned) — claim module KHÔNG thêm importer.
- VERIFIED 19/09: full gate `npm run typecheck && npm run verify:coverage-floor && npm test &&
  npm run build && git diff --check` → exit 0; 907 total / 901 pass / 0 fail / 6 skip; build
  19 Java sources.
- Keystore test operator-owned ngoài repo (`botchecker-runtime/artifacts/controlled-test-*.p12`),
  password chỉ qua env var cho JVM, không bao giờ vào repo/argv/evidence. Paper JAR copy read-only
  từ fixture ItemGuard `09a53fc5c744` → `botchecker-runtime/artifacts/paper-1.21.11.jar`
  (sha 6c0995...). Không commit/push. Không production/deploy.
- Còn mở (claim không overclaim): onlinePlayers=0 chỉ chứng minh pipeline trên server rỗng;
  chưa có multi-player accuracy, restart/crash, drag/multiplayer/anti-dupe journey, keystore
  custody thật, release eligibility. `releaseEligible:false`.

## 2026-09-19 — Controlled-Paper harness WIP verified (offline), runtime blocker

- WIP 13/09 (chưa commit): `src/e2e/controlled-paper-harness.ts` (preflight + run plan fail-closed,
  không spawn/socket/download), `scripts/controlled-paper-preflight.mjs` (CLI),
  `test/controlled-paper-harness.test.ts` (7), `test/controlled-paper-preflight-cli.test.ts` (1),
  `docs/controlled-paper-e2e-harness.md` (scope: chuẩn bị input non-secret cho journey Paper
  cô lập; PAPER_JAR_MISSING/KEYSTORE_MISSING block deterministic; operation thứ ba là
  await-explicit-runtime-approval). Kèm zigzag observer (3 test) giữ nguyên, ngoài scope.
- VERIFIED 19/09 trên tree đang có: `npm run typecheck && npm run verify:coverage-floor &&
  npm test && npm run build && git diff --check` → exit 0; 892 total / 886 pass / 0 fail /
  6 skip; build 19 Java sources (adapter + keystore-companion). Tự review harness: chặn
  secret-shaped field (deny-list + strict schema), root/artifact ngoài repo + realpath,
  symlink/junction/proxy fail-closed, plan đóng băng, ready chỉ khi 2 artifact ngoài repo
  là regular file. Không runtime claim. 3 reviewer độc lập 13/09 đều FAIL infra (timeout
  Opus), không có verdict độc lập — tự review thay thế, ghi rõ giới hạn.
- Game plan run plan: materialize-isolated-root → write-non-secret-config →
  await-explicit-runtime-approval. Executor đã tồn tại từ 19/09 (SUPERSEDED bởi section trên).
- BLOCKER cũ (đã resolve 19/09): Paper JAR ngoài repo, PKCS12 operator-owned, approval runtime —
  cả ba đã có: copy paper.jar read-only từ fixture ItemGuard, keystore test provisioned ngoài repo,
  Thanh duyệt "okey lam đi". SUPPERSEDED bởi section trên.
- Chưa commit (chưa được yêu cầu). Zigzag observer + controlled-paper WIP giữ untracked.

- Canonical repo: `E:/AI.WORK/botcheckerminecraft-botchecker`, branch `main`.
- Gate baseline HEAD: `7501337490153b7b5533ca1d17e0c8f91d1eec2b` + dirty tree;
  exact source/test/build inputs are bound by 375 SHA-256 entries in
  `docs/verification/botchecker-0.2.0-round3/gate.json`.
- User authorized local commit after completion. Obtain the resulting commit with
  `git log -1`; this checkpoint intentionally does not guess its own future commit ID.
- Ordered gate: typecheck → skip-floor/full test → build → diff-check, exit 0;
  880 total / 874 pass / 0 fail / 6 skip. Built-JS injected smoke PASS, no MC socket.
- Gradle rerun: 6 tasks executed; two 0.2.0-SNAPSHOT JARs, API floor 1.21.11,
  Java major 65. Required Paper forward compile 26.2.build.121-stable PASS;
  neither compile nor injected smoke proves Paper runtime.
- Fixed selector Unicode/case consistency, count stability/timeouts, inventory
  ownership guards, drop interruption/late evidence, capture bounds and forward probe.
- Bounded Opus review + parent RED/GREEN corrections; NOT clean release signoff.
- Five parent consumer contracts PASS; ten drafts parse, bindings match. All five
  independent consumer reviewers failed infrastructure; no final project signoff.
- Packaging/evidence instructions: `docs/verification/botchecker-0.2.0-round3/README.md`.
- Candidate remains NOT RELEASED. No push/deploy/restart/production or consumer pins.
- Remaining: approved isolated Paper lifecycle/claim journey, floor/latest runtime,
  actual consumer runs/reports, drag/multiplayer/restart/anti-dupe. Direct use of
  `persistCancelled()` on an active run is unsupported; use `cancel()` and await it.
- Preserve `.codegraph/`, older `.hermes/plans/`, `docs/evidence/`, and
  `reports-anticheat*` as unrelated/untracked; do not sweep them into this commit.

## Historical checkpoint — P0.4 (superseded; do not resume it)

### Repo / Git

- Canonical repo: `E:\AI.WORK\botcheckerminecraft-botchecker`.
- Branch: `main`.
- Current committed HEAD: `458308f` (`Khóa chính sách trust-root KMS D4d`).
- Branch ahead `origin/main` 19 commits; chưa push.
- P0.4 working tree cố ý dirty; staged `0`.
- Protected/unrelated untracked: `.hermes/WORKING_STATE.md`, `.hermes/plans/...`,
  `reports-anticheat*`; không stage/chạm ngoài checkpoint này.

### P0.4 exact behavior

- New library-only API `verifySignedProviderObservationBoundBundle` reads one sealed
  bundle with exactly one report and one canonical `jvm-observation-bound-v2`
  provider-evidence artifact.
- It independently verifies bundle/artifact integrity, exact report reference,
  run/scenario/capability/target binding, canonical challenge identity, signed
  structural time window, Ed25519 trust policy and exact non-authoritative candidate
  JVM observation.
- Caller-materialized verification fields are rejected; verification derives from
  the signed envelope bytes and exact built trust-store snapshot.
- Verified bundle snapshot is deep-frozen and exposes canonical base64 strings rather
  than mutable Buffer aliases.
- Generic bundle writer/verifier enforce 64 MiB aggregate artifact bytes in addition
  to existing 16 MiB per-artifact and 128-artifact caps.
- Writer rejects Proxy artifact collections before trusting `length`, snapshots
  top-level/artifact fields and requires exact dense own indices plus stable
  cardinality before filesystem I/O.
- Output keeps bundle/report authenticity, report-verdict authentication, challenge
  issuance, freshness/replay/consume, trusted time, trust-store provenance/rollback,
  custody, loaded-bytecode, runtime/production/release claims false.
- Capability `signed-provider-evidence-bundle-verifier` is `library-only`; no
  runner/server/report-persistence/Paper/manual importer exists.

### Review correction

- Claim/capability/import review `deleg_342792c0`: PASS `0/0/0/0`.
- Initial implementation review `deleg_c1983ede`: FAIL with one HIGH because hostile
  Proxy cardinality could persist 129 partial artifacts before late schema rejection.
- RED reproduced the original Proxy and a stronger variant lying through both
  `ownKeys` and `length`.
- Final correction review `deleg_167e22f7`: PASS `0/0/0/0`; original HIGH `CLOSED`.

### Exact verification

- Focused evidence/P0.4 core: `20/20` PASS.
- Focused broader report/runner/evidence/signed-provider/target/capability gate:
  `63/63` PASS.
- Full ordered gate:
  `npm test && npm run typecheck && npm run build && git diff --check`
  → `561 total / 557 pass / 0 fail / 4 skip`; TypeScript/Java build PASS.
- Focused production-source security/overclaim scan: PASS.
- Exact P0.4 scope: 10 files; staged `0`; diff-check PASS.

### Intended P0.4 allowlist (10 files)

1. `CURRENT_STATE.md`
2. `README.md`
3. `docs/BOTCHECKER_CAPABILITY_GAPS_2026-08-27.md`
4. `docs/SIGNED_PROVIDER_EVIDENCE_BUNDLE_P04_2026-08-30.md`
5. `src/capability-manifest.ts`
6. `src/evidence-bundle.ts`
7. `src/signed-provider-evidence-bundle.ts`
8. `test/capability-manifest.test.ts`
9. `test/evidence-bundle.test.ts`
10. `test/signed-provider-evidence-bundle.test.ts`

### Remaining blockers / next safe step

- P0.4 remains `PARTIAL`: TestRun does not create/reference signed-provider evidence;
  HTTP server, report persistence and release admission do not call the verifier.
- Production Paper/Bukkit observer-to-signer adapter, trusted key custody/provisioning,
  effective config/boot/server-instance truth, trusted time and controlled runtime
  evidence remain `NOT VERIFIED`.
- No live operation, server start/restart, deployment or production change occurred.
- Next session: read this checkpoint, re-check Git/source/tests, then ask user whether
  to commit exact 10-file P0.4 slice or continue the next integration slice.
- Do not stage, commit or push until the user explicitly asks.
