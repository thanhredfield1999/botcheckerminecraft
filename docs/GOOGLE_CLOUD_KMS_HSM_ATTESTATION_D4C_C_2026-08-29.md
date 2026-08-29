# Google Cloud KMS HSM attestation D4c-c — private SDK snapshot bridge

Date: 2026-08-29

## Verdict

`VERIFIED offline/library-only` at source, test and build level for one injected-client
single-call API that obtains the CryptoKeyVersion and public-key SDK responses,
snapshots the exact CAVIUM_V2 gzip bytes, certificate-chain arrays and public PEM,
then invokes D1, D3 and D4c-b internally.

This does not enable the manual ADC preflight, pin production roots, prove a live
Cloud KMS resource exists, perform a signing operation, or verify IAM, provisioning,
custody, trusted time, revocation, runtime wiring or deployment.

## Source contract

Cloud KMS exposes HSM attestation `content` and certificate chains as output-only
fields on `KeyOperationAttestation`; the three chain arrays are Cavium, Google card
and Google partition certificates.[1][2] D4c-c snapshots those SDK values only when
the caller explicitly requests the D4c-c bridge.

The same bounded local CryptoKeyVersion path-shape validator is shared by D1, D2
and D4c-b; it is not an authoritative Cloud KMS naming or existence proof. The
project segment accepts either the bounded project-ID grammar already enforced by
D4c-b or a nonzero project number through signed `int64`; short numeric projects
such as `projects/123` remain valid.[3]

## Implemented boundary

- `attestAndVerifyGoogleCloudKmsHsmEd25519KeyBinding` accepts an injected KMS client,
  exact key-version path, expected Ed25519 SPKI SHA-256, caller time and caller-pinned
  roots;
- it snapshots all top-level fields and all four nested root fields before the first
  `await`, validates local bounds before any RPC, and requests D3 generated-not-
  imported metadata plus D4c-c CAVIUM_V2 binding internally;
- D1 copies the bounded non-shared gzip content, exact `2/1/1` certificate arrays and
  public PEM into a private `WeakMap` entry keyed by the D1-minted attestation object;
- D4c-c accepts only that exact object and exact client identity, then delegates the
  cryptographic envelope/statement/resource/SPKI checks to D4c-b;
- cloned/forged attestation objects, wrong clients, missing snapshots, malformed or
  changing chain arrays, hostile getters, shared backing, invalid caller time and
  mutation after SDK response all fail closed;
- legacy D1 does not read D3/D4c-c getters, and D3 without D4c-c does not read
  certificate chains;
- the public attestation/result contains no raw gzip, certificate chain or PEM;
- the single-call function does not create ADC credentials, call `asymmetricSign`,
  read files/environment or import server/report/runtime code.

## Claim boundary

A success result means D4c-b cryptographically verified the private SDK snapshot
against the roots supplied to this invocation, and the in-process object/client
identity matched the D1 snapshot. It does not turn D3 API metadata into a signed
attestation attribute.

The result therefore records:

- `backendPrivateSnapshotMatched=true`;
- `attestationCryptographicallyVerifiedAgainstCallerPinnedRoots=true`;
- `keyOriginMetadataObserved=GENERATED_NOT_IMPORTED`;
- `keyOriginMetadataCryptographicallyBoundToAttestation=false`;
- `signingOperationObserved=false`;
- `liveGoogleCloudKmsVerified=false`;
- `resourceExistenceVerified=false`;
- `keyCreatedInsideHsmVerified=false`;
- `keyNonExtractableVerified=false`;
- `custodyEstablished=false`;
- IAM/provisioning/runtime fields remain false.

Production root provenance remains `BLOCKED / NOT VERIFIED`. The existing manual
preflight intentionally does not request or call D4c-c and continues to report
`attestationCryptographicallyVerified=false`.

## TDD and verification evidence

Observed RED→GREEN regressions:

1. shared resource validator module missing;
2. D4c-c bridge export missing;
3. certificate-array Proxy changed cardinality between validation and copy;
4. legacy D1 read the new D4c-c getter even when D3 was absent;
5. single-call export missing;
6. nested root object could mutate across the SDK `await`;
7. invalid caller time reached an RPC instead of failing locally.

Exact-current focused gate:

```text
node --import tsx --test \
  test/google-cloud-kms-resource-name.test.ts \
  test/google-cloud-kms-signing-backend.test.ts \
  test/google-cloud-kms-live-preflight.test.ts \
  test/google-cloud-kms-hsm-attestation-verifier.test.ts \
  test/cavium-v2-attestation-statement-parser.test.ts \
  test/google-cloud-kms-hsm-attestation-binding-verifier.test.ts \
  test/capability-manifest.test.ts
87/87 PASS
npm run typecheck
PASS
git diff --check
PASS
```

Exact-current full ordered gate:

```text
npm test && npm run typecheck && npm run build && git diff --check
531 total / 527 pass / 0 fail / 4 skip
TypeScript typecheck, TypeScript/Java build and diff-check PASS
```

Two independent implementation/claim reviews and final D4c-c code/test + claim
correction review `deleg_659db8d0`: `PASS`, `0` blocker / `0` high / `0` medium /
`0` low.
The correction review confirms the exact request/call boundary, sole direct
signing-backend importer and manual report's cryptographic-verification `false`.

## Remaining work

- authoritative production Google/Marvell roots, exact fingerprints, cardinality
  and rotation policy;
- trusted time, revocation and full path-policy validation;
- explicit safe configuration for roots before any manual CLI composition;
- real authorized KMS operation and IAM/provisioning/custody evidence;
- report/runtime/Paper integration only behind a separate approved release gate.

## Sources

[1] https://cloud.google.com/kms/docs/attest-key
[2] https://raw.githubusercontent.com/googleapis/googleapis/master/google/cloud/kms/v1/resources.proto
[3] https://cloud.google.com/resource-manager/reference/rest/v3/projects/getIamPolicy
