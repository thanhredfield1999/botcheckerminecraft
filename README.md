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
