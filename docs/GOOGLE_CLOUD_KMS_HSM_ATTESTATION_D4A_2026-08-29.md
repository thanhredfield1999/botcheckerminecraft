# Google Cloud KMS HSM Attestation — Checkpoint D4a

Ngày nghiên cứu: 2026-08-29

## Phạm vi

D4a là primitive `library-only` để xác minh envelope attestation
`CAVIUM_V2_COMPRESSED` tương đối với hai trust anchor do caller pin bằng SHA-256.
Nó không được nối vào live preflight, server, runner, report, Paper hoặc release
admission.

## Contract chính thức đã đối chiếu

Nguồn chính thức:

- Cloud KMS attestation guide:
  <https://cloud.google.com/kms/docs/attest-key>
- Google Cloud Python sample — chain và attestation signature verification:
  <https://github.com/GoogleCloudPlatform/python-docs-samples/blob/main/kms/attestations/verify_attestation_chains.py>
- Google Cloud Python sample — attestation envelope verification:
  <https://github.com/GoogleCloudPlatform/python-docs-samples/blob/main/kms/attestations/verify_attestation.py>
- Pinned `@google-cloud/kms@6.0.0` protobuf contract:
  `KeyOperationAttestation.AttestationFormat`, `CertificateChains`.

Các điểm dùng trong D4a:

- `CAVIUM_V2_COMPRESSED` là protobuf enum `4`.
- Envelope sau gunzip gồm statement và một RSA signature dài `256` byte.
- Signature dùng SHA-256 với RSA PKCS#1 v1.5.
- Manufacturer chain là root → card → partition.
- Owner root ký card và partition certificates có public keys phải khớp với
  manufacturer card/partition certificates.
- `caviumCerts` được xử lý như tập hai certificate; không tin thứ tự array.

## Claim D4a được phép

Sau khi hàm trả thành công, chỉ các claim sau được phép:

- hai SHA-256 fingerprint do caller cung cấp khớp exact DER của hai root;
- hai root là CA, khác nhau và certificate signature của mỗi root verify dưới
  public key chứa trong chính certificate đó;
- manufacturer/owner certificate signatures đã được kiểm;
- card và partition public keys được cross-certified giữa hai chain;
- mọi certificate nằm trong validity window tại thời điểm do caller cung cấp;
- một attestation signature trên exact statement đã được kiểm bằng partition
  public key cross-certified;
- gzip envelope và statement được bind bằng SHA-256.

## Claim bị cấm

D4a luôn giữ `false` cho:

- production Google/Marvell trust anchors verified;
- certificate revocation hoặc full RFC 5280 policy verified;
- intermediate CA `basicConstraints`, `pathLen` hoặc toàn bộ `keyUsage` policy;
- trusted/current time source;
- canonical gzip/envelope encoding; gzip SHA-256 is an exact caller-pinned byte
  identity, not a normalized attestation identifier;
- parsed attestation statement;
- attestation PKCS#11 attributes verified;
- key created inside HSM hoặc non-extractable verified;
- exact KMS resource/public key binding verified;
- custody established.

`64 KiB` compressed và `256 KiB` decompressed là local allocation-abuse caps,
không phải Cloud KMS service maxima.

## Blocker production

Google sample tải manufacturer root từ URL Marvell tại runtime và embed Google
owner root. Trong môi trường nghiên cứu, URL manufacturer chính thức trả HTTP
`403`; không có byte/fingerprint production root nào được pin từ mirror.
Vì vậy D4a chỉ nhận opaque caller-pinned roots và capability vẫn `library-only`.
Manual live preflight D3 không import D4a và tiếp tục báo
`attestationCryptographicallyVerified=false`.

Để mở D4b cần đồng thời:

1. Pin production manufacturer/owner roots cùng provenance và rotation policy.
2. Parse + verify exact PKCS#11 attributes cần thiết.
3. Bind attributes với exact KMS resource và Ed25519 public key.
4. Xác định trusted-time/revocation policy hoặc giữ các claim tương ứng false.
5. Thêm live controlled evidence; offline fixture không phải production proof.
6. Enforce distinct trust-root public keys, pin partition identity và xác nhận
   production `CertificateChains` cardinality/rotation contract.
7. Bổ sung card-key negative vector cùng compressed/decompressed/truncated
   envelope bounds regressions.

## Offline fixture

Fixture test chỉ chứa public certificates và signed gzip bytes. Private fixture
keys được tạo ngoài repo để sinh vector, sau đó đã xóa. Không có private key,
credential, token, exact KMS resource hoặc production root trong source tree.
