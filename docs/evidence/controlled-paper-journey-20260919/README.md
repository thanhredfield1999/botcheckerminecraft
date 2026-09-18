# Controlled Paper journey — 2026-09-19 (VERIFIED Paper runtime)

Status: first real Paper runtime evidence for the adapter + keystore companion. This is
`VERIFIED controlled Paper runtime`, NOT release eligibility and NOT production evidence.

## What ran

- Paper `1.21.11` (paperclip build; jar SHA-256 `6c099540...`), Java 21 (Adoptium `jdk-21`),
  isolated root `E:/AI.WORK/botchecker-runtime/controlled-paper-journey-20260919b`,
  adapter loopback port `25680`, Minecraft port `25681`, offline mode, flat world.
- Plugins: `BotCheckerPaperAdapter-0.2.0-SNAPSHOT.jar` + `BotCheckerKeyStoreCompanion-0.2.0-SNAPSHOT.jar`,
  configured via non-secret `config.yml` written by the executor. PKCS12 keystore operator-provisioned
  OUTSIDE the repo (`botchecker-runtime/artifacts/controlled-test-*.p12`); password passed ONLY via
  an environment variable to the Paper JVM. No secret ever enters the repo, argv, or evidence.

## Observed lifecycle (OBSERVED in latest.log)

1. `[BotCheckerPaperAdapter] Enabling BotCheckerPaperAdapter v0.2.0-SNAPSHOT`
2. `BotChecker Paper adapter armed; awaiting companion key service registration.`
3. `[BotCheckerKeyStoreCompanion] Enabling BotCheckerKeyStoreCompanion v0.2.0-SNAPSHOT`
4. `BotChecker KeyStore companion registered one opaque Ed25519 provider.`
5. `Done (22.5s)!` — server ready.

## Claim journey (VERIFIED, round-2/3/4 refactored path)

- Round-2 (empty): `onlinePlayers: 0`. Round-3 (one real client `BotCheckerProbe`):
  `onlinePlayers: 1`. Round-4 (three real clients `BotCheckerProbe1/2/3`, distinct entity
  IDs 1/5/17): `onlinePlayers: 3`. All: `verified: true`, `nonceConsumed: true`,
  `replayRejected: true`.
- Node issued an Ed25519 challenge over the loopback listener; the adapter returned a signed
  claim; `verifyAndConsume` accepted exactly once.
- Claim fields: `claimedServerInstanceId: controlled-paper-a`, per-boot
  `claimedBootId: boot-09b0cf...` (round-3, fresh each enable), `targetBindingSha256` matches
  the artifact binding.
- Stop: `exitCode 0`, both plugins reported disabled; ports no longer LISTENING; no orphan java.

## Artifacts bound (SHA-256)

- paper: `6c099540fccd27e10750d1adcb382f1552fb5aa2816aeaf2cc1efb23ddd9e3df`
- adapter JAR: `28a8a617d4c8b7387f24ea4b941927da3b65b5caa0033a0392195f3ac4032778`
- companion JAR: `90d926ad53d693b9ad5621ee17b3be7f4029adc12fc6fe811842c8e12dd4ee6f`
- binding SHA-256: `7b9c2eb76f7ccdcfd5208ac534561a3a3b0413436632e1055f96e1a6072d209b`

## Restart / crash journey (VERIFIED, round-5/6)

- Restart (round-5, `restart-evidence.json`): 2 boots trên CÙNG isolated root, cả hai clean
  stop. `bootIdsDistinct: true` — boot1 `boot-f8ef038e...`, boot2 `boot-a2814e45...`,
  `allBootsVerified: true`, `boot2CleanStop: true`. Restart không dùng lại bootId cũ.
- Crash (round-6, `crash-restart-evidence.json`): boot1 bị kill cứng (child.kill(), log không
  có `Disabling`, `exitSignal: SIGTERM`, bootId `boot-ca265158...`), rồi boot2 recovery sạch
  (exit 0, exitSignal null, bootId `boot-461f4908...` — KHÁC boot1). `bootIdsDistinct: true`,
  `allBootsVerified: true`, `boot1Crashed: true`, `boot2CleanStop: true`. Crash không để lại
  claim dùng được cho boot sau (bootId khác, nonce khác).
- Cả hai đều `replayRejected: true` mỗi boot.

## Limits (NOT asserted)

`releaseEligible: false`, `factsAuthoritative: false` by evidence. Rounds prove the
snapshot+binding+signing pipeline reports the exact real online-players count at 0, 1 and 3
clients (OBSERVED join/disconnect in log). Not covered: many (>4) simultaneous players,
restart/crash proof, drag/multiplayer/anti-dupe customer journeys, or production custody
(keystore is a throwaway test key).

## Reproduction

```bash
# 1) operator provisions a keystore (password via env only)
BOTCHECKER_TEST_KEYSTORE_PASSWORD=<random> npm run provision:controlled-paper-keystore
# 2) craft a non-secret journey config (see docs/controlled-paper-e2e-harness.md)
BOTCHECKER_TEST_KEYSTORE_PASSWORD=<same> npm run journey:controlled-paper -- --config <config.json>
```

Round-1 file (`journey-evidence-round1-initial.json`) used the direct verifier wiring before the
refactor; round-2 is the final sanctioned path (runtime composition). Both PASSED identically.