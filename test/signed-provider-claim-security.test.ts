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
    schemaVersion: 1, bindingId: 'security-binding',
    provider: { kind: 'filesystem-snapshot', id: 'fixture-resolver', version: '1.0.0' },
    authorization: { id: 'approval-20260827', scope: ['artifact-bind'] },
    artifacts: [
      { logicalId: 'candidate', role: 'candidate', logicalPath: 'plugins/Plugin.jar', sha256: '1'.repeat(64) },
      { logicalId: 'config', role: 'config', logicalPath: 'plugins/Plugin/config.yml', sha256: '2'.repeat(64) },
      { logicalId: 'paper', role: 'paper', logicalPath: 'server/paper.jar', sha256: '3'.repeat(64) },
      { logicalId: 'probe', role: 'probe', logicalPath: 'plugins/Probe.jar', sha256: '4'.repeat(64) }
    ]
  })
}

function keyInput(publicKey: KeyObject, bindingHash: string) {
  const der = publicKey.export({ type: 'spki', format: 'der' })
  return {
    schemaVersion: 1 as const, algorithm: 'ed25519' as const,
    keyId: createHash('sha256').update(der).digest('hex'),
    publicKeySpkiDerBase64: der.toString('base64'),
    provider: { kind: 'server-probe' as const, id: 'probe', version: '1.0.0' },
    allowedBindings: [{ bindingId: 'security-binding', targetBindingSha256: bindingHash }],
    notBeforeMs: 1_000, notAfterMs: 100_000, status: 'active' as const
  }
}

function harness(maxInvalidAttempts = 2) {
  const expectedBinding = binding()
  const hash = artifactTargetBindingSha256(expectedBinding)
  const pair = generateKeyPairSync('ed25519')
  const key = keyInput(pair.publicKey, hash)
  const store = buildSignedProviderClaimTrustStore({
    schemaVersion: 1, trustStoreId: 'security-trust', trustStoreVersion: 'v1', keys: [key]
  })
  const clock = { wall: 10_000, mono: 100 }
  const verifier = new SignedProviderClaimVerifier({
    trustStore: store, audience: 'security-verifier', verifierInstanceId: 'security-instance',
    wallNowMs: () => clock.wall, monotonicNowMs: () => clock.mono,
    randomBytes: size => Buffer.alloc(size, 11), maxInvalidAttempts
  })
  const challenge = verifier.issueChallenge({ runId: 'security-run', expectedBinding, keyId: key.keyId, ttlMs: 5_000 })
  clock.wall = 10_100
  clock.mono = 200
  const claims = {
    ...challenge, observedAtMs: 10_050,
    claimedServerInstanceId: 'claimed-paper-a', claimedBootId: 'claimed-boot-a',
    loadedArtifacts: expectedBinding.artifacts
  }
  const envelope = (privateKey: KeyObject, changedClaims: typeof claims = claims) => ({
    schemaVersion: 1 as const,
    claims: changedClaims,
    signatureBase64Url: sign(null, canonicalSignedProviderClaimV1(changedClaims), privateKey).toString('base64url')
  })
  return { expectedBinding, pair, verifier, challenge, claims, envelope, clock, store, key }
}

test('bad signature không consume lần đầu nhưng burn challenge ở attempt limit', () => {
  const h = harness(2)
  const attacker = generateKeyPairSync('ed25519')
  assert.throws(() => h.verifier.verifyAndConsume(h.envelope(attacker.privateKey)), /signature/i)
  assert.deepEqual(h.verifier.verifyAndConsume(h.envelope(h.pair.privateKey)), {
    schemaVersion: 1, signatureValid: true, configuredKeyMatch: true, claimFreshness: 'fresh',
    nonceConsumed: true, trustDecision: 'ACCEPTED_NON_RELEASE', evidenceGrade: 'artifact-bound',
    releaseEligible: false, trustStoreId: h.store.trustStoreId,
    trustStoreVersion: h.store.trustStoreVersion, trustStoreSha256: h.store.trustStoreSha256,
    keyId: h.key.keyId, runId: 'security-run', bindingId: 'security-binding',
    targetBindingSha256: artifactTargetBindingSha256(h.expectedBinding), provider: h.key.provider,
    claimedServerInstanceId: 'claimed-paper-a', claimedBootId: 'claimed-boot-a'
  })

  const burned = harness(2)
  assert.throws(() => burned.verifier.verifyAndConsume(burned.envelope(attacker.privateKey)), /signature/i)
  assert.throws(() => burned.verifier.verifyAndConsume(burned.envelope(attacker.privateKey)), /signature/i)
  assert.throws(() => burned.verifier.verifyAndConsume(burned.envelope(burned.pair.privateKey)), /challenge|consumed/i)
})

test('claim substitution, artifact omission và future observation đều fail closed mà không consume valid claim', () => {
  const h = harness()
  const omitted = { ...h.claims, loadedArtifacts: h.claims.loadedArtifacts.slice(1) }
  assert.throws(() => h.verifier.verifyAndConsume(h.envelope(h.pair.privateKey, omitted)), /artifact|candidate|binding/i)
  const future = { ...h.claims, observedAtMs: h.clock.wall + 1 }
  assert.throws(() => h.verifier.verifyAndConsume(h.envelope(h.pair.privateKey, future)), /observation|fresh|window/i)
  const wrongRun = { ...h.claims, runId: 'different-run' }
  assert.throws(() => h.verifier.verifyAndConsume(h.envelope(h.pair.privateKey, wrongRun)), /challenge|match/i)
  assert.equal(h.verifier.verifyAndConsume(h.envelope(h.pair.privateKey)).nonceConsumed, true)
})

test('signature encoding phải canonical base64url đúng 64 byte', () => {
  const h = harness()
  const valid = h.envelope(h.pair.privateKey)
  assert.throws(() => h.verifier.verifyAndConsume({
    ...valid, signatureBase64Url: `${valid.signatureBase64Url}=`
  }), /base64|canonical|signature/i)
  assert.equal(h.verifier.verifyAndConsume(valid).signatureValid, true)
})

test('public signed-claim canonicalizer reject path traversal trước crypto verifier', () => {
  const h = harness()
  const traversal = {
    ...h.claims,
    loadedArtifacts: h.claims.loadedArtifacts.map((artifact, index) => index === 0
      ? { ...artifact, logicalPath: '../Plugin.jar' }
      : artifact)
  }
  assert.throws(() => canonicalSignedProviderClaimV1(traversal), /path|traversal/i)
})
