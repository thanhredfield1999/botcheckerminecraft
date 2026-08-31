import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createPaperProcessProvider } from '../src/paper-process-provider.js'
import { createWindowsPaperProcessSessionLockObserver } from '../src/paper-process-session-lock-observer.js'
import { buildArtifactTargetBinding } from '../src/target-binding.js'

function provider(root: string) {
  const binding = buildArtifactTargetBinding({
    schemaVersion: 1,
    bindingId: 'paper-process-session-lock-unicode-path',
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

test('Windows session-lock observer truyền approved root Unicode qua stdin đúng byte', {
  skip: process.platform === 'win32' ? false : 'Slice hiện chỉ hỗ trợ Windows file locking'
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'botchecker-đường-lock-'))
  try {
    await mkdir(path.join(root, 'world'))
    await writeFile(path.join(root, 'world', 'session.lock'), Buffer.from('☃', 'utf8'))
    const observation = createWindowsPaperProcessSessionLockObserver(provider(root)).observe()
    assert.equal(observation.root, root)
    assert.equal(observation.sessionLockMarkerValidated, true)
    assert.equal(observation.activeSessionLockObserved, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
