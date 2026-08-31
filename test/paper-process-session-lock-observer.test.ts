import assert from 'node:assert/strict'
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
    bindingId: 'paper-process-session-lock-fixture',
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

test('Windows session-lock observer phân biệt file tồn tại nhưng không có active lock', {
  skip: process.platform === 'win32' ? false : 'Slice hiện chỉ hỗ trợ Windows file locking'
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'botchecker-paper-lock-'))
  await mkdir(path.join(root, 'world'))
  await writeFile(path.join(root, 'world', 'session.lock'), Buffer.from('☃', 'utf8'))
  try {
    const observation = createWindowsPaperProcessSessionLockObserver(provider(root)).observe()

    assert.equal(observation.root, root)
    assert.equal(observation.sessionLockLogicalPath, 'world/session.lock')
    assert.equal(observation.sessionLockFilePresent, true)
    assert.equal(observation.sessionLockMarkerValidated, true)
    assert.equal(observation.activeSessionLockObserved, false)
    assert.equal(observation.observationSource, 'windows-byte-range-lock-probe')
    assert.equal(observation.observationStableAcrossTwoReads, true)
    assert.equal(observation.observationTemporarilyAcquiresLockWhenClean, true)
    assert.equal(observation.observationAtomic, false)
    assert.equal(observation.observationFreshness, 'not-established')
    assert.equal(observation.sessionLockFactsAuthoritative, false)
    assert.equal(observation.provesPaperProcessIdentity, false)
    assert.equal(Object.isFrozen(observation), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
