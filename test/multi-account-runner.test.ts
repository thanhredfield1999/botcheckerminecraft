import assert from 'node:assert/strict'
import test from 'node:test'
import { runMultiAccountPlan } from '../src/multi-account-runner.js'

const input = {
  project: 'ExamplePlugin', fixture: 'paper-fixture-1', authorization: ['isolated-fixture'],
  accounts: [
    { accountRef: 'account-player', role: 'player', order: 1 },
    { accountRef: 'account-admin', role: 'admin', order: 2 }
  ]
}

test('multi-account runner thực thi tuần tự theo order và aggregate PASS', async () => {
  const calls: string[] = []
  const result = await runMultiAccountPlan(input, async account => {
    calls.push(account.accountRef)
    return { verdict: 'PASS', message: `completed ${account.role}`, evidence: { observed: true } }
  })

  assert.equal(result.verdict, 'PASS')
  assert.deepEqual(calls, ['account-player', 'account-admin'])
  assert.deepEqual(result.accounts.map(account => account.verdict), ['PASS', 'PASS'])
})

test('multi-account runner dừng an toàn ở INCONCLUSIVE khi thiếu authorization', async () => {
  const result = await runMultiAccountPlan({ ...input, authorization: [] }, async () => {
    throw new Error('must not execute')
  })

  assert.equal(result.verdict, 'INCONCLUSIVE')
  assert.deepEqual(result.accounts.map(account => account.message), [
    'Authorization missing; account execution not started',
    'Authorization missing; account execution not started'
  ])
})

test('multi-account runner aggregate FAIL và giữ evidence bounded', async () => {
  const result = await runMultiAccountPlan(input, async account => account.role === 'admin'
    ? { verdict: 'FAIL', message: 'denied invariant', evidence: { mutationCount: 1 } }
    : { verdict: 'PASS', message: 'ok' })

  assert.equal(result.verdict, 'FAIL')
  assert.equal(result.accounts[1]?.evidence?.mutationCount, 1)
})

test('multi-account runner biến executor lỗi hoặc evidence nhạy cảm thành INCONCLUSIVE', async () => {
  const errorResult = await runMultiAccountPlan(input, async account => {
    if (account.role === 'player') throw new Error('fixture unavailable')
    return { verdict: 'PASS', message: 'ok' }
  })
  assert.equal(errorResult.verdict, 'INCONCLUSIVE')
  assert.match(errorResult.accounts[0]?.message ?? '', /INCONCLUSIVE_EXECUTION/)

  const sensitiveResult = await runMultiAccountPlan(input, async () => ({
    verdict: 'PASS', message: 'ok', evidence: { token: '[REDACTED]' }
  }))
  assert.equal(sensitiveResult.verdict, 'INCONCLUSIVE')
  assert.equal(sensitiveResult.accounts[0]?.verdict, 'INCONCLUSIVE')
})

test('multi-account runner reject executor thiếu', async () => {
  await assert.rejects(() => runMultiAccountPlan(input, undefined as never), /executor/i)
})

test('multi-account runner redact credential trong executor exception', async () => {
  const result = await runMultiAccountPlan(input, async () => {
    throw new Error('password=secret123 Bearer abc.def.ghi')
  })

  assert.equal(result.verdict, 'INCONCLUSIVE')
  assert.doesNotMatch(JSON.stringify(result), /secret123|abc\.def\.ghi/)
  assert.match(result.accounts[0]?.message ?? '', /\[REDACTED\]/)
})
