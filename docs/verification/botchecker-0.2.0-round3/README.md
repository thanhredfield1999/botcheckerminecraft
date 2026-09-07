# BotChecker 0.2.0 — offline candidate evidence

Date: 2026-09-08. This is an internal review candidate, NOT a release or deployment approval.

## Verified scope

- `gate.json`: ordered typecheck → complete test suite/skip floor → build → diff-check.
  880 total / 874 pass / 0 fail / 6 skip on Windows, Node 24.14.0, javac 25.0.1.
  The 375 source/test/build-input SHA-256 bindings were checked unchanged after the gate.
  Documentation/checkpoint additions occurred after the gate; they are not executable inputs.
- `full-gate.log`, `build.log`, `diff-check.log`: command summaries from the successful runs.
  Gradle log trailing whitespace was normalized for the staged diff check; messages
  and results are unchanged.
- `gradle-rebuild.log`: adapter and companion rebuilt with `--rerun-tasks`, six tasks executed.
  Both JARs have version 0.2.0-SNAPSHOT, API minimum 1.21.11 and class major 65.
  Gradle test tasks are NO-SOURCE; Node tests drive the separate Java fixtures.
- `strict-forward.log`: required compile probe on stable Paper API 26.2.build.121-stable,
  19 main Java sources, JDK25 with `--release 21`. Compile-only, not Paper runtime proof.
- `built-smoke.mjs` and `built-smoke.log`: real compiled `dist/src` code with an injected
  protocol source. The test exercises NFC/NFD and case normalization, exact UUID,
  count dwell (three samples over at least 200 ms), schema rejection and sealed persistence.
  It creates no Minecraft socket and deletes only its own temporary report directory.
  Re-run from the canonical checkout with `node docs/verification/botchecker-0.2.0-round3/built-smoke.mjs`.
- `consumers.json`: five parent contract checks and ten parsed draft scenarios; exact
  source/draft hashes match. These do NOT run the five plugins or their own test suites.

## Review provenance

`opus-initial-review.txt` and `opus-correction-review.txt` retain the supplied-source
review responses. `review-dispositions.json` records every finding, the parent's
reproduction/rejection evidence and limits. The last review's top-level PASS included
two low findings; both were reproduced RED and corrected GREEN afterwards. Do not
interpret that response as an independent exact-final-tree zero-findings signoff.

All five independent consumer reviewers failed infrastructure; no final consumer
runtime reports or approval were obtained. Parent contracts are not substitutes.

## Candidate packaging and Git

The package is an offline repository-bound review snapshot under `dist/candidates/`,
with a content-derived filename, `.manifest.json` and `.sha256` sidecars. It contains
sources, tests, compiled code, two JARs and this evidence. Per-file and ZIP hashes are
verified after writing. It omits dependencies, Git metadata, credentials and server data.
The runtime capability collector needs the canonical Git checkout; the ZIP is not a
standalone installer. Never deploy the JARs from it merely because compilation passed.

`gate.json.gitHead` is the pre-commit baseline; `sourceBindings` identify the tested
working tree. The user subsequently authorized a local commit. The commit containing
this document records the source checkpoint; archive/checksum files remain ignored and
are not Git release assets. No push or tag was requested.

## Still unverified / retained limits

- Controlled Paper floor/latest lifecycle, dependency registration, listener binding,
  signed claim production and full consumer journeys; no production operation occurred.
- Server-authoritative item identity/PDC, anti-dupe, crash recovery, concurrency,
  client GUI drag and cross-project release admission.
- Capture uses bounded wall-clock regex work. CPU starvation can conservatively return
  INCONCLUSIVE. Test concurrency is limited to two; production budget was not relaxed.
- Directly invoking public `persistCancelled()` during an active run bypasses the HTTP
  lifecycle contract and can double-persist a sealed bundle. Supported HTTP paths call
  `cancel()` first and await completion. This unsupported direct-use case was documented,
  not redesigned in the bounded correction.
- Forward compile uses the current dependency closure, not a general Maven resolver.
- Gradle reports deprecations for future Gradle 10. POSIX/CI execution and runtime across
  future releases are not inferred from this Windows gate.
