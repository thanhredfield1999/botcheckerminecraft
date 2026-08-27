import assert from 'node:assert/strict'
import test from 'node:test'
import { failureEnvelope, validateFailureEnvelope } from '../src/failure-envelope.js'

test('failure envelope giữ taxonomy/cause bounded nhưng redacted credential', () => {
  const cause = new Error(`observer disconnected password=super-secret ${'x'.repeat(1_000)}`)
  const envelope = failureEnvelope({
    code: 'INCONCLUSIVE_OBSERVER',
    phase: 'observe-client',
    provider: 'minecraft-client',
    error: cause,
    retryable: true,
    trustBoundary: 'external-provider',
    artifactRefs: ['client-a-provider.json']
  })

  assert.deepEqual({
    code: envelope.code,
    phase: envelope.phase,
    provider: envelope.provider,
    causeClass: envelope.causeClass,
    retryable: envelope.retryable,
    trustBoundary: envelope.trustBoundary,
    artifactRefs: envelope.artifactRefs
  }, {
    code: 'INCONCLUSIVE_OBSERVER',
    phase: 'observe-client',
    provider: 'minecraft-client',
    causeClass: 'Error',
    retryable: true,
    trustBoundary: 'external-provider',
    artifactRefs: ['client-a-provider.json']
  })
  assert.ok(envelope.boundedDetail.length <= 256)
  assert.doesNotMatch(JSON.stringify(envelope), /super-secret|password=/i)
  assert.deepEqual(validateFailureEnvelope(envelope), envelope)
})

test('failure envelope reject unknown taxonomy/path traversal/credential refs', () => {
  assert.throws(() => failureEnvelope({
    code: 'UNKNOWN' as never,
    phase: 'observe', provider: 'client', error: new Error('failed'),
    retryable: false, trustBoundary: 'external-provider'
  }), /code/i)
  assert.throws(() => failureEnvelope({
    code: 'INCONCLUSIVE_OBSERVER',
    phase: 'observe', provider: 'client', error: new Error('failed'),
    retryable: false, trustBoundary: 'external-provider', artifactRefs: ['../secret.txt']
  }), /artifact/i)
  assert.throws(() => validateFailureEnvelope({
    code: 'INCONCLUSIVE_OBSERVER', phase: 'observe', provider: 'client',
    causeClass: 'Error', boundedDetail: 'ok', artifactRefs: ['token.txt'],
    retryable: false, trustBoundary: 'external-provider'
  }), /credential/i)
})

test('failure envelope credential validation ổn định qua nhiều lần gọi', () => {
  const invalid = {
    code: 'INCONCLUSIVE_OBSERVER', phase: 'observe', provider: 'client',
    causeClass: 'Error', boundedDetail: 'api_key=should-not-pass', artifactRefs: [],
    retryable: false, trustBoundary: 'external-provider'
  }
  for (let index = 0; index < 4; index++) {
    assert.throws(() => validateFailureEnvelope(invalid), /credential/i)
  }
})
