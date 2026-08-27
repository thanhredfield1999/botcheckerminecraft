import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCrashRecoveryReport } from '../src/crash-recovery-report.js'
import { evaluateCrashRecovery } from '../src/crash-recovery-contract.js'

test('crash recovery report bounded và không giữ raw provider payload', () => {
  const result = evaluateCrashRecovery({ executionId: 'exec-1', crash: { authorized: true, observed: true, evidenceId: 'crash-1', exitCode: 137 }, recovery: { observed: true, ready: true, evidenceId: 'health-1' } })
  const report = buildCrashRecoveryReport(result, 'Plugin', 'fixture')
  assert.equal(report.kind, 'crash-recovery')
  assert.equal(report.verdict, 'PASS')
  assert.equal('crash' in report, false)
})

test('crash recovery report reject invalid bounded metadata', () => {
  const result = evaluateCrashRecovery({ executionId: 'exec-1', crash: { authorized: true, observed: true, evidenceId: 'crash-1', exitCode: 137 }, recovery: { observed: true, ready: true, evidenceId: 'health-1' } })
  assert.throws(() => buildCrashRecoveryReport({ ...result, evidence: { ...result.evidence, executionId: 'token-exec' } }, 'Plugin', 'fixture'), /credential/i)
})

void assert
