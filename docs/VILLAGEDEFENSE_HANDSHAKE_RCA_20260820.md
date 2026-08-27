# VillageDefense BotChecker handshake RCA

Date: 2026-08-20

## Symptom

Paper `1.21.11` kick BotChecker before scenario execution:

```text
Internal Exception: io.netty.handler.codec.DecoderException: Failed to decode packet 'serverbound/minecraft:hello'
```

## Evidence

- Target protocol: `1.21.11`, protocol `774`.
- BotChecker uses `mineflayer 4.37.1`, `minecraft-protocol 1.66.2`, `minecraft-data 3.113.1`.
- Local serializer emits valid login-start frame: packet ID `0x00`, username string, 16-byte UUID.
- Existing historical report proves one earlier run negotiated `1.21.11` / protocol `774`.
- Latest reproduction could not run after server shutdown: `ECONNREFUSED 127.0.0.1:11619`.
- No complete Paper decoder field/buffer was captured.

## Action

Added `test/minecraft-handshake.test.ts` to lock:

- Login-start schema for `1.21.11`.
- Protocol `774`.
- Packet ID `0x00` mapping to `login_start`.
- UUID 16-byte encoding.

No change made to `src/runner.ts`, protocol dependencies, VillageDefense, or production.

## Verification

```text
npm run typecheck: pass
npm test: 156 total, 154 pass, 0 fail, 2 skipped
npm run build: pass
```

## Status

Handshake runtime remains unresolved. Do not claim `/vd skin`, GUI, Oraxen, kit, restock, armor, or reconnect runtime pass until Paper is running and a complete decoder diagnostic is captured. Next probe must run with a live Paper `1.21.11` server and `PROTOCOL_DIAGNOSTICS=true`.
