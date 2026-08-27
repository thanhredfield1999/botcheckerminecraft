import assert from 'node:assert/strict'
import test from 'node:test'
import { runPermissionPlan } from '../src/authorized-plan-runner.js'
import { runNegativePlan } from '../src/authorized-plan-runner.js'

test('permission runner thực thi tuần tự và evaluator trả verdict', async () => {
  const calls: string[] = []
  const result = await runPermissionPlan({
    project: 'Plugin', fixture: 'fixture', cells: [{ accountRef: 'player', authorization: ['fixture-auth'], role: 'member', action: 'open', expected: 'deny' }]
  }, async cell => {
    calls.push(cell.accountRef)
    return { allowed: false, stateBefore: { value: 1 }, stateAfter: { value: 1 } }
  })
  assert.deepEqual(calls, ['player'])
  assert.equal(result.verdict, 'PASS')
})

test('permission runner biến executor lỗi thành INCONCLUSIVE', async () => {
  const result = await runPermissionPlan({
    project: 'Plugin', fixture: 'fixture', cells: [{ accountRef: 'player', authorization: ['fixture-auth'], role: 'member', action: 'open', expected: 'deny' }]
  }, async () => { throw new Error('provider unavailable') })
  assert.equal(result.verdict, 'INCONCLUSIVE')
  assert.match(result.cells[0]?.message ?? '', /provider/i)
})

test('negative runner không gọi executor khi authorization thiếu', async () => {
  let called = false
  const result = await runNegativePlan({
    project: 'Plugin', fixture: 'fixture', cases: [{ accountRef: 'player', authorization: [], caseId: 'malformed', expected: 'reject', observed: undefined }]
  }, async () => { called = true; return { rejected: true, mutationCount: 0, evidence: { message: 'rejected' } } })
  assert.equal(called, false)
  assert.equal(result.verdict, 'INCONCLUSIVE')
})

void assert
