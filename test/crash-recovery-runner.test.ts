import assert from 'node:assert/strict'
import test from 'node:test'
import { runCrashRecovery } from '../src/crash-recovery-runner.js'

test('crash recovery runner gọi crash rồi recovery theo thứ tự', async () => {
  const calls: string[] = []
  const result = await runCrashRecovery({
    executionId: 'exec-1',
    crash: async () => { calls.push('crash'); return { authorized: true, observed: true, evidenceId: 'crash-1', exitCode: 137 } },
    recovery: async () => { calls.push('recovery'); return { observed: true, ready: true, evidenceId: 'health-1' } }
  })
  assert.deepEqual(calls, ['crash', 'recovery'])
  assert.equal(result.verdict, 'PASS')
})

test('crash recovery runner không gọi recovery khi crash provider lỗi', async () => {
  let recoveryCalled = false
  const result = await runCrashRecovery({
    executionId: 'exec-2',
    crash: async () => { throw new Error('external crash provider unavailable') },
    recovery: async () => { recoveryCalled = true; return { observed: true, ready: true, evidenceId: 'health-2' } }
  })
  assert.equal(recoveryCalled, false)
  assert.equal(result.verdict, 'INCONCLUSIVE')
})

void assert
