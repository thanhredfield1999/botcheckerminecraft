import assert from 'node:assert/strict'
import test from 'node:test'
import { runPersistenceExecution } from '../src/persistence-runner.js'

test('persistence runner ghi before, gọi external restart, ghi after và PASS', async () => {
  const calls: string[] = []
  const result = await runPersistenceExecution({
    executionId: 'exec-1',
    before: async () => { calls.push('before'); return { key: 'npc.spawn', state: { enabled: true }, observedAt: '2026-01-01T00:00:00Z' } },
    restart: async () => { calls.push('restart'); return { authorized: true, observed: true, evidenceId: 'restart-1' } },
    after: async () => { calls.push('after'); return { key: 'npc.spawn', state: { enabled: true }, observedAt: '2026-01-01T00:01:00Z' } }
  })
  assert.deepEqual(calls, ['before', 'restart', 'after'])
  assert.equal(result.verdict, 'PASS')
  assert.equal(result.execution.executionId, 'exec-1')
})

test('persistence runner không gọi after khi restart provider fail và trả INCONCLUSIVE', async () => {
  let afterCalled = false
  const result = await runPersistenceExecution({
    executionId: 'exec-2',
    before: async () => ({ key: 'npc.spawn', state: { enabled: true }, observedAt: '2026-01-01T00:00:00Z' }),
    restart: async () => { throw new Error('external provider unavailable') },
    after: async () => { afterCalled = true; return { key: 'npc.spawn', state: { enabled: true }, observedAt: '2026-01-01T00:01:00Z' } }
  })
  assert.equal(afterCalled, false)
  assert.equal(result.verdict, 'INCONCLUSIVE')
  assert.match(result.message, /restart/i)
})

test('persistence runner fail-closed khi provider trả restart chưa authorized/observed', async () => {
  const result = await runPersistenceExecution({
    executionId: 'exec-3',
    before: async () => ({ key: 'npc.spawn', state: { enabled: true }, observedAt: '2026-01-01T00:00:00Z' }),
    restart: async () => ({ authorized: false, observed: true, evidenceId: 'restart-3' }),
    after: async () => ({ key: 'npc.spawn', state: { enabled: true }, observedAt: '2026-01-01T00:01:00Z' })
  })
  assert.equal(result.verdict, 'INCONCLUSIVE')
})

void assert
