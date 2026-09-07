import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { once } from 'node:events'
import net, { type AddressInfo } from 'node:net'
import test from 'node:test'
import {
  buildPaperBukkitOnlinePlayerTrustStore,
  canonicalPaperBukkitOnlinePlayerPayloadV1,
  PaperBukkitOnlinePlayerVerifier
} from '../src/paper-bukkit-online-player-claim.js'
import { createPaperBukkitOnlinePlayerLoopbackClient } from '../src/paper-bukkit-online-player-loopback-client.js'
import {
  decodePaperBukkitOnlinePlayerRequestFrameV1,
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
    schemaVersion: 1, trustStoreId: 'paper-bukkit-trust', trustStoreVersion: '2026.08.31-1',
    keys: [{ schemaVersion: 1, algorithm: 'ed25519', keyId,
      publicKeySpkiDerBase64: spki.toString('base64'), provider: expectedBinding.provider,
      allowedBindings: [{ bindingId: expectedBinding.bindingId, targetBindingSha256: artifactTargetBindingSha256(expectedBinding) }],
      notBeforeMs: 1_000, notAfterMs: 100_000, status: 'active' }]
  })
  const clock = { wall: 10_000, mono: 100 }
  const verifier = new PaperBukkitOnlinePlayerVerifier({
    trustStore, audience: 'paper-bukkit-verifier', verifierInstanceId: 'paper-bukkit-verifier-a',
    wallNowMs: () => clock.wall, monotonicNowMs: () => clock.mono,
    randomBytes: size => Buffer.alloc(size, 86)
  })
  const challenge = verifier.issueChallenge({ runId: 'paper-bukkit-run', expectedBinding, keyId, ttlMs: 5_000 })
  return { challenge, clock, expectedBinding, pair, verifier }
}

async function listen(server: net.Server): Promise<number> {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return (server.address() as AddressInfo).port
}

async function close(server: net.Server): Promise<void> {
  server.close()
  await once(server, 'close')
}

test('loopback client gửi one-shot request tới fixed IPv4 loopback và trả envelope consumable', async t => {
  const h = fixture()
  let remoteAddress: string | undefined
  const server = net.createServer({ allowHalfOpen: true }, socket => {
    remoteAddress = socket.remoteAddress
    const chunks: Buffer[] = []
    socket.on('data', chunk => chunks.push(Buffer.from(chunk)))
    socket.on('end', () => {
      const challenge = decodePaperBukkitOnlinePlayerRequestFrameV1(Buffer.concat(chunks))
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
      const signature = sign(null, canonicalPaperBukkitOnlinePlayerPayloadV1(payload), h.pair.privateKey)
      socket.end(encodePaperBukkitOnlinePlayerResponseFrameV1(payload, signature))
    })
  })
  t.after(() => close(server))
  const port = await listen(server)
  const client = createPaperBukkitOnlinePlayerLoopbackClient({ port, timeoutMs: 1_000 })
  const envelope = await client.request(h.challenge, new AbortController().signal)
  assert.ok(remoteAddress === '127.0.0.1' || remoteAddress === '::ffff:127.0.0.1')
  h.clock.wall = 10_010
  h.clock.mono = 110
  assert.equal(h.verifier.verifyAndConsume(envelope).onlinePlayers, 0)
})

test('loopback client reject option host do caller chèn', () => {
  assert.throws(
    () => createPaperBukkitOnlinePlayerLoopbackClient({ port: 12345, timeoutMs: 100, host: '0.0.0.0' } as never),
    /options are invalid/
  )
})

test('loopback client timeout bounded khi peer không trả response', async t => {
  const h = fixture()
  let timeoutSocket: net.Socket | undefined
  const timeoutServer = net.createServer({ allowHalfOpen: true }, socket => {
    timeoutSocket = socket
    socket.on('data', () => {})
  })
  t.after(() => {
    timeoutSocket?.destroy()
    return close(timeoutServer)
  })
  const timeoutPort = await listen(timeoutServer)
  const timeoutClient = createPaperBukkitOnlinePlayerLoopbackClient({ port: timeoutPort, timeoutMs: 20 })
  await assert.rejects(timeoutClient.request(h.challenge, new AbortController().signal), /timed out/)
})

test('loopback client abort bằng lỗi sanitize', async t => {
  const h = fixture()
  let abortSocket: net.Socket | undefined
  const abortServer = net.createServer({ allowHalfOpen: true }, socket => {
    abortSocket = socket
    socket.on('data', () => {})
  })
  t.after(() => {
    abortSocket?.destroy()
    return close(abortServer)
  })
  const abortPort = await listen(abortServer)
  const abortClient = createPaperBukkitOnlinePlayerLoopbackClient({ port: abortPort, timeoutMs: 1_000 })
  const controller = new AbortController()
  const pending = abortClient.request(h.challenge, controller.signal)
  controller.abort(new Error('operator/private/reason'))
  await assert.rejects(pending, error => error instanceof Error
    && error.message === 'Paper Bukkit loopback request cancelled'
    && !error.message.includes('private'))
})

test('loopback client reject malformed response bằng lỗi sanitize', async t => {
  const h = fixture()
  let malformedSocket: net.Socket | undefined
  const malformedServer = net.createServer(socket => {
    malformedSocket = socket
    socket.end(Buffer.from('operator/private/response'))
  })
  t.after(() => {
    malformedSocket?.destroy()
    return close(malformedServer)
  })
  const malformedPort = await listen(malformedServer)
  const malformedClient = createPaperBukkitOnlinePlayerLoopbackClient({ port: malformedPort, timeoutMs: 1_000 })
  await assert.rejects(
    malformedClient.request(h.challenge, new AbortController().signal),
    error => error instanceof Error
      && error.message === 'Paper Bukkit loopback response is invalid'
      && !error.message.includes('private')
  )
})
