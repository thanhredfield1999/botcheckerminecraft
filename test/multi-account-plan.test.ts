import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMultiAccountPlan, type MultiAccountPlanInput } from '../src/multi-account-plan.js'

const validPlan = (): MultiAccountPlanInput => ({
  project: 'ExamplePlugin',
  fixture: 'paper-fixture-1',
  authorization: ['isolated-fixture', 'multi-account'],
  accounts: [
    { accountRef: 'account-player', role: 'player', order: 1 },
    { accountRef: 'account-admin', role: 'admin', order: 2 }
  ]
})

test('multi-account plan sắp xếp account theo order và giữ metadata bounded', () => {
  const result = buildMultiAccountPlan(validPlan())

  assert.deepEqual(result.accounts.map(account => account.accountRef), ['account-player', 'account-admin'])
  assert.deepEqual(result.authorization, ['isolated-fixture', 'multi-account'])
  assert.equal(result.maxConcurrent, 1)
})

test('multi-account plan INCONCLUSIVE khi thiếu authorization', () => {
  const input = validPlan()
  input.authorization = []

  const result = buildMultiAccountPlan(input)

  assert.equal(result.verdict, 'INCONCLUSIVE')
  assert.equal(result.accounts[0]?.status, 'INCONCLUSIVE')
})

test('multi-account plan reject duplicate/order invalid/credential-like refs', () => {
  const duplicate = validPlan()
  duplicate.accounts[1]!.accountRef = 'account-player'
  assert.throws(() => buildMultiAccountPlan(duplicate), /duplicate/i)

  const invalidOrder = validPlan()
  invalidOrder.accounts[1]!.order = 1
  assert.throws(() => buildMultiAccountPlan(invalidOrder), /order/i)

  const credential = validPlan()
  credential.accounts[0]!.accountRef = 'token-player'
  assert.throws(() => buildMultiAccountPlan(credential), /credential/i)
})

test('multi-account plan giới hạn tối đa 16 account và không cho concurrency tùy ý', () => {
  const input = validPlan()
  input.accounts = Array.from({ length: 17 }, (_, index) => ({
    accountRef: `account-${index}`, role: 'player', order: index + 1
  }))
  assert.throws(() => buildMultiAccountPlan(input), /bounded|16/i)

  const concurrent = validPlan()
  concurrent.maxConcurrent = 2
  assert.throws(() => buildMultiAccountPlan(concurrent), /concurrent|sequential/i)
})

void assert
