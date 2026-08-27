import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateMultiClientRun } from '../src/multi-client-contract.js'

test('multi-client PASS khi client observations độc lập và đủ', () => {
  const result = evaluateMultiClientRun({ runId: 'run-1', clients: [
    { clientId: 'client-a', status: 'passed', evidence: { message: 'ok' } },
    { clientId: 'client-b', status: 'passed', evidence: { message: 'ok' } }
  ] })
  assert.equal(result.verdict, 'PASS')
})

test('multi-client FAIL khi một client fail', () => {
  const result = evaluateMultiClientRun({ runId: 'run-2', clients: [
    { clientId: 'client-a', status: 'passed', evidence: {} },
    { clientId: 'client-b', status: 'failed', evidence: {} }
  ] })
  assert.equal(result.verdict, 'FAIL')
})

test('multi-client INCONCLUSIVE khi observation thiếu hoặc skipped', () => {
  const result = evaluateMultiClientRun({ runId: 'run-3', clients: [{ clientId: 'client-a', status: 'skipped', evidence: {} }] })
  assert.equal(result.verdict, 'INCONCLUSIVE')
})

test('multi-client reject duplicate/credential-like refs', () => {
  assert.throws(() => evaluateMultiClientRun({ runId: 'run-4', clients: [{ clientId: 'client-a', status: 'passed', evidence: {} }, { clientId: 'client-a', status: 'passed', evidence: {} }] }), /duplicate/i)
  assert.throws(() => evaluateMultiClientRun({ runId: 'token-run', clients: [] }), /credential/i)
})

test('multi-client giữ FAIL ưu tiên và reject status/code mâu thuẫn', () => {
  const fail = {
    code: 'FAIL_PRODUCT' as const, phase: 'observe-client', provider: 'client',
    causeClass: 'Error', boundedDetail: 'item duplicated', artifactRefs: [],
    retryable: false, trustBoundary: 'external-provider' as const
  }
  const inconclusive = {
    code: 'INCONCLUSIVE_OBSERVER' as const, phase: 'observe-client', provider: 'client',
    causeClass: 'Error', boundedDetail: 'observer unavailable', artifactRefs: [],
    retryable: true, trustBoundary: 'external-provider' as const
  }
  const result = evaluateMultiClientRun({ runId: 'run-priority', clients: [
    { clientId: 'failed-client', status: 'failed', evidence: {}, failure: fail },
    { clientId: 'missing-client', status: 'skipped', evidence: {}, failure: inconclusive }
  ] })
  assert.equal(result.verdict, 'FAIL')
  assert.deepEqual(result.evidence.failures.map(entry => entry.failure.code), [
    'FAIL_PRODUCT', 'INCONCLUSIVE_OBSERVER'
  ])

  assert.throws(() => evaluateMultiClientRun({ runId: 'run-invalid-fail', clients: [
    { clientId: 'client-a', status: 'failed', evidence: {}, failure: inconclusive }
  ] }), /FAIL_\*/)
  assert.throws(() => evaluateMultiClientRun({ runId: 'run-invalid-skip', clients: [
    { clientId: 'client-a', status: 'skipped', evidence: {}, failure: fail }
  ] }), /INCONCLUSIVE_\*/)
})

void assert
