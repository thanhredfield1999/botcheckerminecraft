import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { RouteOracle } from '../src/route-oracle.js'
import { loadScenario } from '../src/scenario.js'

test('Farmer fixture scenario parse và route oracle nhận trajectory liên tục qua owned gate', async () => {
  const scenario = await loadScenario(path.resolve('scenarios'), 'livingnpc-farmer-pathfinding-readonly')
  const step = scenario.steps[0]
  assert.equal(step.action, 'observe_route')
  if (step.action !== 'observe_route') return

  const oracle = new RouteOracle(step.checkpoints, step.gates.map(gate => ({
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
      maxStepDistance: gate.maxStepDistance,
      exitDwellMs: gate.exitDwellMs
    }
  })), 1.75)

  const samples = [
    [199.5, 200.5, 0], [200.5, 200.5, 100], [201.5, 200.0, 200],
    [202.5, 199.8, 300], [203.3738, 200.1227, 400], [203.8896, 200.7665, 500],
    [205.1, 200.5, 600], [205.55, 200.5, 700], [205.9, 200.5, 800],
    [206.1722, 200.3915, 900], [207.5, 200.5, 1000], [209.0, 200.5, 1100],
    [210.5, 200.5, 1200], [212.0, 201.0, 1300]
  ] as const
  let result
  for (const [x, z, at] of samples) {
    result = oracle.observe({ x, y: -60, z }, at, at >= 500 && at <= 900 ? ['B'] : [])
  }
  assert.equal(result?.passed, true)
  assert.deepEqual(result?.visited, ['P0', 'STAGING', 'A', 'B', 'C', 'FINAL'])
})

test('Farmer route oracle không nhận bước nhảy P0 tới FINAL là PASS', async () => {
  const scenario = await loadScenario(path.resolve('scenarios'), 'livingnpc-farmer-pathfinding-readonly')
  const step = scenario.steps[0]
  if (step.action !== 'observe_route') throw new Error('Expected observe_route')
  const oracle = new RouteOracle(step.checkpoints, [], 1.75)
  oracle.observe(step.checkpoints[0].position, 0)
  const result = oracle.observe(step.checkpoints.at(-1)!.position, 100)
  assert.equal(result.passed, false)
  assert.equal(result.discontinuityDetected, true)
  assert.equal(result.shortcutDetected, true)
})

void assert
