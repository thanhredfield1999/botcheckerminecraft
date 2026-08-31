import assert from 'node:assert/strict'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createPaperProcessProvider } from '../src/paper-process-provider.js'
import {
  createWindowsPaperProcessSessionLockObserver,
  PaperProcessSessionLockObservationError
} from '../src/paper-process-session-lock-observer.js'
import { buildArtifactTargetBinding } from '../src/target-binding.js'

function binding() {
  return buildArtifactTargetBinding({
    schemaVersion: 1,
    bindingId: 'paper-process-session-lock-path-guard-fixture',
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

test('Windows session-lock observer reject parent junction xuất hiện sau cấu hình', {
  skip: process.platform === 'win32' ? false : 'Slice hiện chỉ hỗ trợ Windows file locking'
}, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'botchecker-paper-lock-root-'))
  const outside = await mkdtemp(path.join(tmpdir(), 'botchecker-paper-lock-outside-'))
  try {
    const observer = createWindowsPaperProcessSessionLockObserver(provider(root))
    try {
      await symlink(outside, path.join(root, 'world'), 'junction')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        t.skip('Host không cho tạo junction: EPERM')
        return
      }
      throw error
    }
    assert.throws(
      () => observer.observe(),
      error => {
        assert.equal(error instanceof PaperProcessSessionLockObservationError, true)
        assert.equal(
          String(error),
          'PaperProcessSessionLockObservationError: Paper process session lock observation rejected'
        )
        assert.equal(String(error).includes(outside), false)
        return true
      }
    )
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
