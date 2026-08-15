# BotChecker Project History

- Project path: `E:\AI.WORK\botcheckerminecraft-botchecker`
- Product: Mineflayer-based Minecraft journey and GUI tester.
- Runtime: Node.js 22 or newer, TypeScript.
- Separated on 2026-08-12 from `E:\AI.WORK\botcheckerminecraft` because that directory is reserved for active LivingNPC work.
- Do not add or move `living-npc-plugin` into this project.
- The old directory was intentionally left unchanged during separation.

## Current behavior

- Walk or teleport to configured coordinates.
- Approach, face and interact with a named NPC.
- Capture every GUI as readable text and structured JSON.
- Before every GUI click: inspect, log, pause, verify the same window and then click.
- Persist completed run reports under `reports/`.

## Next server calibration

Update `scenarios/npc-quest.json` with the real NPC name, coordinates and GUI item text, then run against an authorized test server/account.
