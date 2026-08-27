import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import test from 'node:test'
import {
  buildSignedProviderClaimTrustStore,
  canonicalSignedProviderClaimV1,
  SignedProviderClaimVerifier
} from '../src/signed-provider-claim.js'
import { artifactTargetBindingSha256, buildArtifactTargetBinding } from '../src/target-binding.js'

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

test('signed provider claim verify signature rồi consume nonce đúng một lần nhưng không nâng evidence grade', () => {
  const expectedBinding = binding()
  const targetBindingSha256 = artifactTargetBindingSha256(expectedBinding)
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
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
    randomBytes: size => Buffer.alloc(size, 9)
  })
  const challenge = verifier.issueChallenge({
    runId: 'fixture-run-a', expectedBinding, keyId: key.keyId, ttlMs: 5_000
  })
  wallNowMs = 10_100
  monotonicNowMs = 600
  const claims = {
    ...challenge,
    observedAtMs: 10_050,
    claimedServerInstanceId: 'paper-fixture-a',
    claimedBootId: 'boot-fixture-a',
    loadedArtifacts: [...expectedBinding.artifacts].reverse()
  }
  const signatureBase64Url = sign(
    null,
    canonicalSignedProviderClaimV1(claims),
    privateKey
  ).toString('base64url')
  const envelope = { schemaVersion: 1 as const, claims, signatureBase64Url }

  assert.deepEqual(verifier.verifyAndConsume(envelope), {
    schemaVersion: 1,
    signatureValid: true,
    configuredKeyMatch: true,
    claimFreshness: 'fresh',
    nonceConsumed: true,
    trustDecision: 'ACCEPTED_NON_RELEASE',
    evidenceGrade: 'artifact-bound',
    releaseEligible: false,
    trustStoreId: trustStore.trustStoreId,
    trustStoreVersion: trustStore.trustStoreVersion,
    trustStoreSha256: trustStore.trustStoreSha256,
    keyId: key.keyId,
    runId: 'fixture-run-a',
    bindingId: 'livingnpc-paper',
    targetBindingSha256,
    provider: key.provider,
    claimedServerInstanceId: 'paper-fixture-a',
    claimedBootId: 'boot-fixture-a'
  })
  assert.throws(() => verifier.verifyAndConsume(envelope), /challenge|replay|consumed/i)
})
