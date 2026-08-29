# Google Cloud KMS HSM attestation D4c-b — signed resource/SPKI binding

Date: 2026-08-29

## Verdict

`VERIFIED offline/library-only` for one fail-closed API that composes the D4b
caller-pinned certificate/signature verifier with the corrected D4c-a Cavium V2
parser, then binds selected signed attributes to exact caller-supplied
CryptoKeyVersion path bytes and a caller-pinned Ed25519 SPKI.

This is not production trust-root verification, trusted-time/revocation
verification, live KMS evidence, IAM/custody verification, deployment approval,
or proof that an arbitrary production key was created/non-extractable.

## Source contract

Google documents that `CKA_ID` (`0x0102`) is two concatenated lowercase
SHA-256 digests in hex form and only assigns the second digest the meaning
`SHA-256(exact CryptoKeyVersion resource name)`. D4c-b therefore checks only
that second half and does not invent a meaning for the first half.[1]

Google also documents `CKA_EXTRACTABLE` (`0x0162`) and `CKA_LOCAL` (`0x0163`)
as attributes used to inspect extractability and whether a key was locally
generated or imported.[1]

PKCS #11 v3.1 defines an Edwards public key's `CKA_EC_POINT` as the raw public
key bytes in little-endian RFC 8032 form, not a DER OCTET STRING wrapper.[3]
RFC 8410 defines Ed25519 SubjectPublicKeyInfo using OID `1.3.101.112`, with the
32-byte public key carried in the subjectPublicKey BIT STRING.[4]

Marvell remains the source for the Cavium V2 response/info/object/TLV and
signature-boundary grammar used by D4c-a/D4b.[2]

## D4c-a correction

The committed D4c-a matcher required `CKA_EC_POINT = 04 20 || 32 bytes`, based
on a review assumption copied from classic PKCS #11 EC-point handling. That is
wrong for `CKK_EC_EDWARDS` under PKCS #11 v3.1. A regression first demonstrated
that the old implementation rejected canonical raw 32-byte input and accepted
the wrapped form; the matcher now requires exactly 32 raw bytes. The earlier
review conclusion about the DER wrapper is superseded by this normative-source
correction.[3]

## Implemented boundary

- accepts one exact caller-supplied CryptoKeyVersion string under a bounded
  local path shape; the project segment is either a 6–30 character project
  ID or a nonzero signed-`int64` project number;
- accepts one single-block caller-supplied public-key PEM, resolves it to the
  exact canonical Ed25519 DER SPKI shape and checks its lowercase SHA-256
  fingerprint;
- copies a non-shared bounded gzip byte array before D4b verification;
- invokes D4b certificate-chain and statement-signature verification internally;
- independently decompresses the same copied bytes, recomputes the statement
  SHA-256 and requires equality with D4b's result;
- parses those exact statement bytes with D4c-a and matches the selected
  generated-Ed25519 policy;
- requires the second half of `CKA_ID` to equal SHA-256 of the exact UTF-8
  CryptoKeyVersion name;
- extracts the canonical raw 32-byte key from caller-pinned Ed25519 SPKI and
  requires exact equality with signed `CKA_EC_POINT`;
- returns immutable hash/resource evidence but no PEM, certificate or statement
  bytes;
- catches and sanitizes all boundary failures;
- remains `library-only`; after D4c-c its sole direct importer is the KMS signing
  backend, while the manual CLI does not call the bridge/compositor API and no
  server/report/Paper path calls it.

## Claim boundary

A success result means the selected parsed attributes, exact resource binding
and exact Ed25519 public-key binding are cryptographically bound to the
caller-pinned roots supplied to this invocation.

The result deliberately reports all of the following as `false`:

- `keyCreatedInsideHsmVerified`;
- `keyNonExtractableVerified`;
- production Google trust roots/origin/non-extractability;
- trusted time and certificate revocation;
- custody.

The narrower true fields say only that signed `CKA_LOCAL=1` and the selected
non-extractability-related attributes matched under caller-pinned trust anchors.
Production root provenance remains separately `BLOCKED / NOT VERIFIED`.

## Test evidence

TDD RED evidence:

1. D4c-b test failed because the compositor module did not exist.
2. D4c-a raw-point correction failed because the old matcher rejected raw
   `CKA_EC_POINT` and accepted a DER-like wrapper.
3. A numeric-project signed fixture failed because the initial D4c-b resource
   validator accepted only letter-prefixed project IDs.
4. A fully signed `projects/abcde-` fixture was accepted by an overbroad project
   ID regex; correction now enforces 6–30 characters, a letter prefix and an
   alphanumeric suffix.
5. A fully signed `projects/123` fixture was rejected by an invented six-digit
   minimum. Resource Manager documents `projects/123` and describes project
   numbers as `int64`; correction accepts nonzero values through signed-`int64`
   maximum and rejects a separately signed `9223372036854775808` fixture.[5]

Focused D4a/D4b/D4c/capability gate before full verification:

```text
node --import tsx --test \
  test/google-cloud-kms-hsm-attestation-binding-verifier.test.ts \
  test/cavium-v2-attestation-statement-parser.test.ts \
  test/google-cloud-kms-hsm-attestation-verifier.test.ts \
  test/capability-manifest.test.ts
42/42 PASS
npm run typecheck
PASS
git diff --check
PASS
```

The public-only fixture contains certificates, a public Ed25519 SPKI and signed
attestation bytes. Generation private keys existed only in a temporary local
process and are not stored in the repository.

Exact-current full ordered gate after the project-ID correction:

```text
npm run typecheck && npm test && npm run build && git diff --check
515 total / 511 pass / 0 fail / 4 skip
TypeScript typecheck, TypeScript/Java build and diff-check PASS
```

Initial implementation review: `FAIL`, one HIGH for overbroad project-ID
grammar. The signed invalid-resource regression above closes the observed
behavior. Final independent correction review on the exact current tree:
`PASS`, `0` blocker / `0` high / `0` medium / `0` low. It directly confirmed
the project-ID HIGH is `CLOSED`, the signed short-number/invalid-ID/int64-overflow
fixtures behave correctly, and the old FAIL is superseded.

This verification binds the exact caller-supplied resource string; it does not
query Cloud KMS or prove that the named resource exists.

## Remaining work

- authoritative production Marvell/Google trust-root set, fingerprints,
  cardinality and rotation policy;
- trusted time, revocation/full path-policy validation;
- live KMS retrieval and binding to independently observed API metadata;
- IAM least-privilege, custody, provisioning and operational evidence;
- runtime/report/Paper integration only after an explicit release gate.

## Sources

[1] https://cloud.google.com/kms/docs/attest-key
[2] https://www.marvell.com/products/security-solutions/nitrox-hs-adapters/software-key-attestation.html
[3] https://docs.oasis-open.org/pkcs11/pkcs11-spec/v3.1/os/pkcs11-spec-v3.1-os.html
[4] https://www.rfc-editor.org/rfc/rfc8410
[5] https://cloud.google.com/resource-manager/reference/rest/v3/projects/getIamPolicy
