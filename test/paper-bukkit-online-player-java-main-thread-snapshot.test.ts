import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { artifactTargetBindingSha256, buildArtifactTargetBinding } from '../src/target-binding.js'
import {
  buildPaperBukkitOnlinePlayerTrustStore,
  PaperBukkitOnlinePlayerVerifier
} from '../src/paper-bukkit-online-player-claim.js'
import { encodePaperBukkitOnlinePlayerRequestFrameV1 } from '../src/paper-bukkit-online-player-transport-codec.js'

const javaInteropAvailable = spawnSync('javac', ['-version'], {
  windowsHide: true,
  stdio: 'ignore'
}).status === 0 && spawnSync('java', ['-version'], {
  windowsHide: true,
  stdio: 'ignore'
}).status === 0

function challengeFixture() {
  const binding = buildArtifactTargetBinding({
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
      provider: binding.provider,
      allowedBindings: [{
        bindingId: binding.bindingId,
        targetBindingSha256: artifactTargetBindingSha256(binding)
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
    randomBytes: size => Buffer.alloc(size, 111)
  })
  return verifier.issueChallenge({
    runId: 'paper-bukkit-run', expectedBinding: binding, keyId, ttlMs: 5_000
  })
}

test('Java snapshot bridge chỉ đọc onlinePlayers trong scheduled primary-thread task', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-main-thread-snapshot-'))
  try {
    const classes = path.join(workspace, 'classes')
    const requestPath = path.join(workspace, 'request.bin')
    const outputPath = path.join(workspace, 'result.txt')
    mkdirSync(classes)
    writeFileSync(requestPath, encodePaperBukkitOnlinePlayerRequestFrameV1(challengeFixture()))
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(javaRoot, 'CanonicalPaperBukkitOnlinePlayerPayload.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerTransportCodec.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerRequestProcessor.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerMainThreadSnapshotBridge.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerMainThreadSnapshotBridgeFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerMainThreadSnapshotBridgeFixture', requestPath, outputPath], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe', timeout: 10_000
    })
    assert.equal(readFileSync(outputPath, 'utf8'), '3 10010 1 fake-paper-primary')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Java snapshot bridge close đánh thức worker, cancel task và không đọc count', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-snapshot-close-'))
  try {
    const classes = path.join(workspace, 'classes')
    const requestPath = path.join(workspace, 'request.bin')
    const outputPath = path.join(workspace, 'result.txt')
    mkdirSync(classes)
    writeFileSync(requestPath, encodePaperBukkitOnlinePlayerRequestFrameV1(challengeFixture()))
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(javaRoot, 'CanonicalPaperBukkitOnlinePlayerPayload.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerTransportCodec.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerRequestProcessor.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerMainThreadSnapshotBridge.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerMainThreadSnapshotBridgeCloseFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerMainThreadSnapshotBridgeCloseFixture', requestPath, outputPath], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe', timeout: 10_000
    })
    const [outcome, cancellations, reads, closeElapsedMs] = readFileSync(outputPath, 'utf8').split(' ')
    assert.equal(outcome, 'PAPER_BUKKIT_SNAPSHOT_BRIDGE_CLOSED')
    assert.equal(cancellations, '1')
    assert.equal(reads, '0')
    assert.ok(Number(closeElapsedMs) < 500, `close took ${closeElapsedMs} ms`)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Java snapshot bridge timeout cancel queued task và suppress late execution', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-snapshot-timeout-'))
  try {
    const classes = path.join(workspace, 'classes')
    const requestPath = path.join(workspace, 'request.bin')
    const outputPath = path.join(workspace, 'result.txt')
    mkdirSync(classes)
    writeFileSync(requestPath, encodePaperBukkitOnlinePlayerRequestFrameV1(challengeFixture()))
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(javaRoot, 'CanonicalPaperBukkitOnlinePlayerPayload.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerTransportCodec.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerRequestProcessor.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerMainThreadSnapshotBridge.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerMainThreadSnapshotBridgeTimeoutFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerMainThreadSnapshotBridgeTimeoutFixture', requestPath, outputPath], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe', timeout: 10_000
    })
    const [outcome, cancellations, reads, elapsedMs] = readFileSync(outputPath, 'utf8').split(' ')
    assert.equal(outcome, 'PAPER_BUKKIT_SNAPSHOT_TIMED_OUT')
    assert.equal(cancellations, '1')
    assert.equal(reads, '0')
    assert.ok(Number(elapsedMs) >= 25 && Number(elapsedMs) < 1_000, `timeout took ${elapsedMs} ms`)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Java snapshot bridge không cancel handle khi task hoàn tất trước schedule return', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-snapshot-sync-race-'))
  try {
    const classes = path.join(workspace, 'classes')
    const requestPath = path.join(workspace, 'request.bin')
    const outputPath = path.join(workspace, 'result.txt')
    mkdirSync(classes)
    writeFileSync(requestPath, encodePaperBukkitOnlinePlayerRequestFrameV1(challengeFixture()))
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(javaRoot, 'CanonicalPaperBukkitOnlinePlayerPayload.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerTransportCodec.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerRequestProcessor.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerMainThreadSnapshotBridge.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerMainThreadSnapshotBridgeSynchronousFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerMainThreadSnapshotBridgeSynchronousFixture', requestPath, outputPath], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe', timeout: 10_000
    })
    assert.equal(readFileSync(outputPath, 'utf8'), '1 10010 0 1')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Java snapshot bridge close trong capture đánh thức worker và suppress phần snapshot còn lại', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-snapshot-close-capture-'))
  try {
    const classes = path.join(workspace, 'classes')
    const requestPath = path.join(workspace, 'request.bin')
    const outputPath = path.join(workspace, 'result.txt')
    mkdirSync(classes)
    writeFileSync(requestPath, encodePaperBukkitOnlinePlayerRequestFrameV1(challengeFixture()))
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(javaRoot, 'CanonicalPaperBukkitOnlinePlayerPayload.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerTransportCodec.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerRequestProcessor.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerMainThreadSnapshotBridge.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerMainThreadSnapshotBridgeCloseDuringCaptureFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerMainThreadSnapshotBridgeCloseDuringCaptureFixture', requestPath, outputPath], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe', timeout: 15_000
    })
    const [outcome, cancellations, reads, clockReads, closeElapsedMs] =
      readFileSync(outputPath, 'utf8').split(' ')
    assert.equal(outcome, 'PAPER_BUKKIT_SNAPSHOT_BRIDGE_CLOSED')
    assert.equal(cancellations, '1')
    assert.equal(reads, '1')
    assert.equal(clockReads, '0')
    assert.ok(Number(closeElapsedMs) < 500, `close took ${closeElapsedMs} ms`)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Java snapshot bridge reject primary-thread wait và sanitize capture failure', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-snapshot-guards-'))
  try {
    const classes = path.join(workspace, 'classes')
    const requestPath = path.join(workspace, 'request.bin')
    mkdirSync(classes)
    writeFileSync(requestPath, encodePaperBukkitOnlinePlayerRequestFrameV1(challengeFixture()))
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(javaRoot, 'CanonicalPaperBukkitOnlinePlayerPayload.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerTransportCodec.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerRequestProcessor.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerMainThreadSnapshotBridge.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerMainThreadSnapshotBridgeGuardFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })

    const primaryOutput = path.join(workspace, 'primary.txt')
    execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerMainThreadSnapshotBridgeGuardFixture',
      'primary-caller', requestPath, primaryOutput], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe', timeout: 10_000
    })
    assert.equal(
      readFileSync(primaryOutput, 'utf8'),
      'PAPER_BUKKIT_SNAPSHOT_WAIT_ON_PRIMARY_THREAD 0 0 0 0'
    )

    const failureOutput = path.join(workspace, 'failure.txt')
    execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerMainThreadSnapshotBridgeGuardFixture',
      'capture-failure', requestPath, failureOutput], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe', timeout: 10_000
    })
    assert.equal(
      readFileSync(failureOutput, 'utf8'),
      'PAPER_BUKKIT_SNAPSHOT_CAPTURE_FAILED 1 0 1 0'
    )
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Java snapshot bridge close sau capture nhưng trước schedule return vẫn suppress kết quả', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-snapshot-close-after-capture-'))
  try {
    const classes = path.join(workspace, 'classes')
    const requestPath = path.join(workspace, 'request.bin')
    const outputPath = path.join(workspace, 'result.txt')
    mkdirSync(classes)
    writeFileSync(requestPath, encodePaperBukkitOnlinePlayerRequestFrameV1(challengeFixture()))
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(javaRoot, 'CanonicalPaperBukkitOnlinePlayerPayload.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerTransportCodec.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerRequestProcessor.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerMainThreadSnapshotBridge.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerMainThreadSnapshotBridgeCloseAfterCaptureFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerMainThreadSnapshotBridgeCloseAfterCaptureFixture', requestPath, outputPath], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe', timeout: 15_000
    })
    const [outcome, cancellations, reads, clockReads, closeElapsedMs] =
      readFileSync(outputPath, 'utf8').split(' ')
    assert.equal(outcome, 'PAPER_BUKKIT_SNAPSHOT_BRIDGE_CLOSED')
    assert.equal(cancellations, '1')
    assert.equal(reads, '1')
    assert.equal(clockReads, '1')
    assert.ok(Number(closeElapsedMs) < 500, `close took ${closeElapsedMs} ms`)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
