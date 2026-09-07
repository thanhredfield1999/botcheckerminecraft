import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import test from 'node:test'
import {
  buildPaperBukkitOnlinePlayerTrustStore,
  canonicalPaperBukkitOnlinePlayerPayloadV1,
  PaperBukkitOnlinePlayerVerifier
} from '../src/paper-bukkit-online-player-claim.js'
import { artifactTargetBindingSha256, buildArtifactTargetBinding } from '../src/target-binding.js'

function fixture() {
  const expectedBinding = buildArtifactTargetBinding({
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
  const pair = generateKeyPairSync('ed25519')
  const spki = Buffer.from(pair.publicKey.export({ type: 'spki', format: 'der' }))
  const keyId = createHash('sha256').update(spki).digest('hex')
  const trustStore = buildPaperBukkitOnlinePlayerTrustStore({
    schemaVersion: 1,
    trustStoreId: 'paper-bukkit-trust',
    trustStoreVersion: '2026.09.07-1',
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
    runId: 'paper-bukkit-run', expectedBinding, keyId, ttlMs: 5_000
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
  const signatureBase64Url = sign(
    null, canonicalPaperBukkitOnlinePlayerPayloadV1(payload), pair.privateKey).toString('base64url')
  clock.now = 10_010
  return { verifier, envelope: { ...payload, signatureBase64Url } }
}

test('vài lần chữ ký sai vẫn cho retry: contract cũ được giữ nguyên', () => {
  const { verifier, envelope } = fixture()

  // Bốn lần thất bại — dưới ngưỡng 5.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    assert.throws(
      () => verifier.verifyAndConsume({ ...envelope, onlinePlayers: 1 }),
      /signature is invalid/
    )
  }

  const accepted = verifier.verifyAndConsume(envelope)
  assert.equal(accepted.signatureValid, true)
  assert.equal(accepted.nonceConsumed, true)
})

test('chạm ngưỡng thất bại thì nonce bị burn, envelope hợp lệ cũng bị từ chối', () => {
  const { verifier, envelope } = fixture()

  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.throws(
      () => verifier.verifyAndConsume({ ...envelope, onlinePlayers: 1 }),
      /signature is invalid/
    )
  }

  assert.throws(
    () => verifier.verifyAndConsume(envelope),
    /unavailable, expired, consumed, or replayed/,
    'sau ngưỡng, challenge phải bị burn — buộc xin challenge mới'
  )
})

test('mismatch challenge cũng tính vào ngưỡng, không chỉ lỗi chữ ký', () => {
  const { verifier, envelope } = fixture()

  // observedAtMs ngoài cửa sổ: nhánh mismatch, không phải nhánh signature.
  const mismatched = { ...envelope, observedAtMs: 99_999 }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.throws(() => verifier.verifyAndConsume(mismatched), /does not match active challenge/)
  }

  assert.throws(
    () => verifier.verifyAndConsume(envelope),
    /unavailable, expired, consumed, or replayed/,
    'mismatch lặp lại cũng phải burn, nếu không attacker chỉ cần đổi nhánh để né'
  )
})
