import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { loadScenario } from '../src/scenario.js'

test('ItemGuard LITE consumer scenario parse và đúng thứ tự bước', async () => {
  const scenario = await loadScenario(path.resolve('scenarios'), 'itemguard-lite-gui')
  assert.equal(scenario.name, 'ItemGuard LITE GUI consumer journey')
  assert.ok(scenario.maxDurationMs > 0)
  const actions = scenario.steps.map(step => step.action)
  assert.deepEqual(actions, ['wait', 'chat', 'wait_for_gui', 'wait'])
  const guiStep = scenario.steps[2]
  assert.equal(guiStep.action, 'wait_for_gui')
  assert.ok('titleIncludes' in guiStep)
  assert.equal((guiStep as { titleIncludes: string }).titleIncludes, 'ItemGuard - Recorded item history')
})