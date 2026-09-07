import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import test from 'node:test'
import {
  buildPaperBukkitOnlinePlayerTrustStore,
  PaperBukkitOnlinePlayerVerifier
} from '../src/paper-bukkit-online-player-claim.js'
import { createPaperBukkitOnlinePlayerLoopbackClient } from '../src/paper-bukkit-online-player-loopback-client.js'
import { encodePaperBukkitOnlinePlayerRequestFrameV1 } from '../src/paper-bukkit-online-player-transport-codec.js'
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
    authorization: Object.fromEntries([
      ['id', 'approval-paper-bukkit'],
      ['scope', ['artifact-bind']]
    ]),
    artifacts: [
      { logicalId: 'candidate', role: 'candidate', logicalPath: 'plugins/LivingNPC.jar', sha256: '1'.repeat(64) },
      { logicalId: 'config', role: 'config', logicalPath: 'plugins/LivingNPC/config.yml', sha256: '2'.repeat(64) },
      { logicalId: 'paper', role: 'paper', logicalPath: 'server/paper.jar', sha256: '3'.repeat(64) },
      { logicalId: 'probe', role: 'probe', logicalPath: 'plugins/BotCheckerProbe.jar', sha256: '4'.repeat(64) }
    ]
  })
}

async function nextLine(lines: ReturnType<typeof createInterface>): Promise<string> {
  const result = await Promise.race([
    once(lines, 'line').then(value => String(value[0])),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Java lifecycle line timed out')), 5_000))
  ])
  return result
}

test('Java lifecycle compose Bukkit snapshot, opaque signer, processor và loopback response consumable', {
  skip: !javaInteropAvailable,
  timeout: 30_000
}, async t => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-lifecycle-'))
  let child: ChildProcessWithoutNullStreams | undefined
  t.after(() => {
    child?.kill()
    rmSync(workspace, { recursive: true, force: true })
  })
  const classes = path.join(workspace, 'classes')
  mkdirSync(classes)
  const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
  const fakeApiRoot = path.resolve('test/fixtures/java/paperapi')
  execFileSync('javac', ['--release', '21', '-d', classes,
    path.join(fakeApiRoot, 'org/bukkit/plugin/Plugin.java'),
    path.join(fakeApiRoot, 'org/bukkit/entity/Player.java'),
    path.join(fakeApiRoot, 'org/bukkit/scheduler/BukkitTask.java'),
    path.join(fakeApiRoot, 'org/bukkit/scheduler/BukkitScheduler.java'),
    path.join(fakeApiRoot, 'org/bukkit/Bukkit.java'),
    path.join(javaRoot, 'CanonicalPaperBukkitOnlinePlayerPayload.java'),
    path.join(javaRoot, 'PaperBukkitOnlinePlayerTransportCodec.java'),
    path.join(javaRoot, 'PaperBukkitOnlinePlayerRequestProcessor.java'),
    path.join(javaRoot, 'PaperBukkitOnlinePlayerMainThreadSnapshotBridge.java'),
    path.join(javaRoot, 'PaperBukkitOnlinePlayerBukkitSnapshotAdapter.java'),
    path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreAccess.java'),
    path.join(javaRoot, 'PaperBukkitOnlinePlayerOpaqueEd25519Signer.java'),
    path.join(javaRoot, 'PaperBukkitOnlinePlayerLoopbackListener.java'),
    path.join(javaRoot, 'PaperBukkitOnlinePlayerAdapterLifecycle.java'),
    path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerAdapterLifecycleFixture.java')], {
    cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
  })
  child = spawn('java', ['-cp', classes, 'PaperBukkitOnlinePlayerAdapterLifecycleFixture'], {
    cwd: path.resolve('.'), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
  })
  const lines = createInterface({ input: child.stdout })
  t.after(() => lines.close())
  const [publicMarker, publicKeySpkiDerBase64, keyId] = (await nextLine(lines)).split(' ')
  assert.equal(publicMarker, 'PUBLIC')
  const spki = Buffer.from(publicKeySpkiDerBase64, 'base64')
  assert.equal(spki.byteLength, 44)
  assert.equal(createHash('sha256').update(spki).digest('hex'), keyId)

  const binding = expectedBinding()
  const wall = Date.now()
  const clock = { wall, mono: 100 }
  const trustStore = buildPaperBukkitOnlinePlayerTrustStore({
    schemaVersion: 1,
    trustStoreId: 'paper-bukkit-trust',
    trustStoreVersion: '2026.09.01-1',
    keys: [{
      schemaVersion: 1,
      algorithm: 'ed25519',
      keyId,
      publicKeySpkiDerBase64,
      provider: binding.provider,
      allowedBindings: [{
        bindingId: binding.bindingId,
        targetBindingSha256: artifactTargetBindingSha256(binding)
      }],
      notBeforeMs: wall - 1_000,
      notAfterMs: wall + 60_000,
      status: 'active'
    }]
  })
  const verifier = new PaperBukkitOnlinePlayerVerifier({
    trustStore,
    audience: 'paper-bukkit-verifier',
    verifierInstanceId: 'paper-bukkit-verifier-a',
    wallNowMs: () => clock.wall,
    monotonicNowMs: () => clock.mono,
    randomBytes: size => Buffer.alloc(size, 121)
  })
  const challenge = verifier.issueChallenge({
    runId: 'paper-bukkit-run', expectedBinding: binding, keyId, ttlMs: 30_000
  })
  const request = encodePaperBukkitOnlinePlayerRequestFrameV1(challenge)
  child.stdin.write(`REQUEST ${request.toString('base64url')}\n`)
  const [readyMarker, host, portText] = (await nextLine(lines)).split(' ')
  assert.equal(readyMarker, 'READY')
  assert.equal(host, '127.0.0.1')
  const port = Number(portText)
  assert.ok(Number.isSafeInteger(port) && port > 0 && port <= 65_535)

  const client = createPaperBukkitOnlinePlayerLoopbackClient({ port, timeoutMs: 5_000 })
  const envelope = await client.request(challenge, new AbortController().signal)
  clock.wall = Date.now()
  clock.mono = 110
  const verified = verifier.verifyAndConsume(envelope)
  assert.equal(verified.onlinePlayers, 3)
  assert.equal(verified.claimedServerInstanceId, 'paper-server-a')
  assert.equal(verified.claimedBootId, 'paper-boot-a')

  child.stdin.write('CLOSE\n')
  assert.equal(await nextLine(lines), 'CLOSED 1 1 1 true')
  const [code] = await once(child, 'exit')
  assert.equal(code, 0)
})

test('Java lifecycle bind failure đóng snapshot/signer và sanitize ownership error', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-lifecycle-bind-failure-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    const fakeApiRoot = path.resolve('test/fixtures/java/paperapi')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(fakeApiRoot, 'org/bukkit/plugin/Plugin.java'),
      path.join(fakeApiRoot, 'org/bukkit/entity/Player.java'),
      path.join(fakeApiRoot, 'org/bukkit/scheduler/BukkitTask.java'),
      path.join(fakeApiRoot, 'org/bukkit/scheduler/BukkitScheduler.java'),
      path.join(fakeApiRoot, 'org/bukkit/Bukkit.java'),
      path.join(javaRoot, 'CanonicalPaperBukkitOnlinePlayerPayload.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerTransportCodec.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerRequestProcessor.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerMainThreadSnapshotBridge.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerBukkitSnapshotAdapter.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreAccess.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerOpaqueEd25519Signer.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerLoopbackListener.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerAdapterLifecycle.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerAdapterLifecycleBindFailureFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const result = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerAdapterLifecycleBindFailureFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(result,
      'PAPER_BUKKIT_LIFECYCLE_BIND_FAILED:true|PAPER_BUKKIT_SNAPSHOT_BRIDGE_CLOSED|PAPER_BUKKIT_SIGNER_CLOSED|0|0|true')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Lifecycle composition vẫn là library-only và chưa được plugin main gọi', () => {
  const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
  const lifecycle = readFileSync(path.join(javaRoot, 'PaperBukkitOnlinePlayerAdapterLifecycle.java'), 'utf8')
  const plugin = readFileSync(path.join(javaRoot, 'PaperBukkitOnlinePlayerPlugin.java'), 'utf8')
  assert.match(lifecycle, /PaperBukkitOnlinePlayerLoopbackListener\.bind/)
  assert.match(lifecycle, /closeQuietly\(listener\)/)
  assert.match(lifecycle, /closeQuietly\(snapshotAdapter\)/)
  assert.match(lifecycle, /closeQuietly\(signer\)/)
  assert.doesNotMatch(lifecycle, /KeyStore|getOnlinePlayers|System\.(?:getenv|getProperty)|JavaPlugin/)
  assert.doesNotMatch(plugin, /PaperBukkitOnlinePlayerAdapterLifecycle/)
  // 2026-09-07 (BC-001): lifecycle vẫn chỉ do RuntimeFactory mở, plugin main không gọi
  // thẳng — nhưng composition thì nay ĐƯỢC gọi, nếu không adapter là dead code.
  assert.match(plugin, /PaperBukkitOnlinePlayerExternalKeyStoreRuntimeComposition\.register\(/)
})
