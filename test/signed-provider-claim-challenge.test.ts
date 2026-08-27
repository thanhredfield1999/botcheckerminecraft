import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, type KeyObject } from 'node:crypto'
import test from 'node:test'
import {
  buildSignedProviderClaimTrustStore,
  SignedProviderClaimVerifier
} from '../src/signed-provider-claim.js'
import { artifactTargetBindingSha256, buildArtifactTargetBinding } from '../src/target-binding.js'

function trustKey(publicKey: KeyObject, targetBindingSha256: string) {
  const der = publicKey.export({ type: 'spki', format: 'der' })
  return {
    schemaVersion: 1 as const,
    algorithm: 'ed25519' as const,
    keyId: createHash('sha256').update(der).digest('hex'),
    publicKeySpkiDerBase64: der.toString('base64'),
    provider: {
      kind: 'server-probe' as const,
      id: 'livingnpc-probe',
      version: '1.0.0',
      instanceId: 'probe-key-slot-a'
    },
    allowedBindings: [{ bindingId: 'livingnpc-paper', targetBindingSha256 }],
    notBeforeMs: 1_000,
    notAfterMs: 100_000,
    status: 'active' as const
  }
}

function binding() {
  return buildArtifactTargetBinding({
    schemaVersion: 1,
    bindingId: 'livingnpc-paper',
    provider: { kind: 'filesystem-snapshot', id: 'fixture-resolver', version: '1.0.0' },
    authorization: { id: 'approval-20260827', scope: ['artifact-bind'] },
    artifacts: [
      { logicalId: 'candidate', role: 'candidate', logicalPath: 'plugins/LivingNPC.jar', sha256: '1'.repeat(64) },
      { logicalId: 'config', role: 'config', logicalPath: 'plugins/LivingNPC/config.yml', sha256: '2'.repeat(64) },
      { logicalId: 'paper', role: 'paper', logicalPath: 'server/paper.jar', sha256: '3'.repeat(64) },
      { logicalId: 'probe', role: 'probe', logicalPath: 'plugins/BotCheckerProbe.jar', sha256: '4'.repeat(64) }
    ]
  })
}

test('signed provider verifier issue challenge bind exact configured key và probe-bearing target', () => {
  const expectedBinding = binding()
  const targetBindingSha256 = artifactTargetBindingSha256(expectedBinding)
  const { publicKey } = generateKeyPairSync('ed25519')
  const key = trustKey(publicKey, targetBindingSha256)
  const trustStore = buildSignedProviderClaimTrustStore({
    schemaVersion: 1,
    trustStoreId: 'controlled-probe-trust',
    trustStoreVersion: '2026.08.27-1',
    keys: [key]
  })
  let wallNowMs = 10_000
  let monotonicNowMs = 500
  const verifier = new SignedProviderClaimVerifier({
    trustStore,
    audience: 'botchecker-offline-verifier:fixture-a',
    verifierInstanceId: 'verifier-fixture-a',
    wallNowMs: () => wallNowMs,
    monotonicNowMs: () => monotonicNowMs,
    randomBytes: size => Buffer.alloc(size, 7)
  })

  const challenge = verifier.issueChallenge({
    runId: 'fixture-run-a',
    expectedBinding,
    keyId: key.keyId,
    ttlMs: 5_000
  })

  assert.deepEqual(challenge, {
    schemaVersion: 1,
    domain: 'botcheckerminecraft.signed-provider-claim.v1',
    audience: 'botchecker-offline-verifier:fixture-a',
    verifierInstanceId: 'verifier-fixture-a',
    sequence: 1,
    challengeId: challenge.challengeId,
    nonceBase64Url: Buffer.alloc(32, 7).toString('base64url'),
    runId: 'fixture-run-a',
    keyId: key.keyId,
    bindingId: 'livingnpc-paper',
    targetBindingSha256,
    provider: key.provider,
    trustStoreId: trustStore.trustStoreId,
    trustStoreVersion: trustStore.trustStoreVersion,
    trustStoreSha256: trustStore.trustStoreSha256,
    issuedAtMs: 10_000,
    expiresAtMs: 15_000
  })
  assert.match(challenge.challengeId, /^[a-f0-9]{64}$/)
  assert.equal(Buffer.from(challenge.nonceBase64Url, 'base64url').byteLength, 32)
  assert.equal(Buffer.from(challenge.nonceBase64Url, 'base64url').toString('base64url'), challenge.nonceBase64Url)

  wallNowMs = 10_001
  monotonicNowMs = 501
  const second = verifier.issueChallenge({
    runId: 'fixture-run-b', expectedBinding, keyId: key.keyId, ttlMs: 1_000
  })
  assert.equal(second.sequence, 2)
  assert.notEqual(second.challengeId, challenge.challengeId)
})
