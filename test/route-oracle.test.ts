import assert from 'node:assert/strict'
import test from 'node:test'
import { RouteOracle, fenceBlockMatches, fenceBlocksDirectPath } from '../src/route-oracle.js'

const crossing = {
  entryClearance: 0.2,
  exitClearance: 0.2,
  verticalTolerance: 1,
  requiredExitSamples: 1,
  planeEpsilon: 0.1,
  corridorHalfWidth: 0.75,
  maxStepDistance: 1.5,
  exitDwellMs: 0
}

const checkpoints = [
  { id: 'A', position: { x: 0, y: 64, z: 0 }, radius: 0.6 },
  { id: 'B', position: { x: 4, y: 64, z: 0 }, radius: 0.6 },
  { id: 'C', position: { x: 4, y: 62, z: 4 }, radius: 0.6 }
]

test('route pass chỉ khi chạm A rồi B rồi C, gate B đã mở và crossing liên tục', () => {
  const oracle = new RouteOracle(checkpoints, [{
    checkpointId: 'B',
    block: { x: 4, y: 64, z: 0 },
    approach: { x: 3.5, y: 64, z: 0 },
    exit: { x: 4.5, y: 64, z: 0 },
    crossing
  }], 1.5)

  oracle.observe({ x: 0, y: 64, z: 0 }, 0)
  oracle.observe({ x: 1.0, y: 64, z: 0 }, 50)
  oracle.observe({ x: 2.0, y: 64, z: 0 }, 75)
  oracle.observe({ x: 3.0, y: 64, z: 0 }, 100)
  oracle.observe({ x: 3.5, y: 64, z: 0 }, 125, [])
  assert.equal(oracle.observe({ x: 3.6, y: 64, z: 0 }, 200, ['B']).passed, false)
  oracle.observe({ x: 4.4, y: 64, z: 0 }, 300, ['B'])
  oracle.observe({ x: 4.4, y: 64, z: 0.8 }, 400, ['B'])
  oracle.observe({ x: 4, y: 63, z: 1.6 }, 500, ['B'])
  oracle.observe({ x: 4, y: 62, z: 2.4 }, 600, ['B'])
  oracle.observe({ x: 4, y: 62, z: 3.2 }, 700, ['B'])
  const final = oracle.observe({ x: 4, y: 62, z: 4 }, 800, ['B'])
  assert.deepEqual(final.visited, ['A', 'B', 'C'])
  assert.equal(final.passed, true)
})

test('route reject shortcut A qua C, dù vị trí C hợp lệ', () => {
  const oracle = new RouteOracle(checkpoints, [], 1.5)
  oracle.observe({ x: 0, y: 64, z: 0 }, 0)
  const result = oracle.observe({ x: 4, y: 62, z: 4 }, 100)
  assert.equal(result.shortcutDetected, true)
  assert.equal(result.passed, false)
})

test('route đánh dấu backtrack khi quay lại checkpoint cũ', () => {
  const oracle = new RouteOracle([
    { id: 'A', position: { x: 0, y: 64, z: 0 }, radius: 0.5 },
    { id: 'B', position: { x: 3, y: 64, z: 0 }, radius: 0.5 },
    { id: 'C', position: { x: 3, y: 64, z: 4 }, radius: 0.5 }
  ], [], 5)
  oracle.observe({ x: 0, y: 64, z: 0 }, 0)
  oracle.observe({ x: 3, y: 64, z: 0 }, 100)
  oracle.observe({ x: 3, y: 64, z: 4 }, 200)
  const result = oracle.observe({ x: 3, y: 64, z: 0 }, 300)
  assert.equal(result.backtrackDetected, true)
  assert.equal(result.passed, false)
})

test('route reject gate B crossed trước checkpoint A', () => {
  const oracle = new RouteOracle([
    { id: 'A', position: { x: 0, y: 64, z: 0 }, radius: 0.6 },
    { id: 'B', position: { x: 4, y: 64, z: 0 }, radius: 0.6 },
    { id: 'C', position: { x: 4, y: 64, z: 4 }, radius: 0.6 }
  ], [{
    checkpointId: 'B',
    block: { x: 4, y: 64, z: 0 },
    approach: { x: 3.5, y: 64, z: 0 },
    exit: { x: 4.5, y: 64, z: 0 },
    crossing
  }], 1.5)
  oracle.observe({ x: 3.5, y: 64, z: 0 }, 0, ['B'])
  const result = oracle.observe({ x: 4.5, y: 64, z: 0 }, 100, ['B'])
  assert.equal(result.gateOrderViolation, true)
  assert.equal(result.passed, false)
})

test('route reject bước nhảy qua fence/waypoint', () => {
  const oracle = new RouteOracle(checkpoints, [], 1.5)
  oracle.observe({ x: 0, y: 64, z: 0 }, 0)
  const result = oracle.observe({ x: 4, y: 64, z: 0 }, 100)
  assert.equal(result.discontinuityDetected, true)
  assert.deepEqual(result.visited, ['A'])
  assert.equal(result.passed, false)
})

test('fence matcher không coi fence gate là fence obstacle', () => {
  assert.equal(fenceBlockMatches('minecraft:oak_fence'), true)
  assert.equal(fenceBlockMatches('oak_fence_gate'), false)
  assert.equal(fenceBlockMatches('minecraft:oak_fence', 'OAK_FENCE'), true)
})

test('fence geometry phải cắt direct A-C path', () => {
  assert.equal(fenceBlocksDirectPath(
    { x: 0, y: 64, z: 0 },
    { x: 4, y: 62, z: 4 },
    [{ x: 2, y: 63, z: 2 }]
  ), true)
  assert.equal(fenceBlocksDirectPath(
    { x: 0, y: 64, z: 0 },
    { x: 4, y: 62, z: 4 },
    [{ x: 0, y: 64, z: 4 }]
  ), false)
})
