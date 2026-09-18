import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { RouteOracle, type RouteCheckpoint } from '../src/route-oracle.js'
import { loadScenario } from '../src/scenario.js'

const SCENARIO = 'livingnpc-zigzag-heading-observer'

async function oracleFor(withGates = true): Promise<{ oracle: RouteOracle; checkpoints: readonly RouteCheckpoint[] }> {
  const scenario = await loadScenario(path.resolve('scenarios'), SCENARIO)
  const step = scenario.steps[1]
  if (step.action !== 'observe_route') throw new Error('Expected observe_route step')
  const gates = withGates
    ? step.gates.map(gate => ({
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
    }))
    : []
  return { oracle: new RouteOracle(step.checkpoints, gates, 1.75), checkpoints: step.checkpoints }
}

/** Nội suy bước 0.25 block giữa hai mốc, giữ liên tục để oracle không báo discontinuity. */
function walk(from: { x: number; z: number }, to: { x: number; z: number }): { x: number; z: number }[] {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) * 4))
  const points: { x: number; z: number }[] = []
  for (let index = 1; index <= steps; index++) {
    const ratio = index / steps
    points.push({ x: from.x + (to.x - from.x) * ratio, z: from.z + (to.z - from.z) * ratio })
  }
  return points
}

function traverse(
  oracle: RouteOracle,
  route: readonly RouteCheckpoint[],
  start: RouteCheckpoint
): { result: ReturnType<RouteOracle['observe']>; gateCrossedOnce: boolean } {
  let at = 0
  let cursor = { x: start.position.x, z: start.position.z }
  let result = oracle.observe({ x: cursor.x, y: 64, z: cursor.z }, at)
  let gateCrossedOnce = false
  for (const checkpoint of route) {
    const next = { x: checkpoint.position.x, z: checkpoint.position.z }
    for (const point of walk(cursor, next)) {
      at += 100
      // Cổng vật lý duy nhất nằm giữa P0 và C; mở trong khoảng đó.
      const openGates = point.x >= 6.5 && point.x <= 10.5 ? ['B'] : []
      result = oracle.observe({ x: point.x, y: 64, z: point.z }, at, openGates)
      if (result.gateCrossings.B?.crossed) gateCrossedOnce = true
    }
    cursor = next
  }
  return { result, gateCrossedOnce }
}

test('Zig-zag scenario: đi đúng thứ tự mọi góc đảo chiều thì PASS', async () => {
  const { oracle, checkpoints } = await oracleFor()
  const { result, gateCrossedOnce } = traverse(oracle, checkpoints.slice(1), checkpoints[0])

  assert.equal(result.discontinuityDetected, false)
  assert.equal(result.shortcutDetected, false)
  assert.equal(result.backtrackDetected, false)
  assert.equal(result.gateOrderViolation, false)
  assert.equal(result.visited.length, checkpoints.length)
  assert.equal(gateCrossedOnce, true, 'Phải quan sát được crossing A→B→C thật')
  assert.equal(result.passed, true)
})

test('Zig-zag scenario: bỏ một nhánh đảo chiều bị bắt là shortcut, không PASS', async () => {
  const { oracle, checkpoints } = await oracleFor(false)
  // Đi tới mốc zig đầu tiên rồi nhảy thẳng sang mốc zig thứ ba, bỏ hẳn một nhánh.
  const zigs = checkpoints.filter(checkpoint => checkpoint.id.startsWith('ZIG'))
  assert.ok(zigs.length >= 3, 'Scenario phải có >=3 mốc đảo chiều')
  const upTo = checkpoints.findIndex(checkpoint => checkpoint.id === zigs[0].id)
  const skipTo = checkpoints.findIndex(checkpoint => checkpoint.id === zigs[2].id)

  const route = [...checkpoints.slice(1, upTo + 1), checkpoints[skipTo]]
  const { result } = traverse(oracle, route, checkpoints[0])

  assert.equal(result.shortcutDetected, true)
  assert.equal(result.passed, false)
})

test('Zig-zag scenario: đi đủ mốc nhưng sai chiều trong một nhánh bị bắt backtrack', async () => {
  const { oracle, checkpoints } = await oracleFor(false)
  const zigs = checkpoints.filter(checkpoint => checkpoint.id.startsWith('ZIG'))
  const secondIndex = checkpoints.findIndex(checkpoint => checkpoint.id === zigs[1].id)
  const firstZig = checkpoints[secondIndex - 1]
  // Tới mốc zig thứ hai rồi quay ngược về mốc đã thăm: đúng hành lang nhưng sai hướng.
  const route = [...checkpoints.slice(1, secondIndex + 1), firstZig]
  const { result } = traverse(oracle, route, checkpoints[0])

  assert.equal(result.backtrackDetected, true)
  assert.equal(result.passed, false)
})

void assert
