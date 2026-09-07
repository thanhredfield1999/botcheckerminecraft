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

function expectedBinding() {
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

test('Java processor cache exact duplicate response và chỉ snapshot/ký một lần', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-processor-'))
  try {
    const binding = expectedBinding()
    const pair = generateKeyPairSync('ed25519')
    const spki = Buffer.from(pair.publicKey.export({ type: 'spki', format: 'der' }))
    const keyId = createHash('sha256').update(spki).digest('hex')
    const trustStore = buildPaperBukkitOnlinePlayerTrustStore({
      schemaVersion: 1, trustStoreId: 'paper-bukkit-trust', trustStoreVersion: '2026.08.31-1',
      keys: [{ schemaVersion: 1, algorithm: 'ed25519', keyId,
        publicKeySpkiDerBase64: spki.toString('base64'), provider: binding.provider,
        allowedBindings: [{ bindingId: binding.bindingId, targetBindingSha256: artifactTargetBindingSha256(binding) }],
        notBeforeMs: 1_000, notAfterMs: 100_000, status: 'active' }]
    })
    const clock = { wall: 10_000, mono: 100 }
    const verifier = new PaperBukkitOnlinePlayerVerifier({
      trustStore, audience: 'paper-bukkit-verifier', verifierInstanceId: 'paper-bukkit-verifier-a',
      wallNowMs: () => clock.wall, monotonicNowMs: () => clock.mono,
      randomBytes: size => Buffer.alloc(size, 85)
    })
    const challenge = verifier.issueChallenge({ runId: 'paper-bukkit-run', expectedBinding: binding, keyId, ttlMs: 5_000 })
    const requestPath = path.join(workspace, 'request.bin')
    const privateKeyPath = path.join(workspace, 'private-key.pkcs8')
    const responseAPath = path.join(workspace, 'response-a.bin')
    const responseBPath = path.join(workspace, 'response-b.bin')
    const countersPath = path.join(workspace, 'counters.txt')
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    writeFileSync(requestPath, encodePaperBukkitOnlinePlayerRequestFrameV1(challenge))
    writeFileSync(privateKeyPath, pair.privateKey.export({ type: 'pkcs8', format: 'der' }), { mode: 0o600 })

    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    const sources = [
      path.join(javaRoot, 'CanonicalPaperBukkitOnlinePlayerPayload.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerTransportCodec.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerRequestProcessor.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerProcessorFixture.java')
    ]
    execFileSync('javac', ['--release', '21', '-d', classes, ...sources], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    execFileSync('java', ['-cp', classes, 'PaperBukkitOnlinePlayerProcessorFixture',
      requestPath, privateKeyPath, responseAPath, responseBPath, countersPath], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })

    const responseA = readFileSync(responseAPath)
    const responseB = readFileSync(responseBPath)
    assert.deepEqual(responseB, responseA)
    assert.equal(readFileSync(countersPath, 'utf8'), '1 1')
    const envelope = decodePaperBukkitOnlinePlayerResponseFrameV1(responseA)
    clock.wall = 10_010
    clock.mono = 110
    assert.equal(verifier.verifyAndConsume(envelope).onlinePlayers, 0)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Java processor suppress response nếu close xảy ra trong snapshot', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-processor-close-'))
  try {
    const binding = expectedBinding()
    const pair = generateKeyPairSync('ed25519')
    const spki = Buffer.from(pair.publicKey.export({ type: 'spki', format: 'der' }))
    const keyId = createHash('sha256').update(spki).digest('hex')
    const trustStore = buildPaperBukkitOnlinePlayerTrustStore({
      schemaVersion: 1, trustStoreId: 'paper-bukkit-trust', trustStoreVersion: '2026.08.31-1',
      keys: [{ schemaVersion: 1, algorithm: 'ed25519', keyId,
        publicKeySpkiDerBase64: spki.toString('base64'), provider: binding.provider,
        allowedBindings: [{ bindingId: binding.bindingId, targetBindingSha256: artifactTargetBindingSha256(binding) }],
        notBeforeMs: 1_000, notAfterMs: 100_000, status: 'active' }]
    })
    const verifier = new PaperBukkitOnlinePlayerVerifier({
      trustStore, audience: 'paper-bukkit-verifier', verifierInstanceId: 'paper-bukkit-verifier-a',
      wallNowMs: () => 10_000, monotonicNowMs: () => 100,
      randomBytes: size => Buffer.alloc(size, 87)
    })
    const challenge = verifier.issueChallenge({ runId: 'paper-bukkit-run', expectedBinding: binding, keyId, ttlMs: 5_000 })
    const requestPath = path.join(workspace, 'request.bin')
    const outputPath = path.join(workspace, 'outcome.txt')
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    writeFileSync(requestPath, encodePaperBukkitOnlinePlayerRequestFrameV1(challenge))
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(javaRoot, 'CanonicalPaperBukkitOnlinePlayerPayload.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerTransportCodec.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerRequestProcessor.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerProcessorCloseFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    execFileSync('java', ['-cp', classes, 'PaperBukkitOnlinePlayerProcessorCloseFixture', requestPath, outputPath], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    assert.equal(readFileSync(outputPath, 'utf8'), 'PAPER_BUKKIT_PROCESSOR_CLOSED 1 0')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Java processor concurrent close không chờ snapshot và không cho signer chạy', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-processor-concurrent-close-'))
  try {
    const binding = expectedBinding()
    const pair = generateKeyPairSync('ed25519')
    const spki = Buffer.from(pair.publicKey.export({ type: 'spki', format: 'der' }))
    const keyId = createHash('sha256').update(spki).digest('hex')
    const trustStore = buildPaperBukkitOnlinePlayerTrustStore({
      schemaVersion: 1, trustStoreId: 'paper-bukkit-trust', trustStoreVersion: '2026.08.31-1',
      keys: [{ schemaVersion: 1, algorithm: 'ed25519', keyId,
        publicKeySpkiDerBase64: spki.toString('base64'), provider: binding.provider,
        allowedBindings: [{ bindingId: binding.bindingId, targetBindingSha256: artifactTargetBindingSha256(binding) }],
        notBeforeMs: 1_000, notAfterMs: 100_000, status: 'active' }]
    })
    const verifier = new PaperBukkitOnlinePlayerVerifier({
      trustStore, audience: 'paper-bukkit-verifier', verifierInstanceId: 'paper-bukkit-verifier-a',
      wallNowMs: () => 10_000, monotonicNowMs: () => 100,
      randomBytes: size => Buffer.alloc(size, 88)
    })
    const challenge = verifier.issueChallenge({ runId: 'paper-bukkit-run', expectedBinding: binding, keyId, ttlMs: 5_000 })
    const requestPath = path.join(workspace, 'request.bin')
    const outputPath = path.join(workspace, 'outcome.txt')
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    writeFileSync(requestPath, encodePaperBukkitOnlinePlayerRequestFrameV1(challenge))
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(javaRoot, 'CanonicalPaperBukkitOnlinePlayerPayload.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerTransportCodec.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerRequestProcessor.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerProcessorConcurrentCloseFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    execFileSync('java', ['-cp', classes, 'PaperBukkitOnlinePlayerProcessorConcurrentCloseFixture', requestPath, outputPath], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe', timeout: 15_000
    })
    const [outcome, signatures, closeElapsedMs] = readFileSync(outputPath, 'utf8').split(' ')
    assert.equal(outcome, 'PAPER_BUKKIT_PROCESSOR_CLOSED')
    assert.equal(signatures, '0')
    assert.ok(Number(closeElapsedMs) < 500, `close took ${closeElapsedMs} ms`)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Java processor reject frame đổi nonce nhưng giữ challengeId trước khi snapshot hoặc ký lại', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-processor-conflict-'))
  try {
    const binding = expectedBinding()
    const pair = generateKeyPairSync('ed25519')
    const spki = Buffer.from(pair.publicKey.export({ type: 'spki', format: 'der' }))
    const keyId = createHash('sha256').update(spki).digest('hex')
    const trustStore = buildPaperBukkitOnlinePlayerTrustStore({
      schemaVersion: 1, trustStoreId: 'paper-bukkit-trust', trustStoreVersion: '2026.08.31-1',
      keys: [{ schemaVersion: 1, algorithm: 'ed25519', keyId,
        publicKeySpkiDerBase64: spki.toString('base64'), provider: binding.provider,
        allowedBindings: [{ bindingId: binding.bindingId, targetBindingSha256: artifactTargetBindingSha256(binding) }],
        notBeforeMs: 1_000, notAfterMs: 100_000, status: 'active' }]
    })
    const verifier = new PaperBukkitOnlinePlayerVerifier({
      trustStore, audience: 'paper-bukkit-verifier', verifierInstanceId: 'paper-bukkit-verifier-a',
      wallNowMs: () => 10_000, monotonicNowMs: () => 100,
      randomBytes: size => Buffer.alloc(size, 85)
    })
    const challenge = verifier.issueChallenge({
      runId: 'paper-bukkit-run', expectedBinding: binding, keyId, ttlMs: 5_000
    })
    const requestA = encodePaperBukkitOnlinePlayerRequestFrameV1(challenge)
    const requestB = Buffer.from(requestA)
    const nonceBytes = Buffer.from(challenge.nonceBase64Url, 'utf8')
    const conflictingNonce = Buffer.alloc(32, 86).toString('base64url')
    assert.equal(conflictingNonce.length, challenge.nonceBase64Url.length)
    const nonceOffset = requestB.indexOf(nonceBytes)
    assert.ok(nonceOffset >= 9)
    assert.equal(requestB.indexOf(nonceBytes, nonceOffset + 1), -1)
    requestB.write(conflictingNonce, nonceOffset, 'utf8')
    const requestAPath = path.join(workspace, 'request-a.bin')
    const requestBPath = path.join(workspace, 'request-b.bin')
    const outcomePath = path.join(workspace, 'outcome.txt')
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    writeFileSync(requestAPath, requestA)
    writeFileSync(requestBPath, requestB)
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(javaRoot, 'CanonicalPaperBukkitOnlinePlayerPayload.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerTransportCodec.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerRequestProcessor.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerProcessorConflictFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    execFileSync('java', ['-cp', classes, 'PaperBukkitOnlinePlayerProcessorConflictFixture',
      requestAPath, requestBPath, outcomePath], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    assert.equal(readFileSync(outcomePath, 'utf8'), 'PAPER_BUKKIT_REQUEST_FRAME_INVALID 1 1')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
