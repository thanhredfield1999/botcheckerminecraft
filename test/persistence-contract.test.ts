import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluatePersistence, type PersistenceEvaluationInput } from '../src/persistence-contract.js'

const baseInput = (): PersistenceEvaluationInput => ({
  before: {
    key: 'order:fixture-1',
    state: { status: 'PENDING', quantity: 3, claimed: false },
    observedAt: '2026-08-20T00:00:00.000Z'
  },
  after: {
    key: 'order:fixture-1',
    state: { status: 'PENDING', quantity: 3, claimed: false },
    observedAt: '2026-08-20T00:05:00.000Z'
  },
  restart: { authorized: true, observed: true, evidenceId: 'restart-1' }
})

test('persistence contract PASS khi state giữ nguyên qua restart boundary', () => {
  const result = evaluatePersistence(baseInput())

  assert.equal(result.verdict, 'PASS')
  assert.equal(result.message, 'Persistence state matched after authorized restart')
  assert.deepEqual(result.evidence, {
    key: 'order:fixture-1',
    before: { status: 'PENDING', quantity: 3, claimed: false },
    after: { status: 'PENDING', quantity: 3, claimed: false },
    restartEvidenceId: 'restart-1'
  })
})

test('persistence contract FAIL khi state đổi sau restart', () => {
  const input = baseInput()
  input.after!.state.status = 'COMPLETE'

  const result = evaluatePersistence(input)

  assert.equal(result.verdict, 'FAIL')
  assert.equal(result.message, 'Persisted state changed after authorized restart')
  assert.deepEqual(result.evidence.changedKeys, ['status'])
})

test('persistence contract INCONCLUSIVE khi restart boundary chưa được chứng minh', () => {
  const input = baseInput()
  input.restart.observed = false

  const result = evaluatePersistence(input)

  assert.equal(result.verdict, 'INCONCLUSIVE')
  assert.match(result.message, /restart boundary/i)
})

test('persistence contract không coi thiếu snapshot là plugin FAIL', () => {
  const input = baseInput()
  input.after = undefined

  const result = evaluatePersistence(input)

  assert.equal(result.verdict, 'INCONCLUSIVE')
  assert.match(result.message, /snapshot/i)
})

test('persistence contract từ chối key có credential hoặc payload vượt giới hạn', () => {
  const input = baseInput()
  input.before.key = 'password:secret'

  assert.throws(() => evaluatePersistence(input), /credential|secret/i)
})
