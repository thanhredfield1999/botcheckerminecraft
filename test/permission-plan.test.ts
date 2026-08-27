import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluatePermissionPlan, type PermissionPlanInput } from '../src/permission-plan.js'

const validPlan = (): PermissionPlanInput => ({
  project: 'ExamplePlugin',
  fixture: 'paper-fixture-1',
  cells: [
    {
      accountRef: 'account-player', role: 'player', action: 'plugin.admin', expected: 'deny',
      authorization: ['permission-test'],
      observed: { allowed: false, stateBefore: { value: 0 }, stateAfter: { value: 0 } }
    },
    {
      accountRef: 'account-admin', role: 'admin', action: 'plugin.admin', expected: 'allow',
      authorization: ['permission-test'],
      observed: { allowed: true, stateBefore: { value: 0 }, stateAfter: { value: 1 } },
      stateChange: { value: 'changed' }
    }
  ]
})

test('permission plan PASS khi mọi account cell hợp lệ và PASS', () => {
  const result = evaluatePermissionPlan(validPlan())

  assert.equal(result.verdict, 'PASS')
  assert.deepEqual(result.summary, { total: 2, pass: 2, fail: 0, inconclusive: 0 })
  assert.deepEqual(result.accounts, ['account-admin', 'account-player'])
})

test('permission plan INCONCLUSIVE khi thiếu authorization cho cell', () => {
  const input = validPlan()
  input.cells[1]!.authorization = []

  const result = evaluatePermissionPlan(input)

  assert.equal(result.verdict, 'INCONCLUSIVE')
  assert.equal(result.cells[1]?.evidence.authorization, undefined)
  assert.match(result.cells[1]?.message ?? '', /authorization/i)
})

test('permission plan reject duplicate account/action cell', () => {
  const input = validPlan()
  input.cells[1]!.accountRef = 'account-player'

  assert.throws(() => evaluatePermissionPlan(input), /duplicate/i)
})

test('permission plan reject credential-like account reference', () => {
  const input = validPlan()
  input.cells[0]!.accountRef = 'password-player'

  assert.throws(() => evaluatePermissionPlan(input), /credential/i)
})

test('permission plan reject unbounded cells', () => {
  const input = validPlan()
  input.cells = Array.from({ length: 65 }, (_, index) => ({
    ...validPlan().cells[0]!, accountRef: `account-${index}`, action: `plugin.action.${index}`
  }))

  assert.throws(() => evaluatePermissionPlan(input), /bounded|64/i)
})

void assert
