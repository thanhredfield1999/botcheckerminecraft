# BotChecker Project Rules

## Session Startup

Before changing code:

1. Read `CURRENT_STATE.md`, `README.md`, and relevant scenario files.
2. Inspect current source, tests, and Git status or diff.
3. Preserve unrelated user changes.

Before cross-project integration, re-read each participating reference's
`CURRENT_STATE.md` and relevant current source and tests. Do not rely on earlier
conversation context or an older handoff. Keep references read-only unless the user
explicitly requests a cross-repository change.

## Baseline

- Runtime: Node.js `22+`.
- Language: TypeScript with ESM modules.
- Typecheck: `npm run typecheck`.
- Tests: `npm test`.
- Build: `npm run build`.
- Full verification order: typecheck, test, then build.

## Safety

- Connect only to an authorized Minecraft server with a dedicated test account.
- Keep the HTTP API private; scenarios can issue Minecraft commands.
- Preserve inspect-before-click GUI safety and reject clicks when the window changes.
- Never log, commit, or include authentication credentials in scenarios or reports.
- Do not edit, deploy, or restart LivingNPC from a BotChecker-only task.
- Cross-project integration must identify the exact plugin version, scenario, server
  version, dependency versions, and report path.

## Source Of Truth

1. Current source and tests for implemented behavior.
2. `CURRENT_STATE.md` for current verification and next work.
3. `README.md` for stable usage guidance.
4. `PROJECT_HISTORY.md` for historical context only.

External references provide expected behavior and patterns. They do not authorize
cross-repository changes.
