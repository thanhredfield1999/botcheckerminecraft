# Google Cloud KMS HSM attestation D4c-a — Cavium V2 statement parser

Date: 2026-08-29

## Verdict

`VERIFIED offline/library-only` for strict parsing of a caller-supplied Cavium
V2 statement and matching a generated-Ed25519 PKCS #11 attribute policy.

This checkpoint does **not** compose the parser with D4b signature verification.
Therefore it does not establish that standalone parser input was HSM-signed and
keeps cryptographic origin, resource/public-key binding, custody, live KMS and
production operation `NOT VERIFIED`.

## Source contract

Google documents `CAVIUM_V2_COMPRESSED`, directs users to Marvell's V2 parser,
and identifies key type `0x0100`, key ID `0x0102`, extractability `0x0162` and
local generation `0x0163` as relevant attestation fields.[1]

Marvell documents the big-endian V2 response/info/object/TLV structures, the
256-byte RSA signature boundary and the public/private key-pair layout.[2] Its
MIT-licensed `parse_v2.py` is the executable upstream format reference used for
the grammar implemented here.[3]

PKCS #11 v3.1 defines `CKO_PUBLIC_KEY=0x02`, `CKO_PRIVATE_KEY=0x03`,
`CKK_EC_EDWARDS=0x40` and the attribute identifiers used by the policy.[4]

## Implemented boundary

- bounded non-shared `Uint8Array` input;
- exact total size, attribute buffer size, object offsets and object sizes;
- exact two-object asymmetric key-pair layout for this Ed25519 slice;
- at most 64 attributes per object;
- reject unknown, duplicate, truncated and trailing TLV data;
- strict boolean encoding (`00` or `01`);
- immutable parsed output;
- generated-Ed25519 policy matches public/private class, token/private flags,
  `CKK_EC_EDWARDS`, Ed25519 OID, public verify/private sign, local, sensitive,
  non-extractable/history flags, canonical Ed25519 public-point shape and an
  exact lowercase-ASCII 128-character hex key ID;
- result explicitly reports signature/origin/non-extractability/resource/
  public-key/custody verification as false where composition is absent;
- capability manifest marks the parser `library-only`; no runtime/network/live
  importer exists.

## Tests

TDD RED was observed before implementation because the parser module did not
exist. Further RED evidence covered non-canonical response-prefix length,
high-bit CKA_ID aliasing, missing/malformed Ed25519 public point and
standalone-origin overclaim correction.

Focused gate before final full verification:

```text
node --import tsx --test test/cavium-v2-attestation-statement-parser.test.ts test/capability-manifest.test.ts
24/24 PASS
npm run typecheck
PASS
```

Exact-final full ordered gate:

```text
npm run typecheck && npm test && npm run build && git diff --check
509 total / 505 pass / 0 fail / 4 skip
TypeScript typecheck, TypeScript/Java build and diff-check PASS
```

Independent correction review: `PASS`, `0` high / `0` medium / `0` low. It
confirmed the high-bit CKA_ID alias, missing/malformed public point and
non-canonical GenerateKeyPair response-prefix findings are closed.

## Remaining work

D4c-b now composes D4b's signature-verified statement bytes with this parser and
binds the second SHA-256 half of `CKA_ID` to exact caller-supplied
CryptoKeyVersion path bytes plus raw Ed25519 `CKA_EC_POINT` to caller-pinned
SPKI. During that work, PKCS #11
v3.1 showed the committed D4c-a DER-like `04 20` public-point wrapper was wrong
for `CKK_EC_EDWARDS`; a later RED→GREEN correction now requires exact raw RFC
8032 bytes. The prior wrapper-specific review finding is superseded. See
`docs/GOOGLE_CLOUD_KMS_HSM_ATTESTATION_D4C_B_2026-08-29.md`. Production roots
remain separately blocked.

## Sources

[1] https://cloud.google.com/kms/docs/attest-key
[2] https://www.marvell.com/products/security-solutions/nitrox-hs-adapters/software-key-attestation.html
[3] https://www.marvell.com/content/dam/marvell/en/public-collateral/security-solutions/parse_v2.py
[4] https://docs.oasis-open.org/pkcs11/pkcs11-spec/v3.1/os/include/pkcs11-v3.1/pkcs11t.h
