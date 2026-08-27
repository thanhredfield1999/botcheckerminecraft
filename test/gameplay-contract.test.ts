import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateGameplayJourney } from '../src/gameplay-contract.js'

test('gameplay PASS khi các bước theo thứ tự đều observed', () => {
  const result = evaluateGameplayJourney({ journeyId: 'order-flow', expectedSteps: ['open', 'buy', 'claim'], observedSteps: [
    { id: 'open', status: 'passed', evidence: { message: 'opened' } },
    { id: 'buy', status: 'passed', evidence: { message: 'bought' } },
    { id: 'claim', status: 'passed', evidence: { message: 'claimed' } }
  ] })
  assert.equal(result.verdict, 'PASS')
})

test('gameplay FAIL khi step failed hoặc thứ tự sai', () => {
  const result = evaluateGameplayJourney({ journeyId: 'order-flow', expectedSteps: ['open', 'buy'], observedSteps: [{ id: 'buy', status: 'passed', evidence: {} }, { id: 'open', status: 'failed', evidence: {} }] })
  assert.equal(result.verdict, 'FAIL')
})

test('gameplay INCONCLUSIVE khi observation thiếu', () => {
  const result = evaluateGameplayJourney({ journeyId: 'order-flow', expectedSteps: ['open', 'buy'], observedSteps: [{ id: 'open', status: 'passed', evidence: {} }] })
  assert.equal(result.verdict, 'INCONCLUSIVE')
})

test('gameplay reject credential-like journey và oversized evidence', () => {
  assert.throws(() => evaluateGameplayJourney({ journeyId: 'token-flow', expectedSteps: ['open'], observedSteps: [] }), /credential/i)
  assert.throws(() => evaluateGameplayJourney({ journeyId: 'flow', expectedSteps: ['open'], observedSteps: [{ id: 'open', status: 'passed', evidence: { payload: 'x'.repeat(9000) } }] }), /bounded|payload/i)
})

void assert
