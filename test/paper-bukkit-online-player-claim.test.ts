import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import test from 'node:test'
import {
  buildPaperBukkitOnlinePlayerTrustStore,
  canonicalPaperBukkitOnlinePlayerPayloadV1,
  PaperBukkitOnlinePlayerVerifier
} from '../src/paper-bukkit-online-player-claim.js'
import { artifactTargetBindingSha256, buildArtifactTargetBinding } from '../src/target-binding.js'

function binding() {
  return buildArtifactTargetBinding({
    schemaVersion: 1,
    bindingId: 'paper-bukkit-online-player',
    provider: {
      kind: 'server-probe', id: 'paper-bukkit-probe', version: '1.0.0', instanceId: 'adapter-a'
    },
    authorization: { id: 'approval-paper-bukkit', scope: ['artifact-bind'] },
    artifacts: [
      { logicalId: 'candidate', role: 'candidate', logicalPath: 'plugins/LivingNPC.jar', sha256: '1'.repeat(64) },
      { logicalId: 'config', role: 'config', logicalPath: 'plugins/LivingNPC/config.yml', sha256: '2'.repeat(64) },
      { logicalId: 'paper', role: 'paper', logicalPath: 'server/paper.jar', sha256: '3'.repeat(64) },
      { logicalId: 'probe', role: 'probe', logicalPath: 'plugins/BotCheckerProbe.jar', sha256: '4'.repeat(64) }
    ]
  })
}

test('Paper Bukkit online-player verifier accept exact signed payload một lần và reject replay', () => {
  const expectedBinding = binding()
  const pair = generateKeyPairSync('ed25519')
  const spki = Buffer.from(pair.publicKey.export({ type: 'spki', format: 'der' }))
  const keyId = createHash('sha256').update(spki).digest('hex')
  const trustStore = buildPaperBukkitOnlinePlayerTrustStore({
    schemaVersion: 1,
    trustStoreId: 'paper-bukkit-trust',
    trustStoreVersion: '2026.08.31-1',
    keys: [{
      schemaVersion: 1,
      algorithm: 'ed25519',
      keyId,
      publicKeySpkiDerBase64: spki.toString('base64'),
      provider: expectedBinding.provider,
      allowedBindings: [{
        bindingId: expectedBinding.bindingId,
        targetBindingSha256: artifactTargetBindingSha256(expectedBinding)
      }],
      notBeforeMs: 1_000,
      notAfterMs: 100_000,
      status: 'active'
    }]
  })
  const clock = { now: 10_000 }
  const verifier = new PaperBukkitOnlinePlayerVerifier({
    trustStore,
    audience: 'paper-bukkit-verifier',
    verifierInstanceId: 'paper-bukkit-verifier-a',
    wallNowMs: () => clock.now,
    randomBytes: size => Buffer.alloc(size, 77)
  })
  const challenge = verifier.issueChallenge({
    runId: 'paper-bukkit-run',
    expectedBinding,
    keyId,
    ttlMs: 5_000
  })
  const payload = {
    ...challenge,
    observedAtMs: 10_010,
    claimedServerInstanceId: 'paper-server-a',
    claimedBootId: 'paper-boot-a',
    onlinePlayers: 0,
    observation: {
      source: 'bukkit-getOnlinePlayers-size' as const,
      primaryThreadSnapshot: true as const,
      atomicSnapshot: false as const,
      releaseEligible: false as const
    }
  }
  const signatureBase64Url = sign(null, canonicalPaperBukkitOnlinePlayerPayloadV1(payload), pair.privateKey)
    .toString('base64url')
  const envelope = { ...payload, signatureBase64Url }

  clock.now = 10_010
  assert.throws(
    () => verifier.verifyAndConsume({ ...envelope, onlinePlayers: 1 }),
    /signature is invalid/
  )
  const accepted = verifier.verifyAndConsume(envelope)
  assert.deepEqual(accepted, {
    schemaVersion: 1,
    signatureValid: true,
    nonceConsumed: true,
    onlinePlayers: 0,
    claimedServerInstanceId: 'paper-server-a',
    claimedBootId: 'paper-boot-a',
    targetBindingSha256: artifactTargetBindingSha256(expectedBinding),
    releaseEligible: false
  })
  assert.throws(() => verifier.verifyAndConsume(envelope), /unavailable, expired, consumed, or replayed/)
})

test('Paper Bukkit online-player verifier sanitize malformed envelope', () => {
  const pair = generateKeyPairSync('ed25519')
  const spki = Buffer.from(pair.publicKey.export({ type: 'spki', format: 'der' }))
  const keyId = createHash('sha256').update(spki).digest('hex')
  const expectedBinding = binding()
  const trustStore = buildPaperBukkitOnlinePlayerTrustStore({
    schemaVersion: 1,
    trustStoreId: 'paper-bukkit-trust',
    trustStoreVersion: '2026.08.31-1',
    keys: [{
      schemaVersion: 1,
      algorithm: 'ed25519',
      keyId,
      publicKeySpkiDerBase64: spki.toString('base64'),
      provider: expectedBinding.provider,
      allowedBindings: [{ bindingId: expectedBinding.bindingId, targetBindingSha256: artifactTargetBindingSha256(expectedBinding) }],
      notBeforeMs: 1_000,
      notAfterMs: 100_000,
      status: 'active'
    }]
  })
  const verifier = new PaperBukkitOnlinePlayerVerifier({
    trustStore,
    audience: 'paper-bukkit-verifier',
    verifierInstanceId: 'paper-bukkit-verifier-a',
    wallNowMs: () => 10_000,
    randomBytes: size => Buffer.alloc(size, 78)
  })
  let thrown: unknown
  try {
    verifier.verifyAndConsume({ injected: 'operator-private-value' })
  } catch (error) {
    thrown = error
  }
  assert.ok(thrown instanceof Error)
  assert.equal(thrown.message, 'Paper Bukkit response is invalid')
  assert.doesNotMatch(thrown.message, /operator-private-value|Zod|expected|invalid_type/i)
})

test('Paper Bukkit challenge immutable và challenge hết hạn được prune trước capacity check', () => {
  const pair = generateKeyPairSync('ed25519')
  const spki = Buffer.from(pair.publicKey.export({ type: 'spki', format: 'der' }))
  const keyId = createHash('sha256').update(spki).digest('hex')
  const expectedBinding = binding()
  const trustStore = buildPaperBukkitOnlinePlayerTrustStore({
    schemaVersion: 1,
    trustStoreId: 'paper-bukkit-trust',
    trustStoreVersion: '2026.08.31-1',
    keys: [{
      schemaVersion: 1,
      algorithm: 'ed25519',
      keyId,
      publicKeySpkiDerBase64: spki.toString('base64'),
      provider: expectedBinding.provider,
      allowedBindings: [{ bindingId: expectedBinding.bindingId, targetBindingSha256: artifactTargetBindingSha256(expectedBinding) }],
      notBeforeMs: 1_000,
      notAfterMs: 100_000,
      status: 'active'
    }]
  })
  const clock = { now: 10_000 }
  const verifier = new PaperBukkitOnlinePlayerVerifier({
    trustStore,
    audience: 'paper-bukkit-verifier',
    verifierInstanceId: 'paper-bukkit-verifier-a',
    wallNowMs: () => clock.now,
    randomBytes: size => Buffer.alloc(size, clock.now === 10_000 ? 79 : 80),
    maxPending: 1
  })
  const first = verifier.issueChallenge({ runId: 'paper-bukkit-run-a', expectedBinding, keyId, ttlMs: 10 })
  assert.equal(Object.isFrozen(first), true)
  assert.equal(Object.isFrozen(first.provider), true)
  assert.throws(() => {
    ;(first as { runId: string }).runId = 'mutated-run'
  }, TypeError)

  clock.now = 10_010
  const second = verifier.issueChallenge({ runId: 'paper-bukkit-run-b', expectedBinding, keyId, ttlMs: 10 })
  assert.equal(second.sequence, 2)
  assert.notEqual(second.challengeId, first.challengeId)
})

test('Paper Bukkit verifier latch monotonic rollback và expire challenge tại exact monotonic deadline', () => {
  const pair = generateKeyPairSync('ed25519')
  const spki = Buffer.from(pair.publicKey.export({ type: 'spki', format: 'der' }))
  const keyId = createHash('sha256').update(spki).digest('hex')
  const expectedBinding = binding()
  const trustStore = buildPaperBukkitOnlinePlayerTrustStore({
    schemaVersion: 1,
    trustStoreId: 'paper-bukkit-trust',
    trustStoreVersion: '2026.08.31-1',
    keys: [{ schemaVersion: 1, algorithm: 'ed25519', keyId,
      publicKeySpkiDerBase64: spki.toString('base64'), provider: expectedBinding.provider,
      allowedBindings: [{ bindingId: expectedBinding.bindingId, targetBindingSha256: artifactTargetBindingSha256(expectedBinding) }],
      notBeforeMs: 1_000, notAfterMs: 100_000, status: 'active' }]
  })
  const clock = { wall: 10_000, mono: 100 }
  const verifier = new PaperBukkitOnlinePlayerVerifier({
    trustStore, audience: 'paper-bukkit-verifier', verifierInstanceId: 'paper-bukkit-verifier-a',
    wallNowMs: () => clock.wall, monotonicNowMs: () => clock.mono,
    randomBytes: size => Buffer.alloc(size, clock.mono === 100 ? 81 : 82), maxPending: 1
  })
  verifier.issueChallenge({ runId: 'paper-bukkit-run-a', expectedBinding, keyId, ttlMs: 10 })
  clock.mono = 110
  assert.doesNotThrow(() => verifier.issueChallenge({
    runId: 'paper-bukkit-run-b', expectedBinding, keyId, ttlMs: 10
  }))
  clock.mono = 109
  assert.throws(() => verifier.issueChallenge({
    runId: 'paper-bukkit-run-c', expectedBinding, keyId, ttlMs: 10
  }), /monotonic.*backwards/i)
  clock.mono = 111
  assert.throws(() => verifier.issueChallenge({
    runId: 'paper-bukkit-run-d', expectedBinding, keyId, ttlMs: 10
  }), /monotonic|compromised|unusable/i)
})
