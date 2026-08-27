import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateTransaction, type TransactionInput } from '../src/transaction-contract.js'

const base = (): TransactionInput => ({
  transactionId: 'order-1',
  expected: 'complete',
  priceMinor: 100,
  itemKey: 'minecraft:bread',
  quantity: 2,
  before: { balanceMinor: 500, itemQuantity: 0 },
  observed: { accepted: true, after: { balanceMinor: 400, itemQuantity: 2 }, evidence: { message: 'completed' } }
})

test('transaction PASS khi giao dịch hoàn tất và delta đúng', () => {
  const result = evaluateTransaction(base())
  assert.equal(result.verdict, 'PASS')
  assert.deepEqual(result.evidence, { transactionId: 'order-1', expected: 'complete', accepted: true, balanceDeltaMinor: -100, itemDelta: 2 })
})

test('transaction FAIL khi trừ tiền sai hoặc cấp item sai', () => {
  const input = base()
  input.observed!.after.balanceMinor = 300
  const result = evaluateTransaction(input)
  assert.equal(result.verdict, 'FAIL')
  assert.match(result.message, /balance|delta/i)
})

test('transaction reject PASS khi expected reject và không mutation', () => {
  const input = base()
  input.expected = 'reject'
  input.observed = { accepted: false, after: { balanceMinor: 500, itemQuantity: 0 }, evidence: { message: 'insufficient funds' } }
  const result = evaluateTransaction(input)
  assert.equal(result.verdict, 'PASS')
})

test('transaction INCONCLUSIVE khi observed hoặc before state thiếu', () => {
  const input = base()
  input.observed = undefined
  assert.equal(evaluateTransaction(input).verdict, 'INCONCLUSIVE')
  input.observed = base().observed
  input.before = undefined as never
  assert.equal(evaluateTransaction(input).verdict, 'INCONCLUSIVE')
})

test('transaction reject credential-like ID, negative amount và evidence quá lớn', () => {
  const input = base()
  input.transactionId = 'token-order'
  assert.throws(() => evaluateTransaction(input), /credential/i)
  input.transactionId = 'order-1'
  input.priceMinor = -1
  assert.throws(() => evaluateTransaction(input), /price|amount/i)
  input.priceMinor = 100
  input.observed!.evidence = { payload: 'x'.repeat(9000) }
  assert.throws(() => evaluateTransaction(input), /bounded|payload/i)
})

void assert
