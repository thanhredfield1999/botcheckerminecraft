import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createPaperProcessProvider } from '../src/paper-process-provider.js'
import {
  createWindowsPaperProcessSessionLockObserver
} from '../src/paper-process-session-lock-observer.js'
import { buildArtifactTargetBinding } from '../src/target-binding.js'

function binding() {
  return buildArtifactTargetBinding({
    schemaVersion: 1,
    bindingId: 'paper-process-session-lock-java-held-fixture',
    provider: {
      kind: 'paper-process', id: 'paper-process-fixture',
      version: '1.0.0', instanceId: 'fixture-a'
    },
    authorization: {
      id: 'approval-fixture-a', scope: ['isolated-fixture', 'process-preflight']
    },
    artifacts: [
      {
        logicalId: 'candidate', role: 'candidate',
        logicalPath: 'plugins/Plugin.jar', sha256: '1'.repeat(64)
      },
      {
        logicalId: 'config-main', role: 'config',
        logicalPath: 'plugins/Plugin/config.yml', sha256: '2'.repeat(64)
      },
      {
        logicalId: 'paper', role: 'paper',
        logicalPath: 'server/paper.jar', sha256: '3'.repeat(64)
      }
    ]
  })
}

function provider(root: string) {
  return createPaperProcessProvider({
    schemaVersion: 1,
    id: 'paper-process-fixture', version: '1.0.0', instanceId: 'fixture-a',
    approvedRoot: root, logicalRoot: 'fixtures/paper-a', port: 25580,
    sessionLockLogicalPath: 'world/session.lock',
    authorization: {
      id: 'approval-fixture-a', scope: ['isolated-fixture', 'process-preflight']
    },
    targetBinding: binding()
  })
}

const holderSource = `
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
public final class SessionLockHolder {
  public static void main(String[] args) throws Exception {
    try (FileChannel channel = FileChannel.open(
        Path.of(args[0]), StandardOpenOption.READ, StandardOpenOption.WRITE);
        FileLock lock = channel.lock()) {
      System.out.println("LOCK_HELD");
      System.out.flush();
      System.in.read();
    }
  }
}
`

test('Windows session-lock observer thấy active Java FileChannel lock', {
  skip: process.platform === 'win32' ? false : 'Slice hiện chỉ hỗ trợ Windows file locking',
  timeout: 30_000
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'botchecker-paper-lock-java-'))
  const world = path.join(root, 'world')
  const classes = path.join(root, 'classes')
  const source = path.join(root, 'SessionLockHolder.java')
  const lockFile = path.join(world, 'session.lock')
  await mkdir(world)
  await mkdir(classes)
  await writeFile(lockFile, Buffer.from('☃', 'utf8'))
  await writeFile(source, holderSource)
  execFileSync('javac', ['--release', '21', '-encoding', 'UTF-8', '-d', classes, source], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true
  })
  const holder = spawn('java', ['-cp', classes, 'SessionLockHolder', lockFile], {
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
  })
  try {
    const [chunk] = await once(holder.stdout!, 'data')
    assert.equal(String(chunk).trim(), 'LOCK_HELD')

    const observation = createWindowsPaperProcessSessionLockObserver(provider(root)).observe()
    assert.equal(observation.sessionLockFilePresent, true)
    assert.equal(observation.sessionLockMarkerValidated, false)
    assert.equal(observation.activeSessionLockObserved, true)
  } finally {
    holder.stdin!.end()
    if (holder.exitCode === null) await once(holder, 'exit')
    await rm(root, { recursive: true, force: true })
  }
})
