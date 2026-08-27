import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMultiAccountQaPlan, type MultiAccountReportKind } from '../src/multi-account-report.js'
import type { MultiAccountRunnerResult } from '../src/multi-account-runner.js'

const runnerResult: MultiAccountRunnerResult = {
  verdict: 'FAIL',
  plan: {
    verdict: 'PASS', project: 'ExamplePlugin', fixture: 'paper-fixture-1',
    authorization: ['isolated-fixture'], maxConcurrent: 1,
    accounts: [
      { accountRef: 'account-player', role: 'player', order: 1, status: 'READY' },
      { accountRef: 'account-admin', role: 'admin', order: 2, status: 'READY' }
    ]
  },
  accounts: [
    { accountRef: 'account-player', role: 'player', order: 1, verdict: 'PASS', message: 'permission deny safe', evidence: { mutationCount: 0 } },
    { accountRef: 'account-admin', role: 'admin', order: 2, verdict: 'FAIL', message: 'mutation detected', evidence: { mutationCount: 1 } }
  ]
}

test('multi-account result chuyển thành qaPlan cells bounded', () => {
  const result = buildMultiAccountQaPlan(runnerResult, 'negative-security')
  assert.equal(result.kind, 'negative-security')
  assert.equal(result.verdict, 'FAIL')
  assert.deepEqual(result.accounts, ['account-admin', 'account-player'])
  assert.deepEqual(result.summary, { total: 2, pass: 1, fail: 1, inconclusive: 0 })
  assert.equal(result.cells[1]?.mutationCount, 1)
  assert.equal('authorization' in result, false)
})

test('multi-account result giữ INCONCLUSIVE khi account execution chưa chạy', () => {
  const input: MultiAccountRunnerResult = {
    ...runnerResult,
    verdict: 'INCONCLUSIVE',
    plan: { ...runnerResult.plan, verdict: 'INCONCLUSIVE' },
    accounts: runnerResult.plan.accounts.map(account => ({
      accountRef: account.accountRef, role: account.role, order: account.order,
      verdict: 'INCONCLUSIVE' as const, message: 'Authorization missing; account execution not started'
    }))
  }
  const result = buildMultiAccountQaPlan(input, 'permission')
  assert.equal(result.verdict, 'INCONCLUSIVE')
  assert.deepEqual(result.summary, { total: 2, pass: 0, fail: 0, inconclusive: 2 })
  assert.deepEqual(result.cells.map(cell => cell.authorizationCount), [0, 0])
})

test('multi-account report reject unsupported kind hoặc inconsistent account set', () => {
  assert.throws(() => buildMultiAccountQaPlan(runnerResult, 'unsupported' as MultiAccountReportKind), /kind/i)
  const invalid = { ...runnerResult, accounts: runnerResult.accounts.slice(0, 1) }
  assert.throws(() => buildMultiAccountQaPlan(invalid, 'permission'), /account|plan/i)
})

void assert

test('multi-account report reject credential-like account message từ caller trực tiếp', () => {
  const invalid: MultiAccountRunnerResult = {
    ...runnerResult,
    accounts: runnerResult.accounts.map((account, index) => index === 0
      ? { ...account, message: 'password=secret123' }
      : account)
  }
  assert.throws(() => buildMultiAccountQaPlan(invalid, 'permission'), /credential|message/i)
})
