import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateNegativeCase, type NegativeCaseInput } from '../src/negative-contract.js'

const baseInput = (): NegativeCaseInput => ({
  caseId: 'duplicate-submit',
  expected: 'reject',
  observed: {
    rejected: true,
    mutationCount: 0,
    evidence: { message: 'Already processing' }
  }
})

test('negative case PASS khi request bị reject và không mutation', () => {
  const result = evaluateNegativeCase(baseInput())
  assert.equal(result.verdict, 'PASS')
  assert.equal(result.message, 'Negative case rejected safely with no mutation')
})

test('negative case FAIL khi request bị reject nhưng vẫn mutation', () => {
  const input = baseInput()
  input.observed!.mutationCount = 1

  const result = evaluateNegativeCase(input)
  assert.equal(result.verdict, 'FAIL')
  assert.equal(result.evidence.mutationCount, 1)
})

test('negative case FAIL khi expected reject nhưng request được accept', () => {
  const input = baseInput()
  input.observed!.rejected = false

  const result = evaluateNegativeCase(input)
  assert.equal(result.verdict, 'FAIL')
  assert.match(result.message, /reject/i)
})

test('negative case INCONCLUSIVE khi evidence thiếu', () => {
  const input = baseInput()
  input.observed = undefined

  const result = evaluateNegativeCase(input)
  assert.equal(result.verdict, 'INCONCLUSIVE')
})

test('negative case từ chối payload vượt giới hạn hoặc credential', () => {
  const input = baseInput()
  input.caseId = 'password-reset'
  assert.throws(() => evaluateNegativeCase(input), /credential/i)
})


test('negative case không cho phép mutation count âm', () => {
  const input = baseInput()
  input.observed!.mutationCount = -1
  assert.throws(() => evaluateNegativeCase(input), /mutation/i)
})

test('negative case hỗ trợ expected no-mutation cho action hợp lệ', () => {
  const input = baseInput()
  input.expected = 'no-mutation'
  input.observed!.rejected = false

  const result = evaluateNegativeCase(input)
  assert.equal(result.verdict, 'PASS')
})

test('negative case FAIL khi evidence message chứa credential', () => {
  const input = baseInput()
  input.observed!.evidence.message = 'token leaked'
  assert.throws(() => evaluateNegativeCase(input), /credential/i)
})

void assert.equal(typeof baseInput, 'function')
