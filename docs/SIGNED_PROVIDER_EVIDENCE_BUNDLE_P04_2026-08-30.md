# P0.4 signed-provider evidence bundle verifier

Date: 2026-08-30

## Verdict

`VERIFIED offline/library-only partial` at source, test and build level.

The slice can independently re-verify one sealed evidence bundle that contains:

- exactly one report artifact;
- exactly one `provider-evidence` artifact containing a canonical
  `jvm-observation-bound-v2` signed-provider envelope.

At the original P0.4 checkpoint this was not runner, HTTP server, Paper, Bukkit,
production probe, release-admission or deployment wiring. A later optional
`TestRun` persistence slice can now create the report reference and seal one
factory-supplied envelope, but it does not call this verifier or verify the
signature while writing. The default HTTP server remains unwired.

The later persistence slice observed RED because `TestRun` did not call the
factory, then GREEN after the minimal integration. Its exact-current focused
report/P0.4/target/counterexample gate is `25/25` PASS; full ordered gate is
`566 total / 562 pass / 0 fail / 4 skip`, with typecheck, TypeScript/Java build,
added-line security scan and diff-check PASS.

Independent review found and closed two persistence-path counterexamples: the
writer now orders provider evidence before a referencing report, and the runner
deep-freezes its target binding so an injected callback cannot mutate internal
binding state through `run.report()` while awaited. The persisted reference also
states `signatureVerified: false`; signature verification remains the separate
verifier's responsibility.

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

- Optional `TestRun` persistence can request, structurally bind, reference and
  seal a signed-provider artifact. It deliberately does not verify the signature;
  this verifier remains a separate explicit consumer.
- Default HTTP server and release admission do not configure the factory or call
  this verifier.
- A generic library-only observer-to-opaque-signer pipeline now exists. It validates
  exact challenge/target/candidate structure, reassesses the non-authoritative JVM
  observation and delegates canonical signing with bounded timeout/cancellation.
  It does not consume nonce state or prove observer/clock/boot/config/runtime truth.
- A Java-only `PaperJvmObservationPort` contract now enforces primary-thread capture,
  off-thread bounded one-shot observation and non-authoritative output. It imports no
  Bukkit/Paper API and has no scheduler, lifecycle, transport, signer or deployment
  wiring. No production Paper/Bukkit observer-to-signer plugin adapter exists.
- A transport-neutral Java/Node codec canonicalizes one public result in a strict,
  bounded `16 KiB` JSON v1 envelope. A library-only byte-provider adapter is now the
  codec's sole source importer and composes one injected canonical-byte callback into
  the existing observer-signing pipeline; offline signer/verifier composition passes.
  It forwards abort/challenge/candidate input but adds no process/socket/HTTP/Paper
  scheduler I/O. Callback origin, port provenance, challenge issuance/freshness,
  runtime identity, custody and release remain unauthenticated or unproven.
- A library-only Java bridge now requires exact time/server/boot equality between a
  caller-supplied canonical claims record and one port result, then delegates exact
  candidate/hash/posture validation and v2 canonical bytes to the existing builder.
  Because the result record is publicly constructible, this is consistency binding,
  not proof of port provenance, challenge issuance, freshness or nonce consumption.
- Effective configuration, true boot/server-instance identity, trusted key custody,
  provisioning, trusted clock and controlled Paper evidence remain unverified.
- No production deployment, restart, reload or live operation was performed.
