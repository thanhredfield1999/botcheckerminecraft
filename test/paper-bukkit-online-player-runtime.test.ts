import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import test from 'node:test'
import {
  buildPaperBukkitOnlinePlayerTrustStore,
  canonicalPaperBukkitOnlinePlayerPayloadV1
} from '../src/paper-bukkit-online-player-claim.js'
import { createPaperBukkitOnlinePlayerVerifiedOnlinePlayerSource } from '../src/paper-bukkit-online-player-runtime.js'
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

  /** Adapter giả: ký đúng challenge nhận được, như Java adapter thật sẽ làm. */
  const adapterClient = (onlinePlayers: number) => ({
    request: async (challenge: Record<string, unknown>) => {
      clock.now = 10_010
      const payload = {
        ...challenge,
        observedAtMs: 10_005,
        claimedServerInstanceId: 'paper-server-a',
        claimedBootId: 'boot-deadbeef',
        onlinePlayers,
        observation: {
          source: 'bukkit-getOnlinePlayers-size' as const,
          primaryThreadSnapshot: true as const,
          atomicSnapshot: false as const,
          releaseEligible: false as const
        }
      }
      return {
        ...payload,
        signatureBase64Url: sign(
          null, canonicalPaperBukkitOnlinePlayerPayloadV1(payload), pair.privateKey
        ).toString('base64url')
      }
    }
  })

  return { expectedBinding, keyId, trustStore, clock, adapterClient }
}

test('composition đi trọn challenge → loopback → verify → consume', async () => {
  const { expectedBinding, keyId, trustStore, clock, adapterClient } = fixture()

  const source = createPaperBukkitOnlinePlayerVerifiedOnlinePlayerSource({
    trustStore,
    audience: 'paper-bukkit-verifier',
    verifierInstanceId: 'paper-bukkit-verifier-a',
    keyId,
    targetBinding: expectedBinding,
    challengeTtlMs: 5_000,
    loopbackClient: adapterClient(7) as never,
    wallNowMs: () => clock.now,
    randomBytes: size => Buffer.alloc(size, 77)
  })

  const observed = await source.observe('paper-bukkit-run', AbortSignal.timeout(5_000))

  assert.equal(observed.onlinePlayers, 7)
  assert.equal(observed.signatureVerified, true)
  assert.equal(observed.nonceConsumed, true)
  assert.equal(observed.claimedBootId, 'boot-deadbeef')
  assert.equal(observed.targetBindingSha256, artifactTargetBindingSha256(expectedBinding))
  // Không được overclaim: đây vẫn chưa phải bằng chứng release.
  assert.equal(observed.releaseEligible, false)
})

test('adapter trả claim cho challenge khác thì composition từ chối', async () => {
  const { expectedBinding, keyId, trustStore, clock } = fixture()
  const other = fixture()

  const source = createPaperBukkitOnlinePlayerVerifiedOnlinePlayerSource({
    trustStore,
    audience: 'paper-bukkit-verifier',
    verifierInstanceId: 'paper-bukkit-verifier-a',
    keyId,
    targetBinding: expectedBinding,
    challengeTtlMs: 5_000,
    // Client ký bằng khoá KHÁC — mô phỏng adapter giả mạo hoặc key sai.
    loopbackClient: other.adapterClient(3) as never,
    wallNowMs: () => clock.now,
    randomBytes: size => Buffer.alloc(size, 77)
  })

  await assert.rejects(
    source.observe('paper-bukkit-run', AbortSignal.timeout(5_000)),
    /Paper Bukkit online-player observation failed/
  )
})

test('scalar đã verify mới được dùng làm preflight fact, không nhận caller-supplied', async () => {
  const { expectedBinding, keyId, trustStore, clock, adapterClient } = fixture()

  const source = createPaperBukkitOnlinePlayerVerifiedOnlinePlayerSource({
    trustStore,
    audience: 'paper-bukkit-verifier',
    verifierInstanceId: 'paper-bukkit-verifier-a',
    keyId,
    targetBinding: expectedBinding,
    challengeTtlMs: 5_000,
    loopbackClient: adapterClient(0) as never,
    wallNowMs: () => clock.now,
    randomBytes: size => Buffer.alloc(size, 77)
  })

  const observed = await source.observe('paper-bukkit-run', AbortSignal.timeout(5_000))
  const facts = source.toPreflightFacts(observed, {
    schemaVersion: 1,
    authorizationId: 'approval-paper-bukkit',
    requiredScope: ['artifact-bind']
  })

  assert.equal(facts.onlinePlayers, 0, 'phải lấy từ claim đã verify')
  assert.equal(facts.onlinePlayersFactSource, 'verified-signed-claim',
    'phải ghi rõ nguồn để reviewer phân biệt với caller-supplied')

  // Caller không được tự bơm onlinePlayers vào.
  assert.throws(
    () => source.toPreflightFacts(observed, {
      schemaVersion: 1,
      authorizationId: 'approval-paper-bukkit',
      requiredScope: ['artifact-bind'],
      onlinePlayers: 999
    } as never),
    /caller-supplied online-player fact is not allowed/
  )
})
