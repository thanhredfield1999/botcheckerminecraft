import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTransactionReport } from '../src/transaction-report.js'
import { evaluateTransaction } from '../src/transaction-contract.js'

test('transaction result chuyển thành manifest report bounded', () => {
  const result = evaluateTransaction({
    transactionId: 'order-1', expected: 'complete', priceMinor: 100, itemKey: 'minecraft:bread', quantity: 2,
    before: { balanceMinor: 500, itemQuantity: 0 },
    observed: { accepted: true, after: { balanceMinor: 400, itemQuantity: 2 }, evidence: { message: 'completed' } }
  })
  const report = buildTransactionReport(result, 'Plugin', 'fixture')
  assert.equal(report.kind, 'transaction')
  assert.equal(report.verdict, 'PASS')
  assert.deepEqual(report.evidence, { transactionId: 'order-1', expected: 'complete', accepted: true, balanceDeltaMinor: -100, itemDelta: 2, message: result.message })
})

test('transaction report giữ INCONCLUSIVE và không giữ raw state', () => {
  const result = evaluateTransaction({
    transactionId: 'order-2', expected: 'complete', priceMinor: 100, itemKey: 'minecraft:bread', quantity: 1
  })
  const report = buildTransactionReport(result, 'Plugin', 'fixture')
  assert.equal(report.verdict, 'INCONCLUSIVE')
  assert.equal('before' in report, false)
  assert.equal('after' in report, false)
})

test('transaction report reject credential-like hoặc message vượt giới hạn', () => {
  const result = evaluateTransaction({
    transactionId: 'order-3', expected: 'complete', priceMinor: 100, itemKey: 'minecraft:bread', quantity: 1,
    before: { balanceMinor: 500, itemQuantity: 0 },
    observed: { accepted: true, after: { balanceMinor: 400, itemQuantity: 1 }, evidence: { message: 'ok' } }
  })
  assert.throws(() => buildTransactionReport({ ...result, evidence: { ...result.evidence, transactionId: 'token-order' } }, 'Plugin', 'fixture'), /credential/i)
  assert.throws(() => buildTransactionReport({ ...result, message: 'x'.repeat(257) }, 'Plugin', 'fixture'), /message|bounded/i)
})

void assert
