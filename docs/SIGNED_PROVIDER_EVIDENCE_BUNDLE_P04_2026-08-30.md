# P0.4 signed-provider evidence bundle verifier

Date: 2026-08-30

## Verdict

`VERIFIED offline/library-only partial` at source, test and build level.

The slice can independently re-verify one sealed evidence bundle that contains:

- exactly one report artifact;
- exactly one `provider-evidence` artifact containing a canonical
  `jvm-observation-bound-v2` signed-provider envelope.

This is not runner, HTTP server, Paper, Bukkit, production probe, release-admission
or deployment wiring.

## Verified local behavior

The verifier:

1. snapshots and verifies the bundle seal and every artifact byte/hash once;
2. uses an immutable in-memory snapshot whose content is exposed only as canonical
   base64 strings, not writable `Buffer` aliases;
3. requires exact report and provider-evidence cardinality;
4. matches the report reference filename/hash to the sealed provider artifact;
5. matches run ID, top-level/manifest scenario name, scenario hash, optional
   capability source fingerprint, target binding hash and exact target binding;
6. strict-parses the observation-bound envelope, recomputes its canonical challenge
   ID and checks the signed structural window
   `issuedAtMs <= observedAtMs <= expiresAtMs` with `issuedAtMs < expiresAtMs`;
7. verifies the Ed25519 signature through the existing exact built trust-store
   snapshot and matches provider, binding and exact loaded artifact set;
8. reassesses the signed JVM observation and accepts only exact `candidate`
   `TARGET_FILE_MATCH_NON_AUTHORITATIVE` evidence;
9. rejects caller-materialized verification fields instead of trusting them;
10. sanitizes the public failure boundary.

Generic bundle writer/verifier now enforce a `64 MiB` aggregate artifact-byte cap,
in addition to the existing `16 MiB` per-artifact and `128` artifact caps. The
verifier rejects an oversized aggregate after validating the seal and before any
artifact I/O; the writer rejects after copying caller bytes but before destination
filesystem I/O.

## Explicit non-claims

A successful result says only that the sealed bytes are internally consistent and
that the provider envelope signature verifies under the supplied exact local trust
snapshot.

The result explicitly keeps all of these false:

- bundle or report authenticity;
- authentication of the report's functional verdict;
- challenge issuance proof;
- freshness, replay checking or nonce consumption;
- trusted verification time;
- trust-store source authenticity or rollback protection;
- provider signing-key custody;
- authoritative JVM loaded-bytecode proof;
- runtime wiring, production readiness or release eligibility.

`reportedFunctionalVerdict` is only the verdict read from the integrity-checked
report. `functionalVerdictAuthenticated` is always `false` because the provider
signature covers the provider claims and JVM observation, not the report document.

Structural comparison of signed timestamps does not establish a trusted clock or a
fresh live challenge.

## TDD evidence

Observed RED then GREEN regressions cover:

- module/API absence;
- verification-time getter mutation across filesystem `await`;
- forged caller-materialized verification input;
- non-canonical challenge identity;
- scenario hash mismatch;
- capability source fingerprint mismatch;
- top-level versus manifest scenario mismatch;
- signed observation outside its signed challenge window;
- mutable verified snapshot aliases;
- verifier aggregate-byte exhaustion before artifact I/O;
- writer aggregate-byte exhaustion before persistence;
- hostile Proxy cardinality changing from `1` to `129` without leaving partial
  artifacts;
- hostile Proxy lying through both `ownKeys` and `length`.

Exact-current local results before documentation-only edits:

- focused evidence/P0.4 core after final Proxy correction: `20/20` PASS;
- focused report/runner/evidence/signed-provider/target/capability gate before the
  final documentation-only edits: `63/63` PASS;
- full ordered gate after all source/test corrections:
  `561 total / 557 pass / 0 fail / 4 skip`;
- `npm run typecheck`: PASS;
- `npm run build`: PASS, including TypeScript and Java 21 build;
- `git diff --check`: PASS;
- focused production-source security scan: PASS.

## Independent review

- Claim/capability/import-graph review: PASS,
  `0 blocker / 0 high / 0 medium / 0 low`.
- Initial implementation review: FAIL with one HIGH because hostile Proxy
  cardinality could persist partial files before late rejection. RED reproduced
  the counterexample.
- Exact-current correction review `deleg_167e22f7`: PASS,
  `0 blocker / 0 high / 0 medium / 0 low`; the initial HIGH is `CLOSED`.

## Remaining P0.4 gaps

- `TestRun` does not yet generate or reference a signed-provider evidence artifact.
- HTTP server, report persistence and release admission do not call this verifier.
- No production Paper/Bukkit observer-to-signer adapter exists.
- Effective configuration, true boot/server-instance identity, trusted key custody,
  provisioning, trusted clock and controlled Paper evidence remain unverified.
- No production deployment, restart, reload or live operation was performed.
