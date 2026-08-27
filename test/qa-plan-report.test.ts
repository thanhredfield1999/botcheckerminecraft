import assert from 'node:assert/strict'
import test from 'node:test'
import { buildQaPlanReport, type QaPlanReportInput } from '../src/qa-plan-report.js'

test('qa plan report giữ verdict, summary, account refs và cell evidence bounded', () => {
  const input: QaPlanReportInput = {
    kind: 'permission',
    verdict: 'PASS',
    project: 'ExamplePlugin',
    fixture: 'paper-fixture-1',
    accounts: ['account-admin', 'account-player'],
    summary: { total: 2, pass: 2, fail: 0, inconclusive: 0 },
    cells: [
      { accountRef: 'account-admin', role: 'admin', action: 'plugin.admin', verdict: 'PASS', message: 'allow', authorizationCount: 1 },
      { accountRef: 'account-player', role: 'player', action: 'plugin.admin', verdict: 'PASS', message: 'deny', authorizationCount: 1 }
    ]
  }

  const result = buildQaPlanReport(input)

  assert.deepEqual(result, input)
  assert.equal(JSON.stringify(result).includes('permission-test'), false)
})

test('qa plan report giữ FAIL và INCONCLUSIVE cell evidence', () => {
  const input: QaPlanReportInput = {
    kind: 'negative-security',
    verdict: 'FAIL',
    project: 'ExamplePlugin',
    fixture: 'paper-fixture-1',
    accounts: ['account-player'],
    summary: { total: 2, pass: 0, fail: 1, inconclusive: 1 },
    cells: [
      { accountRef: 'account-player', caseId: 'invalid-input', verdict: 'FAIL', message: 'mutation', authorizationCount: 1, mutationCount: 1 },
      { accountRef: 'account-player', caseId: 'missing-auth', verdict: 'INCONCLUSIVE', message: 'authorization missing', authorizationCount: 0 }
    ]
  }

  const result = buildQaPlanReport(input)

  assert.equal(result.verdict, 'FAIL')
  assert.deepEqual(result.summary, input.summary)
  assert.equal(result.cells[0]?.mutationCount, 1)
})

test('qa plan report reject unbounded cells, accounts và credential-like refs', () => {
  const base: QaPlanReportInput = {
    kind: 'permission', verdict: 'PASS', project: 'ExamplePlugin', fixture: 'fixture',
    accounts: ['account-1'], summary: { total: 1, pass: 1, fail: 0, inconclusive: 0 },
    cells: [{ accountRef: 'account-1', role: 'player', action: 'x', verdict: 'PASS', message: 'ok', authorizationCount: 1 }]
  }
  assert.throws(() => buildQaPlanReport({ ...base, accounts: Array.from({ length: 65 }, (_, i) => `account-${i}`) }), /bounded|64/i)
  assert.throws(() => buildQaPlanReport({ ...base, cells: Array.from({ length: 65 }, () => base.cells[0]!) }), /bounded|64/i)
  assert.throws(() => buildQaPlanReport({ ...base, accounts: ['password-player'] }), /credential/i)
})

void assert
