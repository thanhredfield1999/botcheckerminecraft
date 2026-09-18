# Controlled Paper E2E harness

Status: preflight + run-plan + EXECUTOR đã tồn tại. Harness/preflight/plan chưa bao giờ starts
Paper, mở socket, tải JAR, tạo key, đọc password hay deploy artifact — các việc đó thuộc về
executor (`scripts/controlled-paper-journey.mjs`) và chỉ chạy sau approval + operator cấp
Paper JAR / PKCS12 ngoài repo. Lần chạy đầu tiên thành công: 2026-09-19
(`docs/evidence/controlled-paper-journey-20260919/README.md`).

## Purpose

It prepares the exact non-secret input boundary for a future approved isolated Paper
runtime journey covering:

1. Paper loads `BotCheckerPaperAdapter`.
2. Paper loads `BotCheckerKeyStoreCompanion` after the adapter.
3. The companion registers one opaque Ed25519 service.
4. The adapter binds its configured `127.0.0.1` port.
5. Node issues a challenge, receives one signed claim, verifies it and consumes its nonce.
6. A replay is rejected.
7. Clean Paper stop disables both plugins and leaves no adapter listener.

None of those runtime statements are proved by preflight.

## Inputs

The CLI takes exactly one JSON file:

    node --import tsx scripts/controlled-paper-preflight.mjs --config C:/isolated/harness.json

The JSON must contain only public adapter policy identifiers, an external Paper JAR path,
an external PKCS12 path, an explicit isolated root, a fixed port and the *name* of the JVM
password environment variable. It rejects secret-like fields such as `secret`, `token`,
`credential`, `apiKey` and private-key fields. Do not place a password or key bytes in this
JSON, in command arguments, or in this repository.

`isolatedRoot` must already exist as an empty, non-symlink directory outside the repository.
The external Paper JAR and PKCS12 must also be outside both the repository and that root.
The harness has no production allow-list: a root that resembles production is not a runtime
authorization.

## Preflight result

The preflight reports only these deterministic blocks:

- `PAPER_JAR_MISSING`: external Paper JAR is not a regular non-symlink file.
- `KEYSTORE_MISSING`: external PKCS12 file is not a regular non-symlink file.

A successful preflight still has `mutationAllowed:false` and `runtimeExecuted:false`. It is
not permission to launch Paper.

## Runtime boundary

Executor (`src/e2e/controlled-paper-executor.ts` + `scripts/controlled-paper-journey.mjs`) là đường
duy nhất starts Paper. Nó chỉ chạy khi: (1) preflight `ready`, (2) operator đã cấp Paper JAR +
PKCS12 ngoài repo, (3) password chỉ nằm trong env var đặt riêng cho JVM. Executor tự dừng Paper
(ghi `stop` vào stdin, chờ exit, kill fallback nhắm đúng PID của mình), xác minh port đã đóng,
phân loại stop-evidence từ log (`Disabling BotCheckerPaperAdapter` / `...KeyStoreCompanion`),
và ghi `journey-evidence.json` fail-closed (failure field nếu claim/ready thất bại). Không dùng
`/reload`, PlugMan, kill hàng loạt, server Minecraft đang chạy, hoặc KeyStore trong repo.
