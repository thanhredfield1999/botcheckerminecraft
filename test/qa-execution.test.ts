import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluatePersistenceExecution, type PersistenceExecutionInput } from '../src/qa-execution.js'

const baseInput = (): PersistenceExecutionInput => ({
  executionId: 'exec-1',
  beforeRunId: 'run-before',
  afterRunId: 'run-after',
  persistence: {
    before: {
      key: 'order:fixture-1',
      state: { status: 'PENDING', quantity: 2 },
      observedAt: '2026-08-20T00:00:00.000Z'
    },
    after: {
      key: 'order:fixture-1',
      state: { status: 'PENDING', quantity: 2 },
      observedAt: '2026-08-20T00:05:00.000Z'
    },
    restart: { authorized: true, observed: true, evidenceId: 'restart-1' }
  }
})

test('persistence execution PASS khi before và after run ID khác nhau', () => {
  const result = evaluatePersistenceExecution(baseInput())

  assert.equal(result.verdict, 'PASS')
  assert.deepEqual(result.execution, {
    executionId: 'exec-1', beforeRunId: 'run-before', afterRunId: 'run-after'
  })
})

test('persistence execution INCONCLUSIVE khi before và after dùng cùng run ID', () => {
  const input = baseInput()
  input.afterRunId = input.beforeRunId

  const result = evaluatePersistenceExecution(input)

  assert.equal(result.verdict, 'INCONCLUSIVE')
  assert.match(result.message, /distinct|different|run/i)
})

test('persistence execution INCONCLUSIVE khi execution context thiếu restart evidence', () => {
  const input = baseInput()
  input.persistence.restart.evidenceId = ''

  assert.throws(() => evaluatePersistenceExecution(input), /restart evidence/i)
})

test('persistence execution reject credential-like run IDs và unbounded metadata', () => {
  const input = baseInput()
  input.executionId = 'password-reset'

  assert.throws(() => evaluatePersistenceExecution(input), /credential/i)
})

test('persistence execution giữ FAIL từ state evaluator và thêm run linkage', () => {
  const input = baseInput()
  input.persistence.after!.state.status = 'COMPLETE'

  const result = evaluatePersistenceExecution(input)

  assert.equal(result.verdict, 'FAIL')
  assert.deepEqual(result.evidence.changedKeys, ['status'])
  assert.deepEqual(result.execution, {
    executionId: 'exec-1', beforeRunId: 'run-before', afterRunId: 'run-after'
  })
})
