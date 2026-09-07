# P0.3 — Quyết định adapter Paper Ed25519 localhost

Ngày: 2026-08-31
Trạng thái: `PROPOSED / IMPLEMENTATION_AUTHORIZED_BY_USER`
Phạm vi: adapter Paper nội bộ để quan sát số người chơi Bukkit qua localhost có xác thực.

## Quyết định

Người dùng đã chọn phương án 1:

- Adapter Paper giữ private Ed25519 key trong Java KeyStore ngoài repository.
- Node verifier chỉ giữ public key DER SPKI và SHA-256 `keyId` đã pin trong trust-store snapshot.
- Node không nhận private key, key path, key bytes, password, shared secret hay credential environment variable.
- Không tạo key, KeyStore hoặc file cấu hình chứa bí mật trong repository.

## Contract mới, tách profile JVM cũ

`jvm-observation-bound-v2` không được mở rộng để mang số người chơi. Profile đó chỉ ký canonical JVM artifact observation và verifier của nó reassess candidate CodeSource-file. Thêm `onlinePlayers` vào profile hiện hữu sẽ thay đổi ngữ nghĩa và bỏ sót validation Node/Java tương ứng.

Adapter phải dùng profile payload riêng, versioned và canonical, tạm gọi
`paper-bukkit-online-player-v1`. Payload được ký phải bao gồm tối thiểu:

- `schemaVersion: 1`, domain và profile cố định;
- challenge identity: `challengeId`, 32-byte `nonceBase64Url`, `sequence`, `runId`, audience và verifier instance;
- key/trust binding: `keyId`, trust-store ID/version/SHA-256;
- provider + target binding: provider kind/id/version/instance, `bindingId`, `targetBindingSha256`;
- bounded `observedAtMs`, `claimedServerInstanceId`, `claimedBootId`;
- `onlinePlayers` là safe integer `0..10_000`;
- explicit observation posture: snapshot không atomic và không release-eligible.

Signature là exact 64-byte Ed25519 signature của canonical UTF-8 payload. Node phải strict-parse payload, require canonical bytes, verify SPKI-derived key ID, re-authorize provider/binding/trust/key-window, rồi dùng verifier-owned one-time challenge store để consume nonce. Sai/missing/extra/changing field, bad signature, key mismatch, stale/expired/replayed nonce, hoặc error transport phải fail closed bằng lỗi đã sanitize.

## Luồng và thread boundary

1. Node verifier tạo short-lived challenge từ trust-store snapshot và chuyển qua transport loopback **không xác thực** (xem "Key custody và bootstrap": localhost loại bỏ phơi nhiễm từ xa nhưng KHÔNG phải xác thực). Node là nonce authority duy nhất; tính toàn vẹn của claim dựa vào public-key pin, chữ ký và challenge, không dựa vào transport.
2. Adapter chỉ bind `127.0.0.1`; không bind wildcard hay caller-supplied host. Localhost không thay thế xác thực.
3. Adapter nhận request bounded, strict/canonical, đối chiếu exact key/provider/trust/binding policy đã cấu hình và chỉ xử lý challenge chưa hết hạn.
4. Node/codec định danh challenge bằng `challengeId = SHA-256(canonical identity)`, trong đó identity đã chứa `nonceBase64Url` và `keyId`. Adapter giữ ledger bounded theo `challengeId` và lưu thêm SHA-256 của toàn request frame: duplicate byte-identical chỉ trả lại exact cached signed response; cùng ID nhưng khác frame bị reject fail-closed như defense-in-depth, còn identity/challengeId không canonical bị codec reject trước ledger. Quá hạn, quá capacity hoặc rate-limit cũng bị reject. Adapter không tự consume nonce và không re-snapshot/re-sign một challenge sau response đầu tiên.
5. Adapter snapshot `Bukkit.getOnlinePlayers().size()` trên Paper primary thread; không giữ `Player`, world hoặc collection Bukkit qua thread boundary. Parse transport, canonicalize, KeyStore/signing và response I/O ở worker; primary thread không chờ socket, KeyStore, signer hay queue drain.
6. Adapter re-check deadline trước scheduling, sau scalar snapshot và ngay trước signing. Disable phải reject work mới, cancel/suppress work chưa snapshot và close listener; không để queued task tạo response sau disable.
7. Adapter canonicalize payload immutable, sign qua alias private key được lấy từ KeyStore ngoài repo, trả payload + signature.
8. Node verifier strict-parse/canonical-check, verify signature, re-authorize all challenge/trust/binding fields và atomically consume nonce; only verified result may later become an authoritative player fact. Chưa có preflight composition trong slice contract này.

Adapter sinh `claimedBootId` ngẫu nhiên khi `onEnable`, chỉ giữ trong memory và bind vào registration/session cùng mọi signed response. Node phải pin one current adapter boot/session identity and invalidate it on disconnect/disable. Đây chỉ bind adapter lifecycle session, chưa chứng minh boot/process identity độc lập.

`onlinePlayers == 0` chỉ có thể là evidence adapter-signed after verifier acceptance. Nó vẫn chưa chứng minh process identity, approval, clean restart/crash, artifact load, release eligibility hoặc production behavior.

## Key custody và bootstrap

- KeyStore format/path/password và provisioning procedure là operator-managed external configuration, không được đặt trong source, docs public, test fixture, argv, logs hay environment variable của Node.
- User chốt password source cho companion: một biến môi trường chỉ được cấp cho
  JVM Paper. Node, fixture subprocess và CLI argument/stdin không được nhận hoặc kế thừa
  biến này. YAML chỉ được chứa metadata không bí mật như KeyStore type/path, alias và tên
  biến môi trường; mọi lỗi lookup/load/sign phải sanitize, không log giá trị, path hoặc
  alias. Đây là contract vận hành; repository không tạo hoặc lưu credential.
- Java side receives only an operator-owned KeyStore access abstraction; source must not log alias/path/password/exception details.
- Node pin uses canonical Ed25519 DER SPKI base64 and SHA-256 DER `keyId`, matching existing `SignedProviderClaimTrustStore` checks. Public key rotation must add an overlapping, time-bounded key in a new trust-store snapshot; remove old key only after no active challenge window remains.
- Localhost removes remote exposure but is not authentication. Signature, challenge correlation and nonce consumption are mandatory.

### Bootstrap đã chọn: companion Bukkit service

- User chọn companion Paper/Bukkit plugin đăng ký
  `PaperBukkitOnlinePlayerExternalKeyStoreAccess` qua `ServicesManager`.
- Adapter artifact sở hữu service interface và registration/resolver helper. Companion
  phải compile-only phụ thuộc adapter API và khai báo hard dependency
  `depend: [BotCheckerPaperAdapter]` để dùng cùng exact service `Class`; không shade,
  relocate hoặc đóng gói bản sao interface.
- Companion chỉ được đăng ký đúng một helper-issued leased provider ở
  `ServicePriority.Normal`. Resolver không dùng highest-wins `load()` và chỉ nhận đúng
  một helper-issued provider gắn với exact companion `Plugin` instance. Raw provider,
  duplicate, lookup failure hoặc synchronous event injection đều fail closed.
- Lease copy input/output bytes, sanitize callback errors, vô hiệu hóa stale reference
  trước unregister và cho phép retry unregister nếu cleanup tạm thời lỗi. Kết quả ký trả
  muộn sau close bị suppress dù external signer có thể đã tạo audit/quota side effect.
- Companion phải đóng registration trước khi teardown custody provider. Registration
  close chia sẻ một unregister attempt giữa concurrent callers, giữ outcome chung khi
  waiter bị interrupt, cho phép attempt sau retry nếu attempt trước lỗi, và không tự chờ
  chính nó khi `ServiceUnregisterEvent` gọi reentrant trên owner thread.
- Adapter activation sau này phải theo service register/unregister lifecycle vì hard
  dependency khiến adapter load trước companion; không được giả định service đã có trong
  adapter `onEnable`. Library event bridge đăng ký listener trước initial reconcile, chỉ
  wake coordinator cho exact service class + exact companion, dừng event admission trước
  teardown, và giữ listener/coordinator cleanup retryable nếu unregister hoặc worker join
  tạm thời lỗi. Library coordinator hiện có thể coalesce event lên worker, giới hạn
  bốn self-reconcile pass, close runtime cũ/candidate fail-closed, interrupt và join worker
  trong ngân sách 250 ms. Factory phải cooperative với interrupt; runtime `close()` chạy
  đồng bộ ngoài state lock và phải tự bounded. `CLOSE_TIMEOUT` hoặc `CLOSE_REENTRANT` là
  failure rõ ràng, không được diễn giải là đã quiescent.
- `ServicesManager`, plugin name và `Plugin` object identity không phải authentication
  boundary. Một plugin độc hại trong cùng JVM có thể đăng ký service bằng reference plugin
  khác, gây denial-of-service hoặc can thiệp rộng hơn. Thiết kế chỉ bảo vệ fail-closed và
  không tự xóa registration không sở hữu; integrity của claim vẫn dựa vào public-key pin,
  signature và challenge. Runtime chỉ được vận hành trên server có tập plugin đồng cư trú
  được operator tin cậy. Nếu cần chống plugin đồng cư trú độc hại, phương án
  `ServicesManager` không đủ và phải thay kiến trúc/process boundary.
- Slice hiện tại triển khai/test service registration/resolution/coordinator, event bridge,
  fixed-policy runtime factory và composition owner ở tầng library/offline. Composition
  đăng ký event bridge trước initial reconcile, đóng coordinator/runtime ngay cả khi
  listener cleanup cần retry và giữ interrupt semantics của worker. Factory chỉ nhận
  opaque lease, fixed non-ephemeral port, bounded timeouts, immutable policy/clocks rồi
  compose snapshot, signer, processor và loopback lifecycle; nó không nhận hoặc đọc
  credential. Các thành phần này chưa được nối vào plugin main. Chưa có
  companion JAR concrete, KeyStore loader, secret source, adapter plugin activation hoặc
  Paper runtime evidence.

## Packaging / evidence boundaries

- Existing `java-src` remains transport-neutral auxiliary Java and must not import Bukkit/Paper, `KeyStore`, `Signature` or socket APIs.
- Paper adapter must be a distinct plugin module/artifact with its own build and `plugin.yml`, and use compile-only Paper API. It must not be silently mixed into `scripts/build-java.mjs`.
- Paper API dependency/version and plugin packaging are not yet `VERIFIED`; they require exact target coordinates and a dependency-resolution test before plugin implementation.
- Unit/integration fixtures may verify canonicalization, Ed25519 verification, replay rejection and loopback guards. They do not verify Paper lifecycle.
- Controlled Paper runtime must later prove plugin loading, primary-thread snapshot, loopback binding/cleanup, a valid signed response, nonce replay rejection and clean disable/stop. Production deploy/restart remains out of scope and requires explicit approval.

## Explicit nonclaims

This decision neither creates a KeyStore nor authenticates key provisioning/custody. It does not establish trusted clock, actual boot/process identity, authorization provenance, Paper runtime correctness, restart/crash recovery, release readiness or production verification.
