import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createPaperProcessProvider } from '../src/paper-process-provider.js'
import {
  createWindowsPaperProcessSessionLockObserver,
  PaperProcessSessionLockObservationError
} from '../src/paper-process-session-lock-observer.js'
import { buildArtifactTargetBinding } from '../src/target-binding.js'

function provider(root: string) {
  const binding = buildArtifactTargetBinding({
    schemaVersion: 1,
    bindingId: 'paper-process-session-lock-cross-read-race',
    provider: {
      kind: 'paper-process', id: 'paper-process-fixture',
      version: '1.0.0', instanceId: 'fixture-a'
    },
    authorization: {
      id: 'approval-fixture-a', scope: ['isolated-fixture', 'process-preflight']
    },
    artifacts: [
      { logicalId: 'candidate', role: 'candidate', logicalPath: 'plugins/Plugin.jar', sha256: '1'.repeat(64) },
      { logicalId: 'config-main', role: 'config', logicalPath: 'plugins/Plugin/config.yml', sha256: '2'.repeat(64) },
      { logicalId: 'paper', role: 'paper', logicalPath: 'server/paper.jar', sha256: '3'.repeat(64) }
    ]
  })
  return createPaperProcessProvider({
    schemaVersion: 1,
    id: 'paper-process-fixture', version: '1.0.0', instanceId: 'fixture-a',
    approvedRoot: root, logicalRoot: 'fixtures/paper-a', port: 25580,
    sessionLockLogicalPath: 'world/session.lock',
    authorization: {
      id: 'approval-fixture-a', scope: ['isolated-fixture', 'process-preflight']
    },
    targetBinding: binding
  })
}

test('Windows session-lock observer reject file identity đổi giữa hai probes', {
  skip: process.platform === 'win32' ? false : 'Slice hiện chỉ hỗ trợ Windows file locking'
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'botchecker-paper-lock-cross-read-'))
  const world = path.join(root, 'world')
  const file = path.join(world, 'session.lock')
  const prior = path.join(world, 'session.previous')
  await mkdir(world)
  await writeFile(file, Buffer.from('☃', 'utf8'))
  const originalLstatSync = fs.lstatSync
  let rootReads = 0
  Object.defineProperty(fs, 'lstatSync', {
    configurable: true,
    value: ((target: fs.PathLike, options?: unknown) => {
      if (String(target) === root) {
        rootReads += 1
        if (rootReads === 3) {
          fs.renameSync(file, prior)
          fs.writeFileSync(file, Buffer.from('☃', 'utf8'))
        }
      }
      return originalLstatSync(target, options as never)
    })
  })
  try {
    assert.throws(
      () => createWindowsPaperProcessSessionLockObserver(provider(root)).observe(),
      PaperProcessSessionLockObservationError
    )
    assert.equal(rootReads >= 3, true)
  } finally {
    Object.defineProperty(fs, 'lstatSync', { configurable: true, value: originalLstatSync })
    await rm(root, { recursive: true, force: true })
  }
})
