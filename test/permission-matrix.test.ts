import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluatePermissionMatrix, type PermissionMatrixInput } from '../src/permission-matrix.js'

const cell = (role: string, expected: 'allow' | 'deny' = 'deny'): PermissionMatrixInput['cells'][number] => ({
  role,
  action: 'plugin.admin',
  expected,
  observed: expected === 'allow'
    ? { allowed: true, stateBefore: { value: 0 }, stateAfter: { value: 1 } }
    : { allowed: false, stateBefore: { value: 0 }, stateAfter: { value: 0 } },
  ...(expected === 'allow' ? { stateChange: { value: 'changed' as const } } : {})
})

test('permission matrix PASS khi tất cả role cells PASS', () => {
  const result = evaluatePermissionMatrix({
    project: 'ExamplePlugin', fixture: 'fixture-1', cells: [cell('player'), cell('admin', 'allow')]
  })

  assert.equal(result.verdict, 'PASS')
  assert.deepEqual(result.summary, { total: 2, pass: 2, fail: 0, inconclusive: 0 })
  assert.equal(result.cells[1]?.role, 'admin')
})

test('permission matrix FAIL khi một role cell phá invariant', () => {
  const input: PermissionMatrixInput = {
    project: 'ExamplePlugin', fixture: 'fixture-1', cells: [cell('player'), cell('member')]
  }
  input.cells[1]!.observed!.stateAfter.value = 1

  const result = evaluatePermissionMatrix(input)

  assert.equal(result.verdict, 'FAIL')
  assert.deepEqual(result.summary, { total: 2, pass: 1, fail: 1, inconclusive: 0 })
})

test('permission matrix giữ INCONCLUSIVE khi cell thiếu observed và không có FAIL', () => {
  const input: PermissionMatrixInput = {
    project: 'ExamplePlugin', fixture: 'fixture-1', cells: [cell('player')]
  }
  input.cells[0]!.observed = undefined

  const result = evaluatePermissionMatrix(input)

  assert.equal(result.verdict, 'INCONCLUSIVE')
  assert.deepEqual(result.summary, { total: 1, pass: 0, fail: 0, inconclusive: 1 })
})

test('permission matrix reject duplicate role/action cell và matrix rỗng', () => {
  assert.throws(() => evaluatePermissionMatrix({
    project: 'ExamplePlugin', fixture: 'fixture-1', cells: [cell('player'), cell('player')]
  }), /duplicate/i)
  assert.throws(() => evaluatePermissionMatrix({
    project: 'ExamplePlugin', fixture: 'fixture-1', cells: []
  }), /at least one|empty/i)
})
