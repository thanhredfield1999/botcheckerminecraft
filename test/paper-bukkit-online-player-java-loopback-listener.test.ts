import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { execFileSync, spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import net from 'node:net'
import { createInterface } from 'node:readline'
import test from 'node:test'
import { artifactTargetBindingSha256, buildArtifactTargetBinding } from '../src/target-binding.js'
import {
  buildPaperBukkitOnlinePlayerTrustStore,
  PaperBukkitOnlinePlayerVerifier
} from '../src/paper-bukkit-online-player-claim.js'
import { createPaperBukkitOnlinePlayerLoopbackClient } from '../src/paper-bukkit-online-player-loopback-client.js'
import { encodePaperBukkitOnlinePlayerRequestFrameV1 } from '../src/paper-bukkit-online-player-transport-codec.js'


const javaInteropAvailable = spawnSync('javac', ['-version'], {
  windowsHide: true,
  stdio: 'ignore'
}).status === 0 && spawnSync('java', ['-version'], {
  windowsHide: true,
  stdio: 'ignore'
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

function challengeFixture() {
  const binding = expectedBinding()
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
    randomBytes: size => Buffer.alloc(size, 99)
  })
  return verifier.issueChallenge({
    runId: 'paper-bukkit-run',
    expectedBinding: binding,
    keyId,
    ttlMs: 5_000
  })
}

async function readiness(child: ChildProcessWithoutNullStreams): Promise<{ host: string, port: number }> {
  const lines = createInterface({ input: child.stdout })
  try {
    const result = await Promise.race([
      once(lines, 'line'),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Java listener readiness timed out')), 5_000))
    ])
    const [host, portText] = String(result[0]).split(' ')
    const port = Number(portText)
    assert.equal(host, '127.0.0.1')
    assert.ok(Number.isSafeInteger(port) && port > 0 && port <= 65_535)
    return { host, port }
  } finally {
    lines.close()
  }
}

test('Java loopback listener nhận one-shot Node request và trả bounded response frame', {
  skip: !javaInteropAvailable,
  timeout: 20_000
}, async t => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-listener-'))
  let child: ChildProcessWithoutNullStreams | undefined
  t.after(() => {
    child?.kill()
    rmSync(workspace, { recursive: true, force: true })
  })

  const challenge = challengeFixture()
  const requestPath = path.join(workspace, 'request.bin')
  const classes = path.join(workspace, 'classes')
  mkdirSync(classes)
  writeFileSync(requestPath, encodePaperBukkitOnlinePlayerRequestFrameV1(challenge))
  const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
  execFileSync('javac', ['--release', '21', '-d', classes,
    path.join(javaRoot, 'CanonicalPaperBukkitOnlinePlayerPayload.java'),
    path.join(javaRoot, 'PaperBukkitOnlinePlayerTransportCodec.java'),
    path.join(javaRoot, 'PaperBukkitOnlinePlayerRequestProcessor.java'),
    path.join(javaRoot, 'PaperBukkitOnlinePlayerLoopbackListener.java'),
    path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerLoopbackListenerFixture.java')], {
    cwd: path.resolve('.'),
    windowsHide: true,
    stdio: 'pipe'
  })
  child = spawn('java', ['-cp', classes, 'PaperBukkitOnlinePlayerLoopbackListenerFixture', requestPath], {
    cwd: path.resolve('.'),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const { port } = await readiness(child)
  const client = createPaperBukkitOnlinePlayerLoopbackClient({ port, timeoutMs: 2_000 })
  const envelope = await client.request(challenge, new AbortController().signal)
  assert.equal(envelope.onlinePlayers, 0)
  assert.equal(envelope.claimedServerInstanceId, 'paper-server-a')
  assert.equal(envelope.claimedBootId, 'paper-boot-a')
  assert.equal(envelope.signatureBase64Url, Buffer.alloc(64).toString('base64url'))

  child.stdin.end('\n')
  const [code] = await once(child, 'exit')
  assert.equal(code, 0)
})

test('Java loopback listener close bounded và suppress active response', {
  skip: !javaInteropAvailable,
  timeout: 20_000
}, async t => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-listener-close-'))
  let child: ChildProcessWithoutNullStreams | undefined
  t.after(() => {
    child?.kill()
    rmSync(workspace, { recursive: true, force: true })
  })

  const challenge = challengeFixture()
  const requestPath = path.join(workspace, 'request.bin')
  const classes = path.join(workspace, 'classes')
  mkdirSync(classes)
  writeFileSync(requestPath, encodePaperBukkitOnlinePlayerRequestFrameV1(challenge))
  const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
  execFileSync('javac', ['--release', '21', '-d', classes,
    path.join(javaRoot, 'CanonicalPaperBukkitOnlinePlayerPayload.java'),
    path.join(javaRoot, 'PaperBukkitOnlinePlayerTransportCodec.java'),
    path.join(javaRoot, 'PaperBukkitOnlinePlayerRequestProcessor.java'),
    path.join(javaRoot, 'PaperBukkitOnlinePlayerLoopbackListener.java'),
    path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerLoopbackListenerCloseFixture.java')], {
    cwd: path.resolve('.'),
    windowsHide: true,
    stdio: 'pipe'
  })
  child = spawn('java', ['-cp', classes, 'PaperBukkitOnlinePlayerLoopbackListenerCloseFixture', requestPath], {
    cwd: path.resolve('.'),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const lines = createInterface({ input: child.stdout })
  t.after(() => lines.close())
  const first = await once(lines, 'line')
  const [host, portText] = String(first[0]).split(' ')
  assert.equal(host, '127.0.0.1')
  const port = Number(portText)
  assert.ok(Number.isSafeInteger(port) && port > 0 && port <= 65_535)

  const client = createPaperBukkitOnlinePlayerLoopbackClient({ port, timeoutMs: 5_000 })
  const pendingRejection = assert.rejects(
    client.request(challenge, new AbortController().signal),
    /Paper Bukkit loopback (?:response is invalid|request failed)/
  )
  const snapshotLine = await once(lines, 'line')
  assert.equal(snapshotLine[0], 'SNAPSHOT_ENTERED')
  child.stdin.write('CLOSE\n')
  const closedLine = await once(lines, 'line')
  const [closed, elapsedText] = String(closedLine[0]).split(' ')
  assert.equal(closed, 'CLOSED')
  assert.ok(Number(elapsedText) < 500, `listener close took ${elapsedText} ms`)
  await pendingRejection
  const [code] = await once(child, 'exit')
  assert.equal(code, 0)
})

test('Java loopback listener reject connection thứ hai trong khi single-flight bận', {
  skip: !javaInteropAvailable,
  timeout: 20_000
}, async t => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-listener-busy-'))
  let child: ChildProcessWithoutNullStreams | undefined
  t.after(() => {
    child?.kill()
    rmSync(workspace, { recursive: true, force: true })
  })

  const challenge = challengeFixture()
  const requestFrame = encodePaperBukkitOnlinePlayerRequestFrameV1(challenge)
  const requestPath = path.join(workspace, 'request.bin')
  const classes = path.join(workspace, 'classes')
  mkdirSync(classes)
  writeFileSync(requestPath, requestFrame)
  const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
  execFileSync('javac', ['--release', '21', '-d', classes,
    path.join(javaRoot, 'CanonicalPaperBukkitOnlinePlayerPayload.java'),
    path.join(javaRoot, 'PaperBukkitOnlinePlayerTransportCodec.java'),
    path.join(javaRoot, 'PaperBukkitOnlinePlayerRequestProcessor.java'),
    path.join(javaRoot, 'PaperBukkitOnlinePlayerLoopbackListener.java'),
    path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerLoopbackListenerBusyFixture.java')], {
    cwd: path.resolve('.'),
    windowsHide: true,
    stdio: 'pipe'
  })
  child = spawn('java', ['-cp', classes, 'PaperBukkitOnlinePlayerLoopbackListenerBusyFixture', requestPath], {
    cwd: path.resolve('.'),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const lines = createInterface({ input: child.stdout })
  t.after(() => lines.close())
  const first = await once(lines, 'line')
  const [host, portText] = String(first[0]).split(' ')
  assert.equal(host, '127.0.0.1')
  const port = Number(portText)
  assert.ok(Number.isSafeInteger(port) && port > 0 && port <= 65_535)

  const firstClient = createPaperBukkitOnlinePlayerLoopbackClient({ port, timeoutMs: 5_000 })
  const firstResponse = firstClient.request(challenge, new AbortController().signal)
  const snapshotLine = await once(lines, 'line')
  assert.equal(snapshotLine[0], 'SNAPSHOT_ENTERED')

  const busyResult = await new Promise<'closed' | 'timeout'>(resolve => {
    let settled = false
    const socket = net.createConnection({ host: '127.0.0.1', port, family: 4, allowHalfOpen: true })
    const finish = (result: 'closed' | 'timeout') => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(result)
    }
    const timer = setTimeout(() => finish('timeout'), 750)
    socket.once('connect', () => socket.end(requestFrame))
    socket.once('end', () => finish('closed'))
    socket.once('close', () => finish('closed'))
    socket.once('error', () => finish('closed'))
  })

  child.stdin.write('RELEASE\n')
  const envelope = await firstResponse
  assert.equal(envelope.onlinePlayers, 0)
  child.stdin.end('CLOSE\n')
  const [code] = await once(child, 'exit')
  assert.equal(code, 0)
  assert.equal(busyResult, 'closed')
})

test('Java loopback listener close chờ accept/worker quiescent sau khi interrupt callback', {
  skip: !javaInteropAvailable,
  timeout: 20_000
}, async t => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-listener-quiescence-'))
  let child: ChildProcessWithoutNullStreams | undefined
  t.after(() => {
    child?.kill()
    rmSync(workspace, { recursive: true, force: true })
  })

  const challenge = challengeFixture()
  const requestPath = path.join(workspace, 'request.bin')
  const classes = path.join(workspace, 'classes')
  mkdirSync(classes)
  writeFileSync(requestPath, encodePaperBukkitOnlinePlayerRequestFrameV1(challenge))
  const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
  execFileSync('javac', ['--release', '21', '-d', classes,
    path.join(javaRoot, 'CanonicalPaperBukkitOnlinePlayerPayload.java'),
    path.join(javaRoot, 'PaperBukkitOnlinePlayerTransportCodec.java'),
    path.join(javaRoot, 'PaperBukkitOnlinePlayerRequestProcessor.java'),
    path.join(javaRoot, 'PaperBukkitOnlinePlayerLoopbackListener.java'),
    path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerLoopbackListenerQuiescenceFixture.java')], {
    cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
  })
  child = spawn('java', ['-cp', classes, 'PaperBukkitOnlinePlayerLoopbackListenerQuiescenceFixture', requestPath], {
    cwd: path.resolve('.'), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
  })
  const lines = createInterface({ input: child.stdout })
  t.after(() => lines.close())
  const first = await once(lines, 'line')
  const [host, portText] = String(first[0]).split(' ')
  assert.equal(host, '127.0.0.1')
  const port = Number(portText)
  assert.ok(Number.isSafeInteger(port) && port > 0 && port <= 65_535)

  const client = createPaperBukkitOnlinePlayerLoopbackClient({ port, timeoutMs: 5_000 })
  const pendingRejection = assert.rejects(
    client.request(challenge, new AbortController().signal),
    /Paper Bukkit loopback (?:response is invalid|request failed)/
  )
  const snapshotLine = await once(lines, 'line')
  assert.equal(snapshotLine[0], 'SNAPSHOT_ENTERED')
  child.stdin.end('CLOSE\n')
  const quiescentLine = await once(lines, 'line')
  const [marker, callbackExited, threadsTerminated, elapsedText] = String(quiescentLine[0]).split(' ')
  assert.equal(marker, 'QUIESCENT')
  assert.equal(callbackExited, 'true')
  assert.equal(threadsTerminated, 'true')
  assert.ok(Number(elapsedText) < 500, `listener close took ${elapsedText} ms`)
  await pendingRejection
  const [code] = await once(child, 'exit')
  assert.equal(code, 0)
})
