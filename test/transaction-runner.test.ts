import assert from 'node:assert/strict'
import test from 'node:test'
import { runTransaction } from '../src/transaction-runner.js'

test('transaction runner lấy before, gọi provider, evaluate delta thành PASS', async () => {
  const calls: string[] = []
  const result = await runTransaction({
    transaction: { transactionId: 'order-1', expected: 'complete', priceMinor: 100, itemKey: 'minecraft:bread', quantity: 2 },
    before: async () => { calls.push('before'); return { balanceMinor: 500, itemQuantity: 0 } },
    execute: async (_request, _before) => { calls.push('execute'); return { accepted: true, after: { balanceMinor: 400, itemQuantity: 2 }, evidence: { message: 'completed' } } }
  })
  assert.deepEqual(calls, ['before', 'execute'])
  assert.equal(result.verdict, 'PASS')
})

test('transaction runner provider lỗi trả INCONCLUSIVE và không giả PASS', async () => {
  const result = await runTransaction({
    transaction: { transactionId: 'order-2', expected: 'complete', priceMinor: 100, itemKey: 'minecraft:bread', quantity: 1 },
    before: async () => ({ balanceMinor: 500, itemQuantity: 0 }),
    execute: async () => { throw new Error('economy provider unavailable') }
  })
  assert.equal(result.verdict, 'INCONCLUSIVE')
  assert.match(result.message, /provider/i)
})

test('transaction runner before provider lỗi trả INCONCLUSIVE và không gọi execute', async () => {
  let executeCalled = false
  const result = await runTransaction({
    transaction: { transactionId: 'order-3', expected: 'reject', priceMinor: 100, itemKey: 'minecraft:bread', quantity: 1 },
    before: async () => { throw new Error('snapshot unavailable') },
    execute: async () => { executeCalled = true; return { accepted: false, after: { balanceMinor: 500, itemQuantity: 0 }, evidence: {} } }
  })
  assert.equal(executeCalled, false)
  assert.equal(result.verdict, 'INCONCLUSIVE')
})

test('transaction runner reject executor thiếu', async () => {
  await assert.rejects(() => runTransaction({
    transaction: { transactionId: 'order-4', expected: 'reject', priceMinor: 0, itemKey: 'minecraft:bread', quantity: 1 },
    before: async () => ({ balanceMinor: 1, itemQuantity: 0 }),
    execute: undefined as never
  }), /executor/i)
})

void assert
