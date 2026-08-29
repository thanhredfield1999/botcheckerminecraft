# Google Cloud KMS HSM trust-root provenance — D4b

Ngày quan sát: 2026-08-29 UTC

## Kết luận

`BLOCKED / NOT VERIFIED` cho production trust-root set. D4b không embed hay tự tải
trust root trong production code, không nối live preflight, và tiếp tục trả
`productionGoogleTrustAnchorsVerified=false`.

## Evidence chính thức

- Google Cloud mô tả attestation statement do HSM ký và certificate chains do
  Google cùng HSM manufacturer sở hữu; hướng dẫn chính thức trỏ tới sample xác
  minh chain và tài liệu/script của Marvell.[1]
- REST contract chỉ quy định ba repeated PEM certificate chains và nói certificate
  được ordered theo TLS chain convention. Nó không cam kết exact cardinality
  `2/1/1`, fingerprint set hay rotation policy.[2]
- Google sample tại commit
  `9b7c9acbb8f17500bbde1a9c2020496e5d39b8ed` tải manufacturer ZIP từ Marvell,
  pin expected manufacturer subject, embed owner root `Hawksbill Root v1 prod`,
  dựng manufacturer root→card→partition, rồi cross-check owner card/partition
  SPKI.[3]
- Owner-root URL được sample ghi lại vẫn trả một PEM certificate.[4]
- Marvell hiện công bố contract attestation hai chain, data + RSA signature,
  parser V1/V2 và public-key verification; trang không công bố một machine-readable
  rotation manifest hoặc fingerprint allowlist cho production roots.[5]

## Observation tái lập trên host nghiên cứu

Lệnh `curl -L` + `openssl x509` lúc `2026-08-29T10:54:11Z` cho kết quả:

| Artifact | Kết quả |
| --- | --- |
| Google owner URL | HTTP `200`, `1293` byte |
| Owner DER SHA-256 | `46b5fd351d56a0721ca0afcd1731c0f7b74e3941eb818bfd0ec36e29df0de095` |
| Owner SPKI SHA-256 | `11fa0c80423f28ee497a189bed4f7043629be7a7642d20eee9347a73c1ff46e8` |
| Owner subject/issuer | `C=US, ST=CA, L=Mountain View, O=Google Inc, CN=Hawksbill Root v1 prod` |
| Owner serial | `03` |
| Owner validity | `2017-07-01T00:00:00Z` đến `2030-01-01T00:00:00Z` |
| Pinned Google sample | HTTP `200`; SHA-256 `f9b1b393b6ee982545d3a4d943484242fae4381652bfe4765a769c014ad76dbb` |
| Owner URL so với sample | Exact DER match |
| Marvell ZIP trong sample | HTTP `403`, response `504` byte `Access Denied` |

`OBSERVED`: owner root có official Google-hosted provenance và exact byte identity
trùng sample đã pin. `OBSERVED`: manufacturer root bytes vẫn không lấy được từ
URL mà Google sample chỉ định. `INFERRED`: một root không đủ tạo production trust
set; mirror hoặc certificate từ provider khác không được tự động thay thế.

## Rotation/cardinality policy fail-closed

Production integration chỉ được mở khi có cả:

1. exact manufacturer và owner root bytes từ official, reviewable source;
2. DER SHA-256, SPKI SHA-256, subject/issuer/serial/validity cùng retrieval source;
3. versioned allowlist có thời điểm hiệu lực, overlap khi rotation và explicit
   retirement; unknown root phải fail closed;
4. source/update authenticity và rollback policy được review;
5. fixture production cho cardinality/order thực tế. REST chỉ nói repeated ordered
   chains, nên local exact `2/1/1` hiện là verifier profile hẹp, không phải service
   guarantee;
6. trusted-time/revocation policy riêng hoặc giữ các claim đó `false`.

D4d đã triển khai cơ học local cho schema-v1 caller-supplied allowlist: exact policy
ID/root-set ID/minimum revision, half-open active windows, explicit retirement,
rotation overlap bằng exact root-set pin, deterministic policy hash và fail-closed
input snapshot. Mỗi root PEM được strict-parse và phải khớp exact DER SHA-256 pin
trước RPC. D4d không xác thực nguồn/update, không verify policy signature, không lưu
durable rollback high-water và không cung cấp production root bytes; vì vậy các điều
kiện 1–4 và 6 ở trên vẫn chưa được đóng.

## Boundary giữ nguyên

- Không có production root PEM/fingerprint trong `src/`.
- Không network/filesystem/process trong verifier.
- Không import từ preflight/server/runner/report/Paper.
- Không key, IAM, credential, live KMS request, custody hay production operation.
- D4b hardening hiện chỉ là `VERIFIED offline/library-only` sau test phù hợp; tài
  liệu này tự nó không xác minh production roots.

## Sources

[1] https://docs.cloud.google.com/kms/docs/attest-key
[2] https://docs.cloud.google.com/kms/docs/reference/rest/v1/KeyOperationAttestation
[3] https://github.com/GoogleCloudPlatform/python-docs-samples/blob/9b7c9acbb8f17500bbde1a9c2020496e5d39b8ed/kms/attestations/verify_attestation_chains.py
[4] https://www.gstatic.com/cloudhsm/roots/global_1498867200.pem
[5] https://www.marvell.com/products/security-solutions/nitrox-hs-adapters/software-key-attestation.html
