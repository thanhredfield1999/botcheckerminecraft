import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import test from 'node:test'
import {
  buildPaperBukkitOnlinePlayerTrustStore,
  canonicalPaperBukkitOnlinePlayerPayloadV1,
  PaperBukkitOnlinePlayerVerifier
} from '../src/paper-bukkit-online-player-claim.js'
import {
  decodePaperBukkitOnlinePlayerRequestFrameV1,
  decodePaperBukkitOnlinePlayerResponseFrameV1,
  encodePaperBukkitOnlinePlayerRequestFrameV1,
  encodePaperBukkitOnlinePlayerResponseFrameV1
} from '../src/paper-bukkit-online-player-transport-codec.js'
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
  const clock = { wall: 10_000, mono: 100 }
  const verifier = new PaperBukkitOnlinePlayerVerifier({
    trustStore,
    audience: 'paper-bukkit-verifier',
    verifierInstanceId: 'paper-bukkit-verifier-a',
    wallNowMs: () => clock.wall,
    monotonicNowMs: () => clock.mono,
    randomBytes: size => Buffer.alloc(size, 83)
  })
  const challenge = verifier.issueChallenge({
    runId: 'paper-bukkit-run', expectedBinding, keyId, ttlMs: 5_000
  })
  return { challenge, clock, expectedBinding, pair, verifier }
}

test('transport codec round-trip exact challenge và signed response consumable một lần', () => {
  const h = fixture()
  const requestFrame = encodePaperBukkitOnlinePlayerRequestFrameV1(h.challenge)
  assert.equal(requestFrame.subarray(0, 4).toString('ascii'), 'BCPQ')
  assert.equal(requestFrame.readUInt16BE(9), Buffer.byteLength(h.challenge.audience, 'utf8'))
  assert.notEqual(requestFrame[9], '{'.charCodeAt(0))
  const decodedChallenge = decodePaperBukkitOnlinePlayerRequestFrameV1(requestFrame)
  assert.deepEqual(decodedChallenge, h.challenge)
  assert.equal(Object.isFrozen(decodedChallenge), true)
  assert.equal(Object.isFrozen(decodedChallenge.provider), true)

  const payload = {
    ...decodedChallenge,
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
  const signature = sign(null, canonicalPaperBukkitOnlinePlayerPayloadV1(payload), h.pair.privateKey)
  const responseFrame = encodePaperBukkitOnlinePlayerResponseFrameV1(payload, signature)
  assert.equal(responseFrame.subarray(0, 4).toString('ascii'), 'BCPR')
  const envelope = decodePaperBukkitOnlinePlayerResponseFrameV1(responseFrame)
  h.clock.wall = 10_010
  h.clock.mono = 110
  assert.deepEqual(h.verifier.verifyAndConsume(envelope), {
    schemaVersion: 1,
    signatureValid: true,
    nonceConsumed: true,
    onlinePlayers: 0,
    claimedServerInstanceId: 'paper-server-a',
    claimedBootId: 'paper-boot-a',
    targetBindingSha256: artifactTargetBindingSha256(h.expectedBinding),
    releaseEligible: false
  })
})

test('transport codec reject malformed, trailing, truncated, oversized và hostile bytes', () => {
  const h = fixture()
  const request = encodePaperBukkitOnlinePlayerRequestFrameV1(h.challenge)
  assert.throws(() => decodePaperBukkitOnlinePlayerRequestFrameV1(Buffer.concat([request, Buffer.from([0])])),
    /request frame is invalid/)
  assert.throws(() => decodePaperBukkitOnlinePlayerRequestFrameV1(request.subarray(0, request.length - 1)),
    /request frame is invalid/)
  const wrongMagic = Buffer.from(request)
  wrongMagic[0] ^= 0xff
  assert.throws(() => decodePaperBukkitOnlinePlayerRequestFrameV1(wrongMagic), /request frame is invalid/)
  assert.throws(() => decodePaperBukkitOnlinePlayerRequestFrameV1(Buffer.alloc(4 * 1024 + 1)),
    /request frame is invalid/)

  const payload = {
    ...h.challenge,
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
  assert.throws(() => encodePaperBukkitOnlinePlayerResponseFrameV1(payload, Buffer.alloc(63)),
    /response frame is invalid/)
  const response = encodePaperBukkitOnlinePlayerResponseFrameV1(payload, Buffer.alloc(64))
  assert.throws(() => decodePaperBukkitOnlinePlayerResponseFrameV1(Buffer.concat([response, Buffer.from([0])])),
    /response frame is invalid/)
  assert.throws(() => decodePaperBukkitOnlinePlayerResponseFrameV1(Buffer.alloc(16 * 1024 + 81)),
    /response frame is invalid/)

  const hostile = new Proxy(new Uint8Array([1, 2, 3]), {
    get(target, property, receiver) {
      if (property === 'byteLength') throw new Error('operator/private/key-path')
      return Reflect.get(target, property, receiver)
    }
  })
  assert.throws(
    () => decodePaperBukkitOnlinePlayerRequestFrameV1(hostile),
    error => error instanceof Error
      && error.message === 'Paper Bukkit request frame is invalid'
      && !error.message.includes('private')
  )
})
