import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateCrashRecovery, type CrashRecoveryInput } from '../src/crash-recovery-contract.js'

const base = (): CrashRecoveryInput => ({
  executionId: 'crash-exec-1',
  crash: { authorized: true, observed: true, evidenceId: 'crash-1', exitCode: 137 },
  recovery: { observed: true, ready: true, evidenceId: 'health-1' }
})

test('crash/recovery PASS khi crash và recovery đều được chứng minh', () => {
  const result = evaluateCrashRecovery(base())
  assert.equal(result.verdict, 'PASS')
  assert.deepEqual(result.evidence, { executionId: 'crash-exec-1', crashEvidenceId: 'crash-1', recoveryEvidenceId: 'health-1', exitCode: 137 })
})

test('crash/recovery INCONCLUSIVE khi crash boundary thiếu authorization hoặc observation', () => {
  const input = base()
  input.crash.authorized = false
  const result = evaluateCrashRecovery(input)
  assert.equal(result.verdict, 'INCONCLUSIVE')
  assert.match(result.message, /crash boundary/i)
})

test('crash/recovery INCONCLUSIVE khi recovery evidence thiếu', () => {
  const input = base()
  input.recovery = undefined
  const result = evaluateCrashRecovery(input)
  assert.equal(result.verdict, 'INCONCLUSIVE')
  assert.match(result.message, /recovery/i)
})

test('crash/recovery FAIL khi server không ready sau crash', () => {
  const input = base()
  input.recovery!.ready = false
  const result = evaluateCrashRecovery(input)
  assert.equal(result.verdict, 'FAIL')
  assert.match(result.message, /ready|recover/i)
})

test('crash/recovery reject credential-like IDs và exit code không hợp lệ', () => {
  const input = base()
  input.executionId = 'token-exec'
  assert.throws(() => evaluateCrashRecovery(input), /credential/i)
  input.executionId = 'crash-exec-1'
  input.crash.exitCode = -1
  assert.throws(() => evaluateCrashRecovery(input), /exit/i)
})

void assert
