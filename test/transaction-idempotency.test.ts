import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateTransactionAttempts, type TransactionAttemptsInput } from '../src/transaction-idempotency.js'

const base = (): TransactionAttemptsInput => ({
  transactionId: 'order-1',
  priceMinor: 100,
  itemKey: 'minecraft:bread',
  quantity: 2,
  before: { balanceMinor: 500, itemQuantity: 0 },
  attempts: [
    { accepted: true, after: { balanceMinor: 400, itemQuantity: 2 }, evidence: { attempt: 1 } },
    { accepted: true, after: { balanceMinor: 400, itemQuantity: 2 }, evidence: { attempt: 2 } }
  ]
})

test('idempotency PASS khi duplicate submit không tạo thêm balance/item delta', () => {
  const result = evaluateTransactionAttempts(base())
  assert.equal(result.verdict, 'PASS')
  assert.equal(result.evidence.attemptCount, 2)
  assert.equal(result.evidence.duplicateMutation, false)
})

test('idempotency FAIL khi duplicate submit trừ tiền hoặc cấp item lần hai', () => {
  const input = base()
  input.attempts[1] = { accepted: true, after: { balanceMinor: 300, itemQuantity: 4 }, evidence: { attempt: 2 } }
  const result = evaluateTransactionAttempts(input)
  assert.equal(result.verdict, 'FAIL')
  assert.equal(result.evidence.duplicateMutation, true)
})

test('idempotency INCONCLUSIVE khi attempts thiếu hoặc evidence không đủ', () => {
  const input = base()
  input.attempts = []
  assert.equal(evaluateTransactionAttempts(input).verdict, 'INCONCLUSIVE')
  input.attempts = [base().attempts[0], undefined as never]
  assert.equal(evaluateTransactionAttempts(input).verdict, 'INCONCLUSIVE')
})

test('idempotency reject credential-like ID và quá nhiều attempts', () => {
  const input = base()
  input.transactionId = 'token-order'
  assert.throws(() => evaluateTransactionAttempts(input), /credential/i)
  input.transactionId = 'order-1'
  input.attempts = Array.from({ length: 17 }, () => base().attempts[0])
  assert.throws(() => evaluateTransactionAttempts(input), /attempt|bounded/i)
})

void assert
