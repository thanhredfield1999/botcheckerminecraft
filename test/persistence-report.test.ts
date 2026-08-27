import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPersistenceQaReport } from '../src/persistence-report.js'
import type { PersistenceExecutionResult } from '../src/qa-execution.js'

test('persistence result chuyển thành manifest evidence bounded', () => {
  const result: PersistenceExecutionResult = {
    verdict: 'PASS',
    message: 'state persisted',
    evidence: { key: 'npc.spawn', before: { enabled: true }, after: { enabled: true } },
    execution: { executionId: 'exec-1', beforeRunId: 'before-1', afterRunId: 'after-1' }
  }

  const report = buildPersistenceQaReport(result, 'ExamplePlugin', 'paper-fixture-1')

  assert.deepEqual(report, {
    kind: 'persistence',
    verdict: 'PASS',
    project: 'ExamplePlugin',
    fixture: 'paper-fixture-1',
    execution: { executionId: 'exec-1', beforeRunId: 'before-1', afterRunId: 'after-1' },
    evidence: { key: 'npc.spawn', message: 'state persisted' }
  })
})

test('persistence report giữ INCONCLUSIVE khi external restart evidence thiếu', () => {
  const result: PersistenceExecutionResult = {
    verdict: 'INCONCLUSIVE',
    message: 'INCONCLUSIVE_RESTART_BOUNDARY: external restart evidence is missing',
    evidence: { key: 'npc.spawn' },
    execution: { executionId: 'exec-1', beforeRunId: 'before-exec-1', afterRunId: 'unassigned-after-run' }
  }

  const report = buildPersistenceQaReport(result, 'ExamplePlugin', 'fixture')

  assert.equal(report.verdict, 'INCONCLUSIVE')
  assert.equal(report.evidence.key, 'npc.spawn')
})

test('persistence report reject credential-like hoặc evidence vượt giới hạn', () => {
  const base: PersistenceExecutionResult = {
    verdict: 'PASS', message: 'ok', evidence: { key: 'npc.spawn' },
    execution: { executionId: 'exec-1', beforeRunId: 'before-1', afterRunId: 'after-1' }
  }
  assert.throws(() => buildPersistenceQaReport({ ...base, execution: { ...base.execution, executionId: 'token-exec' } }, 'Project', 'fixture'), /credential/i)
  assert.throws(() => buildPersistenceQaReport({ ...base, message: 'x'.repeat(257) }, 'Project', 'fixture'), /message|bounded/i)
})

void assert
