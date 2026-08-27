import assert from 'node:assert/strict'
import test from 'node:test'
import { PersistenceExecutionCoordinator } from '../src/persistence-coordinator.js'

const before = { key: 'order:1', state: { status: 'PENDING' }, observedAt: '2026-08-20T00:00:00.000Z' }
const after = { key: 'order:1', state: { status: 'PENDING' }, observedAt: '2026-08-20T00:05:00.000Z' }

test('coordinator tạo before, nhận external restart, rồi evaluate after thành PASS', () => {
  const coordinator = new PersistenceExecutionCoordinator('exec-1')
  const beforeRunId = coordinator.recordBefore(before)

  coordinator.recordExternalRestart({ authorized: true, observed: true, evidenceId: 'restart-1' })
  const afterRunId = coordinator.recordAfter(after)
  const result = coordinator.evaluate()

  assert.notEqual(beforeRunId, afterRunId)
  assert.equal(result.verdict, 'PASS')
  assert.deepEqual(result.execution, { executionId: 'exec-1', beforeRunId, afterRunId })
})

test('coordinator reject after trước external restart', () => {
  const coordinator = new PersistenceExecutionCoordinator('exec-1')

  assert.throws(() => coordinator.recordAfter(after), /restart/i)
})

test('coordinator reject restart chưa authorized hoặc chưa observed', () => {
  const coordinator = new PersistenceExecutionCoordinator('exec-1')
  coordinator.recordBefore(before)

  assert.throws(() => coordinator.recordExternalRestart({ authorized: false, observed: true, evidenceId: 'r1' }), /authorized/i)
  assert.throws(() => coordinator.recordExternalRestart({ authorized: true, observed: false, evidenceId: 'r2' }), /observed/i)
})

test('coordinator evaluate thiếu after trả INCONCLUSIVE, không PASS giả', () => {
  const coordinator = new PersistenceExecutionCoordinator('exec-1')
  coordinator.recordBefore(before)
  coordinator.recordExternalRestart({ authorized: true, observed: true, evidenceId: 'restart-1' })

  const result = coordinator.evaluate()

  assert.equal(result.verdict, 'INCONCLUSIVE')
  assert.match(result.message, /after/i)
})

test('coordinator reject duplicate before/after và execution ID nhạy cảm', () => {
  assert.throws(() => new PersistenceExecutionCoordinator('password-reset'), /credential/i)
  const coordinator = new PersistenceExecutionCoordinator('exec-1')
  coordinator.recordBefore(before)
  assert.throws(() => coordinator.recordBefore(before), /before/i)
  coordinator.recordExternalRestart({ authorized: true, observed: true, evidenceId: 'restart-1' })
  coordinator.recordAfter(after)
  assert.throws(() => coordinator.recordAfter(after), /after/i)
})

void assert
