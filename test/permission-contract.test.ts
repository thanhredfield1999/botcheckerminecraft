import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluatePermissionCell, type PermissionCellInput } from '../src/permission-contract.js'

const baseInput = (): PermissionCellInput => ({
  role: 'player',
  action: 'plugin.admin',
  expected: 'deny',
  observed: { allowed: false, stateBefore: { balance: 100 }, stateAfter: { balance: 100 } }
})

test('permission cell PASS khi role bị từ chối và state không đổi', () => {
  const result = evaluatePermissionCell(baseInput())
  assert.equal(result.verdict, 'PASS')
  assert.equal(result.message, 'Permission deny matched and state invariant held')
})

test('permission cell PASS khi role được phép và state mutation đúng expectation', () => {
  const input = baseInput()
  input.expected = 'allow'
  input.observed = { allowed: true, stateBefore: { balance: 100 }, stateAfter: { balance: 90 } }
  input.stateChange = { balance: 'changed' }

  const result = evaluatePermissionCell(input)
  assert.equal(result.verdict, 'PASS')
})

test('permission cell FAIL khi deny nhưng plugin mutation state', () => {
  const input = baseInput()
  input.observed!.stateAfter.balance = 90

  const result = evaluatePermissionCell(input)
  assert.equal(result.verdict, 'FAIL')
  assert.deepEqual(result.evidence.changedKeys, ['balance'])
})

test('permission cell FAIL khi allow nhưng action bị từ chối', () => {
  const input = baseInput()
  input.expected = 'allow'
  input.stateChange = { balance: 'changed' }

  const result = evaluatePermissionCell(input)
  assert.equal(result.verdict, 'FAIL')
  assert.match(result.message, /allow/i)
})

test('permission cell INCONCLUSIVE khi role hoặc observed response thiếu', () => {
  const input = baseInput()
  input.role = ''

  assert.throws(() => evaluatePermissionCell(input), /role/i)

  const missing = baseInput()
  missing.observed = undefined
  const result = evaluatePermissionCell(missing)
  assert.equal(result.verdict, 'INCONCLUSIVE')
})

test('permission cell không cho phép credential trong role/action/state evidence', () => {
  const input = baseInput()
  input.action = 'password.reset'
  assert.throws(() => evaluatePermissionCell(input), /credential/i)
})
