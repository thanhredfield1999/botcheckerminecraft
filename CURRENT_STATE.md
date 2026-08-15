# BotChecker Current State

Last reviewed: 2026-08-15

## Baseline

- Package version: `0.1.0`.
- Runtime: Node.js `22+`, TypeScript ESM.
- Product: Mineflayer-based Minecraft player-journey and GUI tester exposed through
  a private HTTP API.

## Implemented Behavior

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

## Verification

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
