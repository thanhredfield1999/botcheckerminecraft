# Google Cloud KMS HSM trust-root policy D4d — caller-supplied resolver

Date: 2026-08-30

## Verdict

`VERIFIED offline/library-only` at source, test and build level for a strict
caller-supplied policy resolver and a policy-aware D4c-c compositor.

This slice does not establish production trust roots. It does not authenticate a
policy source, verify a policy signature, persist a rollback high-water mark, supply
trusted time, create ADC credentials, perform a signing operation, or wire manual
preflight, report, server, Paper or deployment paths.

Claim/import review `deleg_6381866a`: `PASS`, `0` blocker / `0` high / `0`
medium / `0` low. Initial implementation review found `D4D-HIGH-001`; final
correction review `deleg_1fe99168`: `PASS`, `0/0/0/0`, HIGH `CLOSED`.

## External contract boundary

Cloud KMS returns an HSM-generated attestation plus certificate chains used to
validate it.[1][2] Google's verification guide and pinned sample explain certificate
chain and attestation verification, but the REST `KeyOperationAttestation` contract
only exposes attestation content and three ordered repeated certificate-chain fields;
it does not define a versioned root allowlist, rotation overlap, retirement, source
authenticity or rollback-state contract.[1][2][3]

D4d therefore treats every policy as caller-supplied local data. It does not label
that policy as Google-authenticated or production-approved.

## Resolver contract

`resolveGoogleCloudKmsHsmTrustRootPolicy` accepts exactly:

- schema-v1 raw policy;
- expected policy ID;
- expected root-set ID;
- minimum caller-required revision;
- caller-supplied verification time.

The resolver:

- rejects unknown input, policy and root-set fields;
- bounds policy/root-set IDs, revision, time, root count, PEM size and SHA-256 pins;
- snapshots each top-level and nested field once;
- rejects changing collection cardinality, duplicate root-set IDs, malformed pins,
  invalid windows, unknown IDs, retired sets and revision rollback below the caller
  floor;
- strict-parses each root as one certificate PEM and requires the declared SHA-256
  to equal the exact parsed DER bytes before composition or KMS RPC;
- uses half-open windows `[notBeforeMs, notAfterMs)`;
- allows rotation overlap only when the caller pins the exact active root-set ID;
- canonicalizes root sets in ASCII ID order and returns a deterministic policy
  SHA-256 independent of input order or ambient locale;
- returns frozen selected roots for D4c-c while keeping policy signature, source
  authenticity, rollback protection, trusted time and production-root claims false.

`minimumRevision` is only a caller-provided floor for this invocation. No durable
high-water state exists, so `rollbackProtectionVerified=false` remains mandatory.

## Policy-aware attestation composition

`attestAndVerifyGoogleCloudKmsHsmEd25519KeyWithTrustRootPolicy` accepts the raw policy,
not a caller-materialized resolution object. It snapshots its exact eight input fields,
resolves policy synchronously before any KMS RPC, then passes only the selected frozen
root snapshot into the existing D4c-c single-call verifier.

A success means:

- exact caller policy/root-set/revision/time selection passed;
- D4c-c cryptographically verified the SDK attestation snapshot against the selected
  caller-policy roots;
- the public result carries policy ID, revision, selected root-set ID and canonical
  policy SHA-256 without PEM material.

It does not mean:

- the policy came from Google or Marvell;
- the policy was signed;
- rollback was durably prevented;
- caller time was trusted;
- selected roots are authoritative production roots;
- live resource existence, IAM, provisioning, custody, runtime or deployment was
  verified.

## Capability and import boundary

Both capabilities are `library-only`:

- `google-cloud-kms-hsm-trust-root-policy`;
- `google-cloud-kms-hsm-policy-attestation-bridge`.

The resolver's only direct source importer is the D4d compositor. The compositor has
no downstream source importer. Neither module reads files/environment, fetches
network data, creates ADC clients/private keys, calls `asymmetricSign`, or imports
manual-preflight/server/report/Paper code.

## TDD and verification evidence

Observed RED→GREEN tracers include:

1. resolver module missing;
2. unknown policy/root-set fields silently ignored;
3. repeated top-level `rootSets` getter reads;
4. repeated nested PEM getter reads;
5. Proxy cardinality change hid an extra root set;
6. rotation overlap could not select an exact caller-pinned active set;
7. unknown resolver-input field silently ignored;
8. canonical hash depended on ambient `localeCompare`;
9. policy-aware compositor module missing;
10. unknown compositor input field silently ignored.
11. valid PEM plus a different well-shaped SHA-256 pin passed resolver selection and
    reached KMS RPCs before D4c-c rejected it; exact PEM/DER hash matching now rejects
    before composition.

Pre-correction focused D1–D4d/capability gate:

```text
68 total / 68 pass / 0 fail / 0 skip
```

Exact-current correction gate:

```text
34 total / 34 pass / 0 fail / 0 skip
```

Exact-current full ordered gate:

```text
npm test && npm run typecheck && npm run build && git diff --check
547 total / 543 pass / 0 fail / 4 skip
TypeScript typecheck, TypeScript/Java build and diff-check PASS
```

## Remaining blockers

- authoritative manufacturer and owner root bytes from reviewable official sources;
- exact production fingerprints, cardinality and rotation/retirement policy;
- authenticated policy distribution and durable rollback protection;
- trusted time, revocation and full path-policy validation;
- explicit approved configuration before manual preflight composition;
- authorized live KMS/IAM/provisioning/custody evidence;
- report/runtime/Paper integration behind a separate release gate.

## Sources

[1] https://cloud.google.com/kms/docs/attest-key
[2] https://cloud.google.com/kms/docs/reference/rest/v1/KeyOperationAttestation
[3] https://github.com/GoogleCloudPlatform/python-docs-samples/blob/9b7c9acbb8f17500bbde1a9c2020496e5d39b8ed/kms/attestations/verify_attestation_chains.py
