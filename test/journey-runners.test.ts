import assert from 'node:assert/strict'
import test from 'node:test'
import { runGuiInteraction } from '../src/gui-runner.js'
import { runGameplayJourney } from '../src/gameplay-runner.js'
import { runMultiClient } from '../src/multi-client-runner.js'

test('GUI runner gọi provider theo before-click-after', async () => {
  const calls: string[] = []
  const result = await runGuiInteraction({
    expectedTitle: 'Shop', expectedSlot: 1, expectedMaterial: 'minecraft:stone', expectedClick: 'left',
    before: async () => { calls.push('before'); return { title: 'Shop', slot: 1, material: 'minecraft:stone', displayName: 'Buy', count: 1 } },
    click: async () => { calls.push('click'); return { performed: true, button: 'left' } },
    after: async () => { calls.push('after'); return { title: 'Shop', slot: 1, material: 'minecraft:stone', displayName: 'Buy', count: 0 } }, evidence: {}
  })
  assert.deepEqual(calls, ['before', 'click', 'after'])
  assert.equal(result.verdict, 'PASS')
})

test('GUI runner provider lỗi là INCONCLUSIVE', async () => {
  const result = await runGuiInteraction({ expectedTitle: 'Shop', expectedSlot: 1, expectedMaterial: 'minecraft:stone', expectedClick: 'left', before: async () => { throw new Error('GUI unavailable') }, click: async () => ({ performed: true, button: 'left' }), after: async () => ({ title: 'Shop', slot: 1, material: 'minecraft:stone', displayName: 'Buy', count: 0 }), evidence: {} })
  assert.equal(result.verdict, 'INCONCLUSIVE')
})

test('gameplay runner lấy observation từ provider', async () => {
  const result = await runGameplayJourney({ journeyId: 'flow', expectedSteps: ['open', 'buy'], observe: async id => ({ id, status: 'passed', evidence: {} }) })
  assert.equal(result.verdict, 'PASS')
})

test('multi-client runner chạy tuần tự và aggregate', async () => {
  const order: string[] = []
  const result = await runMultiClient({ runId: 'run', clientIds: ['a', 'b'], observe: async id => { order.push(id); return { clientId: id, status: 'passed', evidence: {} } } })
  assert.deepEqual(order, ['a', 'b'])
  assert.equal(result.verdict, 'PASS')
})

test('multi-client runner giữ nested provider failure trong raw evaluation', async () => {
  const nested = new TypeError('socket closed while reading player state')
  const result = await runMultiClient({
    runId: 'run-provider-failure',
    clientIds: ['client-a', 'client-b'],
    observe: async id => {
      if (id === 'client-b') throw nested
      return { clientId: id, status: 'passed', evidence: { sequence: 1 } }
    }
  })

  assert.equal(result.verdict, 'INCONCLUSIVE')
  assert.equal(result.message, 'INCONCLUSIVE_OBSERVER: one or more client observations unavailable')
  assert.deepEqual(result.evidence.failures, [{
    clientId: 'client-b',
    failure: {
      code: 'INCONCLUSIVE_OBSERVER',
      phase: 'observe-client',
      provider: 'minecraft-client',
      causeClass: 'TypeError',
      boundedDetail: 'socket closed while reading player state',
      artifactRefs: [],
      retryable: true,
      trustBoundary: 'external-provider'
    }
  }])
})

test('runner provider lỗi không giả PASS', async () => {
  const result = await runGameplayJourney({ journeyId: 'flow', expectedSteps: ['open'], observe: async () => { throw new Error('provider offline') } })
  assert.equal(result.verdict, 'INCONCLUSIVE')
})

test('multi-client runner không để malformed observation xóa FAIL_PRODUCT của client khác', async () => {
  const circular: Record<string, unknown> = {}
  circular.self = circular
  const result = await runMultiClient({
    runId: 'run-mixed-failure', clientIds: ['failed-client', 'malformed-client'],
    observe: async id => id === 'failed-client'
      ? {
          clientId: id, status: 'failed', evidence: {},
          failure: {
            code: 'FAIL_PRODUCT', phase: 'observe-client', provider: 'client',
            causeClass: 'Error', boundedDetail: 'authoritative product failure', artifactRefs: [],
            retryable: false, trustBoundary: 'external-provider'
          }
        }
      : { clientId: id, status: 'passed', evidence: circular }
  })

  assert.equal(result.verdict, 'FAIL')
  assert.deepEqual(result.evidence.failures.map(entry => ({
    clientId: entry.clientId, code: entry.failure.code
  })), [
    { clientId: 'failed-client', code: 'FAIL_PRODUCT' },
    { clientId: 'malformed-client', code: 'INCONCLUSIVE_OBSERVER' }
  ])
})

test('multi-client runner giữ FAIL_PRODUCT cùng client khi evidence malformed', async () => {
  const circular: Record<string, unknown> = {}
  circular.self = circular
  const result = await runMultiClient({
    runId: 'run-same-client-failure', clientIds: ['failed-client'],
    observe: async id => ({
      clientId: id, status: 'failed', evidence: circular,
      failure: {
        code: 'FAIL_PRODUCT', phase: 'observe-client', provider: 'client',
        causeClass: 'Error', boundedDetail: 'authoritative product failure', artifactRefs: [],
        retryable: false, trustBoundary: 'external-provider'
      }
    })
  })

  assert.equal(result.verdict, 'FAIL')
  assert.deepEqual(result.evidence.failures.map(entry => ({
    clientId: entry.clientId, code: entry.failure.code
  })), [{ clientId: 'failed-client', code: 'FAIL_PRODUCT' }])
})

for (const evidence of [
  { chat: 'Your reset token was consumed twice' },
  { blob: 'x'.repeat(9_000) }
]) {
  test('multi-client runner giữ FAIL_PRODUCT khi evidence nhạy cảm hoặc vượt bound', async () => {
    const result = await runMultiClient({
      runId: 'run-bounded-product-failure', clientIds: ['failed-client'],
      observe: async id => ({
        clientId: id, status: 'failed', evidence,
        failure: {
          code: 'FAIL_PRODUCT', phase: 'observe-client', provider: 'client',
          causeClass: 'Error', boundedDetail: 'authoritative product failure', artifactRefs: [],
          retryable: false, trustBoundary: 'external-provider'
        }
      })
    })

    assert.equal(result.verdict, 'FAIL')
    assert.equal(result.evidence.failures[0]?.failure.code, 'FAIL_PRODUCT')
  })
}

test('multi-client runner giữ failed status khi aggregate client set trùng ID', async () => {
  const result = await runMultiClient({
    runId: 'run-duplicate-client-set', clientIds: ['duplicate', 'duplicate'],
    observe: async id => ({ clientId: id, status: 'failed', evidence: {} })
  })

  assert.equal(result.verdict, 'FAIL')
  assert.ok(result.evidence.failures.some(entry => entry.failure.code === 'FAIL_PRODUCT'))
  assert.ok(result.evidence.failures.some(entry => entry.clientId === 'aggregate'))
})

test('multi-client runner giữ skipped counterexample khi aggregate client set trùng ID', async () => {
  const result = await runMultiClient({
    runId: 'run-duplicate-skipped-set', clientIds: ['duplicate', 'duplicate'],
    observe: async id => ({ clientId: id, status: 'skipped', evidence: {} })
  })

  assert.equal(result.verdict, 'INCONCLUSIVE')
  assert.equal(result.evidence.failures.filter(entry => (
    entry.clientId === 'duplicate' && entry.failure.code === 'INCONCLUSIVE_OBSERVER'
  )).length, 2)
  assert.ok(result.evidence.failures.some(entry => entry.clientId === 'aggregate'))
})

void assert
