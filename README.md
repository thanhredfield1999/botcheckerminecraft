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
single-process challenges. It can confirm that a fresh claim was signed by the
configured key and that its declared provider and artifacts exactly match an
expected artifact binding. Challenges are in memory, bounded, consumed once and
invalid after restart or in another process.

This capability is not wired into the HTTP server, reports, Paper, a JVM probe or
release admission. A successful result remains `artifact-bound` and
`releaseEligible: false`. Claimed server and boot identifiers are signed claim
contents, not independently verified runtime identities. Multiprocess use needs a
shared transactional nonce store and separate rate limiting.

### JVM artifact observation (library only)

The Java 21 library can make a bounded, non-authoritative observation of the
regular local file named by an anchor class `CodeSource` and of the class
resource bytes currently returned through that anchor. It records a redacted
URI fingerprint, file/resource hashes, explicit loader/MRJAR caveats and always
sets `authoritative`, `provesLoadedBytecode`, `atomicSnapshot`, and
`releaseEligible` to `false`.

This observer has no signing or private-key API and is not connected to Paper,
the HTTP server, reports, signed-provider claims, or release admission. It does
not prove which bytecode the JVM defined or executed, the truth of caller-
declared artifact roles, effective configuration, key custody, runtime behavior,
or release readiness. Capability manifest schema v2 binds its Java source,
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
