# VillageDefenseComeback integration

## Scenario

`scenarios/villagedefense-skin-journey.json` defines BotChecker's player-visible contract for the VillageDefense skin GUI:

- `/vd skin` opens category GUI.
- Categories include Kiếm, Rìu, Cung, Nón, Áo giáp, Quần, Giày.
- Kiếm category exposes Fire, Ice, Lightning and Tắt skin.
- Applying Fire emits expected confirmation.
- GUI remains inspectable after apply.
- Tắt skin emits expected confirmation.

## Run

Start a controlled Paper test server first. Server must have VillageDefense and the configured Oraxen items/resource pack. Do not point this scenario at production.

Set connection variables outside `.env` or in a local ignored `.env`:

```text
MC_HOST=127.0.0.1
MC_PORT=11619
MC_USERNAME=HeoMC_BotChecker
MC_AUTH=offline
```

Start BotChecker:

```text
npm install
npm run dev
```

Trigger run:

```http
POST http://127.0.0.1:8080/api/runs
Content-Type: application/json

{"scenario":"villagedefense-skin-journey"}
```

Inspect report:

```http
GET http://127.0.0.1:8080/api/runs/{runId}/report
```

## Evidence boundary

`npm test` validates scenario schema and runner contract only. It does not prove Paper, VillageDefense, Oraxen, resource-pack rendering, kit/restock, armor rendering, or reconnect behavior. Those require controlled server execution and a saved BotChecker report.

Never store credentials, Oraxen license files, private server logs, or player data in this repository.

## Current blocker

Runtime scenario cannot pass until a licensed Oraxen JAR and matching item YAML/resource-pack assets exist on the controlled test server.
