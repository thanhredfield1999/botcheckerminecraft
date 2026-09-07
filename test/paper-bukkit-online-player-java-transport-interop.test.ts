import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildPaperBukkitOnlinePlayerTrustStore,
  PaperBukkitOnlinePlayerVerifier
} from '../src/paper-bukkit-online-player-claim.js'
import {
  decodePaperBukkitOnlinePlayerResponseFrameV1,
  encodePaperBukkitOnlinePlayerRequestFrameV1
} from '../src/paper-bukkit-online-player-transport-codec.js'
import { artifactTargetBindingSha256, buildArtifactTargetBinding } from '../src/target-binding.js'

const javaInteropAvailable = spawnSync('javac', ['--release', '21', '-version'], {
  encoding: 'utf8', windowsHide: true
}).status === 0

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

test('Java transport codec decode Node request và encode response frame đúng contract', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-transport-'))
  try {
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
    const verifier = new PaperBukkitOnlinePlayerVerifier({
      trustStore,
      audience: 'paper-bukkit-verifier',
      verifierInstanceId: 'paper-bukkit-verifier-a',
      wallNowMs: () => 10_000,
      monotonicNowMs: () => 100,
      randomBytes: size => Buffer.alloc(size, 84)
    })
    const challenge = verifier.issueChallenge({
      runId: 'paper-bukkit-run', expectedBinding, keyId, ttlMs: 5_000
    })
    const requestPath = path.join(workspace, 'request.bin')
    const signaturePath = path.join(workspace, 'signature.bin')
    const responsePath = path.join(workspace, 'response.bin')
    const classesPath = path.join(workspace, 'classes')
    mkdirSync(classesPath)
    writeFileSync(requestPath, encodePaperBukkitOnlinePlayerRequestFrameV1(challenge))
    writeFileSync(signaturePath, Buffer.alloc(64, 0x5a))

    const canonicalizer = path.resolve(
      'paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter/CanonicalPaperBukkitOnlinePlayerPayload.java'
    )
    const codec = path.resolve(
      'paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter/PaperBukkitOnlinePlayerTransportCodec.java'
    )
    const fixture = path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerTransportInteropFixture.java')
    execFileSync('javac', ['--release', '21', '-d', classesPath, canonicalizer, codec, fixture], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    execFileSync('java', ['-cp', classesPath,
      'PaperBukkitOnlinePlayerTransportInteropFixture', requestPath, signaturePath, responsePath], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })

    const envelope = decodePaperBukkitOnlinePlayerResponseFrameV1(readFileSync(responsePath))
    assert.equal(envelope.challengeId, challenge.challengeId)
    assert.equal(envelope.nonceBase64Url, challenge.nonceBase64Url)
    assert.equal(envelope.targetBindingSha256, challenge.targetBindingSha256)
    assert.deepEqual(envelope.provider, challenge.provider)
    assert.equal(envelope.onlinePlayers, 0)
    assert.equal(envelope.observedAtMs, 10_010)
    assert.equal(envelope.signatureBase64Url, Buffer.alloc(64, 0x5a).toString('base64url'))
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
