# Bot Checker Minecraft

Minecraft Java tester that joins as a real protocol client, performs repeatable player journeys, records player-visible evidence and returns structured reports through HTTP.

This is the standalone BotChecker project. Active LivingNPC development is in
`E:\AI.WORK\living-npc-plugin` and must not be mixed into this directory.

## Capabilities

- Connect with offline or Microsoft authentication.
- Capture chat, titles, action bars, deaths and kicks.
- Walk or teleport to configured coordinates.
- Approach, face and interact with a named NPC at player range.
- Capture every open GUI as readable text and structured JSON.
- Enforce inspect-before-click: log, pause, verify the same GUI and only then click.
- Click by exact slot or matching item name/lore.
- Equip items, try vanilla fishing and plant seeds.
- Persist finished reports under `reports/<runId>.json`.

## Setup

```powershell
npm install
Copy-Item .env.example .env
```

Configure the Minecraft connection through environment variables or `.env`, then start:

```powershell
npm run dev
```

PowerShell does not load `.env` automatically. Use your environment manager or set variables in the process.

### Declared target artifact binding

`TARGET_BINDING_FILE` may point to a strict JSON manifest that declares the exact
Paper JAR, candidate plugin JAR, configuration baselines and optional probe JAR
intended for a run. The file is read once when the default server is created;
symlinks, malformed fields, duplicate identities and unsupported schema versions
are rejected.

This is offline artifact provenance only. Reports remain
`releaseEligible: false`; hashes and bundle seals do not prove that a JVM loaded
those files and are not signatures.

### Signed provider claims (library only)

The library includes a strict Ed25519 configured-key verifier for short-lived,
correlated claims. The default compatibility mode keeps bounded one-time
challenges in memory. Callers on Node.js `22.18.0+` can instead inject the
library-only SQLite challenge store to share sequence, expiry, capacity,
invalid-signature burn and per-key/provider rate limits across processes that
open the same local database. Two separate Node processes produce exactly one
consume winner. A separate child-process writer-lock test verifies the configured
busy-timeout smoke after the child reports holding the writer lock. Shared
trust-store/rate/capacity policy is
pinned, each loaded challenge is re-authorized against the consuming verifier,
and global scopes plus rate-limit subjects are bounded and retained for a bounded
period. A configured verifier instance whose idle scope has been reclaimed is
retired fail-closed; restart it with a new `verifierInstanceId` instead of
recreating the old sequence/policy namespace. If the bounded retired-scope budget
is exhausted, reclamation stops and new scopes fail closed rather than forgetting
a retired identity.

Callers can explicitly require the library-only
`jvm-observation-bound-v2` profile when issuing a challenge. The profile is part
of the challenge identity and shared SQLite state, so a provider cannot downgrade
that nonce to the legacy v1 envelope. The v2 signature covers the canonical claim
and a strict canonical JVM observation. Verification independently reassesses the
raw observation against the pending target binding and accepts only an exact
`candidate` CodeSource-file match. It remains non-authoritative: the signed
`observedAtMs` is self-asserted by the signer, observation freshness is explicitly
`not-established`, and loader/class-resource evidence retains its non-atomic and
informational limitations.

This capability is not wired into the HTTP server, reports, Paper, a JVM probe or
release admission. A successful result remains `artifact-bound` and
`releaseEligible: false`. Claimed server and boot identifiers are signed claim
contents, not independently verified runtime identities. The SQLite module is
still experimental in Node.js, uses synchronous local-file I/O, and is not a
distributed lock/consensus service or a supported network-filesystem/HA design.
The database file, its `-wal`/`-shm` siblings and their parent directory are a
security root: use a verifier-owned private directory. On POSIX the store requires
the parent and database to be owned by the current uid, rejects group/other-writable
parents and requires database mode `0600`; Windows still rejects symlinks and
non-regular database files. These guards do not provide cryptographic integrity
against an attacker who already has write access. Clock rollback/skew fails closed.
The store compares caller time against a trusted wall-clock callback under the
SQLite write lock (`Date.now` by default). A custom trusted clock is itself a
security root and must not be controlled by request/provider input. After an
unrecoverable clock jump, stop all workers and quarantine the entire local
database/WAL/SHM set before starting a fresh store, which invalidates old challenges.

### JVM artifact observation (library only)

The Java 21 library can make a bounded, non-authoritative observation of the
regular local file named by an anchor class `CodeSource` and of the class
resource bytes currently returned through that anchor. It records a redacted
URI fingerprint, file/resource hashes, explicit loader/MRJAR caveats and always
sets `authoritative`, `provesLoadedBytecode`, `atomicSnapshot`, and
`releaseEligible` to `false`.

A strict library-only Node assessment can parse canonical observation v1, bind
its caller-declared identity and CodeSource file hash to an exact target binding,
and retain hash/identity mismatches as structured counter-evidence. Java and Node
produce identical canonical UTF-8 bytes for the tested ASCII and supplementary-
Unicode vectors. `TARGET_FILE_MATCH_NON_AUTHORITATIVE` only describes the target
file; class-resource/base-entry consistency remains explicitly informational.

The observer and assessment still have no signing or private-key API. The optional
signed-provider v2 profile can bind their canonical observation bytes to a fresh
challenge, but no production probe/signer adapter exists and the profile is not
connected to Paper, the HTTP server, reports, or release admission. It does not
prove which bytecode the JVM defined or executed, the truth of caller-declared
artifact roles or observation time, effective configuration, key custody, runtime
behavior, or release readiness. Capability manifest schema v2 binds its Java source,
build script and compiled classes; legacy manifests without auxiliary code
remain schema v1.

## API

```http
GET /api/scenarios
POST /api/runs
GET /api/runs/{runId}
GET /api/runs/{runId}/report
POST /api/runs/{runId}/cancel
```

`POST /api/runs` is serialized through a single-account FIFO queue. One run may
be active and up to `RUN_QUEUE_CAPACITY` runs may wait; overflow returns HTTP
`429`. Cancelling a queued run records it as cancelled without creating a
Minecraft client. `GET /health` includes `active`, `pending`, and `capacity`
queue pressure.

Start a run:

```json
{"scenario":"npc-quest"}
```

The API listens on `127.0.0.1:8080` by default. Keep it private because scenarios can issue Minecraft commands.

## GUI Safety

Every event is printed with a `[BotChecker <runId>]` prefix and persisted in the report. A GUI is rendered as text before every click:

```text
+ GUI #2: Nhiem vu (minecraft:generic_9x3, 63 slots)
[11] 1x paper | Nhiem vu dau tien | Thuong: 100 xu / Bam de nhan
[15] 1x barrier | Dong menu
+ END GUI
```

`inspectDelayMs` defaults to 750 ms. The click is blocked if the GUI closes or changes to another window while BotChecker is reading it.

## NPC Journey

Edit `scenarios/npc-quest.json` with values observed on the target server:

- NPC `nameIncludes`.
- NPC coordinates `x`, `y`, `z`.
- GUI item `nameIncludes` or `loreIncludes`.
- Keep `travel: "walk"` for player-like navigation.
- Use `travel: "teleport"` only when the test account is authorized to run `/tp`.

## Verification

```powershell
npm run typecheck
npm test
npm run build
```
