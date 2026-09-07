import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
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

const fakeApiFiles = [
  'org/bukkit/plugin/Plugin.java',
  'org/bukkit/plugin/ServicePriority.java',
  'org/bukkit/plugin/RegisteredServiceProvider.java',
  'org/bukkit/plugin/ServicesManager.java',
  'org/bukkit/entity/Player.java',
  'org/bukkit/scheduler/BukkitTask.java',
  'org/bukkit/scheduler/BukkitScheduler.java',
  'org/bukkit/Bukkit.java'
]
const productionFiles = [
  'CanonicalPaperBukkitOnlinePlayerPayload.java',
  'PaperBukkitOnlinePlayerTransportCodec.java',
  'PaperBukkitOnlinePlayerRequestProcessor.java',
  'PaperBukkitOnlinePlayerMainThreadSnapshotBridge.java',
  'PaperBukkitOnlinePlayerBukkitSnapshotAdapter.java',
  'PaperBukkitOnlinePlayerExternalKeyStoreAccess.java',
  'PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.java',
  'PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.java',
  'PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator.java',
  'PaperBukkitOnlinePlayerOpaqueEd25519Signer.java',
  'PaperBukkitOnlinePlayerLoopbackListener.java',
  'PaperBukkitOnlinePlayerAdapterLifecycle.java',
  'PaperBukkitOnlinePlayerAdapterRuntimeFactory.java'
]

function expectedBinding() {
  return buildArtifactTargetBinding({
    schemaVersion: 1,
    bindingId: 'paper-bukkit-online-player',
    provider: {
      kind: 'server-probe', id: 'paper-bukkit-probe', version: '1.0.0', instanceId: 'adapter-factory'
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
  return await Promise.race([
    once(lines, 'line').then(value => String(value[0])),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Java runtime factory line timed out')), 5_000))
  ])
}

test('concrete runtime factory compose opaque lease thành signed fixed-port loopback lifecycle', {
  skip: !javaInteropAvailable,
  timeout: 30_000
}, async t => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-runtime-factory-'))
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
    ...fakeApiFiles.map(file => path.join(fakeApiRoot, file)),
    ...productionFiles.map(file => path.join(javaRoot, file)),
    path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerAdapterRuntimeFactoryFixture.java')], {
    cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
  })
  child = spawn('java', ['-cp', classes, 'PaperBukkitOnlinePlayerAdapterRuntimeFactoryFixture'], {
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
    verifierInstanceId: 'paper-bukkit-verifier-factory',
    wallNowMs: () => clock.wall,
    monotonicNowMs: () => clock.mono,
    randomBytes: size => Buffer.alloc(size, 123)
  })
  const challenge = verifier.issueChallenge({
    runId: 'paper-bukkit-runtime-factory', expectedBinding: binding, keyId, ttlMs: 30_000
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
  assert.equal(verified.onlinePlayers, 4)
  assert.equal(verified.claimedServerInstanceId, 'paper-server-factory')
  assert.equal(verified.claimedBootId, 'paper-boot-factory')

  child.stdin.write('CLOSE\n')
  assert.equal(await nextLine(lines), 'CLOSED 1 1 1 true')
  const [code] = await once(child, 'exit')
  assert.equal(code, 0)
})

test('runtime factory từ chối toàn bộ static options ngoài bound trước activation', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-runtime-options-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    const fakeApiRoot = path.resolve('test/fixtures/java/paperapi')
    execFileSync('javac', ['--release', '21', '-d', classes,
      ...fakeApiFiles.map(file => path.join(fakeApiRoot, file)),
      ...productionFiles.map(file => path.join(javaRoot, file)),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerAdapterRuntimeFactoryOptionsFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerAdapterRuntimeFactoryOptionsFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(output, Array(9).fill('PAPER_BUKKIT_RUNTIME_OPTIONS_INVALID:true').join('|'))
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

function runRuntimeFactoryGuard(mode: string): string {
  const workspace = mkdtempSync(path.join(tmpdir(), `botchecker-paper-bukkit-runtime-${mode}-`))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    const fakeApiRoot = path.resolve('test/fixtures/java/paperapi')
    execFileSync('javac', ['--release', '21', '-d', classes,
      ...fakeApiFiles.map(file => path.join(fakeApiRoot, file)),
      ...productionFiles.map(file => path.join(javaRoot, file)),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerAdapterRuntimeFactoryGuardFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    return execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerAdapterRuntimeFactoryGuardFixture', mode], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
}

test('runtime factory sanitize null opaque lease trước khi tạo runtime', {
  skip: !javaInteropAvailable
}, () => {
  assert.equal(runRuntimeFactoryGuard('null-access'),
    'IllegalStateException:PAPER_BUKKIT_RUNTIME_OPEN_FAILED:true')
})

test('runtime factory sanitize opaque provider initialization failure', {
  skip: !javaInteropAvailable
}, () => {
  assert.equal(runRuntimeFactoryGuard('provider-failure'),
    'IllegalStateException:PAPER_BUKKIT_RUNTIME_OPEN_FAILED:true')
})

test('runtime factory bind conflict không poison factory và giải phóng fixed port', {
  skip: !javaInteropAvailable
}, () => {
  assert.equal(runRuntimeFactoryGuard('bind-retry'),
    'IllegalStateException:PAPER_BUKKIT_RUNTIME_OPEN_FAILED:true|true|true|2')
})
