import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync } from 'node:crypto'
import test from 'node:test'
import { buildSignedProviderClaimTrustStore, SignedProviderClaimVerifier } from '../src/signed-provider-claim.js'
import { artifactTargetBindingSha256, buildArtifactTargetBinding } from '../src/target-binding.js'

function fixture(maxPending = 2) {
  const expectedBinding = buildArtifactTargetBinding({
    schemaVersion: 1, bindingId: 'lifecycle-binding',
    provider: { kind: 'filesystem-snapshot', id: 'fixture-resolver', version: '1.0.0' },
    authorization: { id: 'approval-20260827', scope: ['artifact-bind'] },
    artifacts: [
      { logicalId: 'candidate', role: 'candidate', logicalPath: 'plugins/Plugin.jar', sha256: '1'.repeat(64) },
      { logicalId: 'config', role: 'config', logicalPath: 'plugins/Plugin/config.yml', sha256: '2'.repeat(64) },
      { logicalId: 'paper', role: 'paper', logicalPath: 'server/paper.jar', sha256: '3'.repeat(64) },
      { logicalId: 'probe', role: 'probe', logicalPath: 'plugins/Probe.jar', sha256: '4'.repeat(64) }
    ]
  })
  const targetBindingSha256 = artifactTargetBindingSha256(expectedBinding)
  const { publicKey } = generateKeyPairSync('ed25519')
  const der = publicKey.export({ type: 'spki', format: 'der' })
  const keyId = createHash('sha256').update(der).digest('hex')
  const trustStore = buildSignedProviderClaimTrustStore({
    schemaVersion: 1, trustStoreId: 'lifecycle-trust', trustStoreVersion: 'v1',
    keys: [{
      schemaVersion: 1, algorithm: 'ed25519', keyId,
      publicKeySpkiDerBase64: der.toString('base64'),
      provider: { kind: 'server-probe', id: 'probe', version: '1.0.0' },
      allowedBindings: [{ bindingId: 'lifecycle-binding', targetBindingSha256 }],
      notBeforeMs: 1_000, notAfterMs: 100_000, status: 'active'
    }]
  })
  const clock = { wall: 10_000, mono: 100 }
  const verifier = new SignedProviderClaimVerifier({
    trustStore, audience: 'lifecycle-verifier', verifierInstanceId: 'lifecycle-instance',
    wallNowMs: () => clock.wall, monotonicNowMs: () => clock.mono,
    randomBytes: size => Buffer.alloc(size, 12), maxPending
  })
  const issue = (runId: string, ttlMs = 1_000) => verifier.issueChallenge({
    runId, expectedBinding, keyId, ttlMs
  })
  return { verifier, clock, issue, expectedBinding }
}

test('monotonic rollback latch verifier fail-closed thay vì tự hồi phục', () => {
  const h = fixture()
  h.issue('before-rollback')
  h.clock.mono = 99
  assert.throws(() => h.issue('detect-rollback'), /monotonic.*backwards/i)
  h.clock.mono = 101
  h.clock.wall = 10_001
  assert.throws(() => h.issue('after-rollback'), /monotonic|compromised|unusable/i)
})

test('capacity reject deterministic nhưng expired challenge được prune trước capacity check', () => {
  const h = fixture(1)
  h.issue('first', 1_000)
  assert.throws(() => h.issue('full'), /capacity/i)
  h.clock.mono = 1_101
  h.clock.wall = 11_001
  assert.doesNotThrow(() => h.issue('after-expiry'))
})

test('challenge hết hạn ngay tại exact monotonic expiry và không giữ capacity', () => {
  const h = fixture(1)
  h.issue('expires-exactly', 1_000)
  h.clock.mono = 1_100
  h.clock.wall = 11_000
  assert.doesNotThrow(() => h.issue('replacement-at-expiry'))
})

test('wall-clock expiry cũng prune challenge trước capacity check', () => {
  const h = fixture(1)
  h.issue('wall-expires', 1_000)
  h.clock.wall = 11_000
  assert.doesNotThrow(() => h.issue('replacement-after-wall-expiry'))
})

test('monotonic expiry overflow bị reject thay vì tạo challenge vô hạn', () => {
  const h = fixture()
  h.clock.mono = Number.MAX_VALUE
  assert.throws(() => h.issue('overflow'), /monotonic|expiry|finite|safe/i)
})

test('challenge thuộc verifier process khác không thể verify hoặc consume', () => {
  const first = fixture()
  const second = fixture()
  const challenge = first.issue('process-a')
  assert.throws(() => second.verifier.verifyAndConsume({
    schemaVersion: 1,
    claims: {
      ...challenge, observedAtMs: challenge.issuedAtMs,
      claimedServerInstanceId: 'claimed-server', claimedBootId: 'claimed-boot',
      loadedArtifacts: first.expectedBinding.artifacts
    },
    signatureBase64Url: Buffer.alloc(64).toString('base64url')
  }), /challenge|unavailable|replay/i)
})
