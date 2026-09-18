# BotChecker consumer journey — ItemGuard LITE 1.0.0 (VERIFIED)

Date: 2026-09-19. First real CONSUMER runtime evidence: the actual BotChecker HTTP server +
scenario runner drove a REAL third-party plugin's GUI on a controlled Paper server, and the
resulting report is a real BotChecker report — not a parent-authored contract or a stub.

## What ran

- Controlled Paper 1.21.11 (paperclip build, sha `6c0995...`), JDK21, isolated root
  `E:/AI.WORK/botchecker-runtime/controlled-paper-consumer-20260919`, MC port 25681,
  adapter loopback 25680, BotChecker API `127.0.0.1:28080`.
- Plugins booted on Paper (OBSERVED in latest.log): BotCheckerPaperAdapter v0.2.0-SNAPSHOT,
  BotCheckerKeyStoreCompanion v0.2.0-SNAPSHOT, **ItemGuard v1.0.0-lite** (sha-256
  `8c0e540ec646ffec38cd1409cb69b8c339d1d83f7ba499841bbe6866d624ce4a` — the release candidate
  from `ItemGuard/release/upload/`), LiteProbe v1. `[ItemGuard] SQLite database initialized:
  itemguard.db` and `[ItemGuard] ItemGuard v1.0.0-lite is enabled` both present.
- The REAL BotChecker HTTP server (`dist/src/index.js`) was started pointed at that Paper via
  env (MC_HOST/MC_PORT/MC_USERNAME=ConsumerBot/MC_AUTH=offline/MC_VERSION=1.21.11). A run was
  created over the API, polled to completion, and its report persisted.

## Scenario + result (VERIFIED)

Scenario `scenarios/itemguard-lite-gui.json` (also archived as `scenario.json`):
settle → chat `/ig gui` → `wait_for_gui` titleIncludes "ItemGuard - Recorded item history"
→ observe. Run `a061fbd3-45fa-42e4-9172-ee9443f2b446`:

- status `passed`, verdict `PASS`, steps 4/4 passed / 0 failed / 0 skipped.
- The report (`report.json`) is a genuine BotChecker shell bundle: runId, scenario sha-256,
  capability source fingerprint, executor manifest with sourceRevision `f66f938`, materials
  evidence, step records with the observed GUI window title.

This is black-box consumer evidence: BotChecker asserts ItemGuard's real GUI through a real
protocol client; it never reads ItemGuard source or internals. ItemGuard repo was NOT modified
(read-only reference per AGENTS.md).

## Notable finding (OBSERVED, root-caused)

First run failed `status=failed` with a Paper log: `Failed to decode packet
'serverbound/minecraft:hello'`. Root cause: the configured bot username `HeoMC_ConsumerBot`
is 17 characters — Paper offline-mode names are capped at 16, so the login `hello` field
overruns its packet frame and Paper reports a misleading "decode" error (the failure is not
protocol/version). Changing to `ConsumerBot` (≤16) spawned immediately. The consumer script
now validates `botUsername` (max 16, `[A-Za-z0-9_]`) and fails closed.

## Limits (NOT asserted)

`releaseEligible: false`, `factsAuthoritative: false`, evidenceGrade development-unbound.
One GUI open/observe scenario; no inventory interactions, no multi-player GUI test, no
restart/persistence of reports, no production ItemGuard server. The ItemGuard jar used is the
release candidate; the harness does not validate or sign it as released.