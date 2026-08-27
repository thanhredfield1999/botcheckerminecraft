import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateNegativePlan, type NegativePlanInput } from '../src/negative-plan.js'

const validPlan = (): NegativePlanInput => ({
  project: 'ExamplePlugin',
  fixture: 'paper-fixture-1',
  cases: [
    {
      accountRef: 'account-player', caseId: 'unauthorized-admin', expected: 'reject',
      authorization: ['negative-security'],
      observed: { rejected: true, mutationCount: 0, evidence: { response: 'denied' } }
    },
    {
      accountRef: 'account-member', caseId: 'invalid-input', expected: 'no-mutation',
      authorization: ['negative-security'],
      observed: { rejected: true, mutationCount: 0, evidence: { response: 'invalid' } }
    }
  ]
})

test('negative plan PASS khi mọi account case an toàn', () => {
  const result = evaluateNegativePlan(validPlan())

  assert.equal(result.verdict, 'PASS')
  assert.deepEqual(result.summary, { total: 2, pass: 2, fail: 0, inconclusive: 0 })
  assert.deepEqual(result.accounts, ['account-member', 'account-player'])
})

test('negative plan FAIL khi một account case mutate state', () => {
  const input = validPlan()
  input.cases[1]!.observed!.mutationCount = 1

  const result = evaluateNegativePlan(input)

  assert.equal(result.verdict, 'FAIL')
  assert.deepEqual(result.summary, { total: 2, pass: 1, fail: 1, inconclusive: 0 })
})

test('negative plan INCONCLUSIVE khi thiếu authorization hoặc observation', () => {
  const input = validPlan()
  input.cases[0]!.authorization = []
  input.cases[1]!.observed = undefined

  const result = evaluateNegativePlan(input)

  assert.equal(result.verdict, 'INCONCLUSIVE')
  assert.deepEqual(result.summary, { total: 2, pass: 0, fail: 0, inconclusive: 2 })
  assert.match(result.cases[0]?.message ?? '', /authorization/i)
})

test('negative plan reject duplicate account/case and credential-like account', () => {
  const duplicate = validPlan()
  duplicate.cases[1]!.accountRef = 'account-player'
  duplicate.cases[1]!.caseId = 'unauthorized-admin'
  assert.throws(() => evaluateNegativePlan(duplicate), /duplicate/i)

  const credential = validPlan()
  credential.cases[0]!.accountRef = 'token-player'
  assert.throws(() => evaluateNegativePlan(credential), /credential/i)
})

test('negative plan reject more than 64 bounded cases', () => {
  const input = validPlan()
  input.cases = Array.from({ length: 65 }, (_, index) => ({
    ...validPlan().cases[0]!, accountRef: `account-${index}`, caseId: `case-${index}`
  }))

  assert.throws(() => evaluateNegativePlan(input), /bounded|64/i)
})

void assert
