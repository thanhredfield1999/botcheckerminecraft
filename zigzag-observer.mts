// Bot quan sát read-only cho hành lang zig-zag m13.
//
// Dùng lại đúng hai lớp đã có test của BotChecker: `pinUniqueEntity` (khóa một entity
// duy nhất theo UUID) và `RouteOracle` (chấm thứ tự checkpoint + crossing cổng).
// Bot KHÔNG chat, không command, không click, không đào/đặt, không tấn công, không
// teleport — chỉ đọc entity stream và ghi kết quả ra file.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { pinUniqueEntity } from './src/entity-observer.js'
import { RouteOracle } from './src/route-oracle.js'

const require = createRequire(import.meta.url)
const mineflayer = require('mineflayer')

const scenarioPath = process.env.ZIGZAG_SCENARIO
const outputPath = process.env.ZIGZAG_OUTPUT
if (!scenarioPath || !outputPath) throw new Error('ZIGZAG_SCENARIO và ZIGZAG_OUTPUT là bắt buộc')

const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'))
const step = scenario.steps.find((entry: any) => entry.action === 'observe_route')
if (!step) throw new Error('scenario thiếu observe_route')

const oracle = new RouteOracle(step.checkpoints, step.gates.map((gate: any) => ({
  checkpointId: gate.checkpointId,
  block: gate.block,
  approach: gate.approach,
  exit: gate.exit,
  crossing: {
    entryClearance: gate.entryClearance,
    exitClearance: gate.exitClearance,
    verticalTolerance: gate.verticalTolerance,
    requiredExitSamples: gate.requiredExitSamples,
    planeEpsilon: gate.planeEpsilon,
    corridorHalfWidth: gate.corridorHalfWidth,
    entityHalfWidth: gate.entityHalfWidth,
    maxStepDistance: gate.maxStepDistance,
    exitDwellMs: gate.exitDwellMs
  }
})), 1.75)

const bot = mineflayer.createBot({
  host: process.env.MC_HOST ?? '127.0.0.1',
  port: Number(process.env.MC_PORT ?? 25626),
  username: process.env.MC_USERNAME ?? 'LnpcZigzagBot',
  auth: 'offline',
  version: process.env.MC_VERSION || undefined
})

const samples: any[] = []
let gateCrossedOnce = false
let lastResult: any
let identity: any
let identityFallback = false
let failure: string | undefined
let finished = false
const startedAt = Date.now()
/** Chẩn đoán: mọi entity từng thấy (tên + uuid + vị trí đầu tiên). */
const seenEntities = new Map<string, any>()

function recordSeen(): void {
  if (!bot.entity) return
  for (const entity of Object.values(bot.entities) as any[]) {
    const key = String(entity.uuid ?? entity.id)
    if (seenEntities.has(key)) continue
    seenEntities.set(key, {
      id: entity.id,
      uuid: entity.uuid ?? null,
      type: entity.type ?? null,
      name: entity.name ?? null,
      username: entity.username ?? null,
      displayName: typeof entity.displayName === 'string' ? entity.displayName : null,
      position: entity.position
        ? { x: Number(entity.position.x.toFixed(2)), y: Number(entity.position.y.toFixed(2)), z: Number(entity.position.z.toFixed(2)) }
        : null,
      distance: entity.position && bot.entity.position
        ? Number(bot.entity.position.distanceTo(entity.position).toFixed(2))
        : null
    })
  }
}

function finish(reason: string): void {
  if (finished) return
  finished = true
  clearInterval(timer)
  recordSeen()
  const report = {
    reason,
    failure,
    scenario: scenario.name,
    targetUuid: step.targetUuid,
    identity,
    identityFallback,
    observerPosition: bot.entity?.position
      ? { x: Number(bot.entity.position.x.toFixed(2)), y: Number(bot.entity.position.y.toFixed(2)), z: Number(bot.entity.position.z.toFixed(2)) }
      : null,
    sampleCount: samples.length,
    gateCrossedOnce,
    visited: lastResult?.visited ?? [],
    expectedCheckpoints: step.checkpoints.map((c: any) => c.id),
    shortcutDetected: lastResult?.shortcutDetected ?? null,
    backtrackDetected: lastResult?.backtrackDetected ?? null,
    gateOrderViolation: lastResult?.gateOrderViolation ?? null,
    discontinuityDetected: lastResult?.discontinuityDetected ?? null,
    // Fallback identity chỉ để CHẨN ĐOÁN; không bao giờ được tính là PASS.
    passed: Boolean(lastResult?.passed) && !identityFallback,
    durationMs: Date.now() - startedAt,
    seenEntities: [...seenEntities.values()],
    samples: samples.slice(-4000)
  }
  fs.writeFileSync(outputPath!, JSON.stringify(report, null, 1))
  try { bot.quit('observation-complete') } catch { /* đóng im lặng */ }
  setTimeout(() => process.exit(report.passed ? 0 : 3), 1500)
}

bot.on('kicked', (reason: unknown) => { failure = 'KICKED:' + JSON.stringify(reason); finish('kicked') })
bot.on('error', (error: Error) => { failure = 'ERROR:' + error.message; finish('error') })
bot.on('end', () => finish('end'))

const timer = setInterval(() => {
  if (!bot.entity) return
  recordSeen()
  const entities = Object.values(bot.entities) as any[]
  let pinned
  try {
    pinned = pinUniqueEntity(entities, bot.entity.position,
      step.nameIncludes, step.maxDistance, true, step.targetUuid)
  } catch {
    // UUID Citizens (registry) có thể khác UUID entity mà client nhận. Thử pin theo
    // tên duy nhất để CHẨN ĐOÁN, và đánh dấu rõ — kết quả fallback không bao giờ PASS.
    try {
      pinned = pinUniqueEntity(entities, bot.entity.position,
        step.nameIncludes, step.maxDistance, false)
      identityFallback = true
    } catch {
      return
    }
  }
  identity ??= { ...pinned.identity, uuid: (pinned.entity as any).uuid ?? null }
  const position = pinned.entity.position
  const at = Date.now() - startedAt
  const result = oracle.observe({ x: position.x, y: position.y, z: position.z }, at)
  lastResult = result
  if (result.gateCrossings?.B?.crossed) gateCrossedOnce = true
  samples.push({ at, x: Number(position.x.toFixed(3)), y: Number(position.y.toFixed(3)),
    z: Number(position.z.toFixed(3)), visited: result.visited.length,
    next: result.nextCheckpoint })
  if (result.visited.length === step.checkpoints.length) finish('route-complete')
}, step.sampleMs ?? 100)

setTimeout(() => { failure ??= 'DEADLINE'; finish('deadline') }, step.timeoutMs ?? 290000)
