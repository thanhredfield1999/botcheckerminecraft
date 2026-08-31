import assert from 'node:assert/strict'
import { link, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
    bindingId: 'paper-process-session-lock-rejection-fixture',
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

function provider(root: string, sessionLockLogicalPath = 'world/session.lock') {
  return createPaperProcessProvider({
    schemaVersion: 1,
    id: 'paper-process-fixture', version: '1.0.0', instanceId: 'fixture-a',
    approvedRoot: root, logicalRoot: 'fixtures/paper-a', port: 25580,
    sessionLockLogicalPath,
    authorization: {
      id: 'approval-fixture-a', scope: ['isolated-fixture', 'process-preflight']
    },
    targetBinding: binding()
  })
}

const sanitized = /^PaperProcessSessionLockObservationError: Paper process session lock observation rejected$/

test('Windows session-lock observer ghi nhận missing file nhưng không giả thành active lock', {
  skip: process.platform === 'win32' ? false : 'Slice hiện chỉ hỗ trợ Windows file locking'
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'botchecker-paper-lock-missing-'))
  try {
    const observation = createWindowsPaperProcessSessionLockObserver(provider(root)).observe()
    assert.equal(observation.sessionLockFilePresent, false)
    assert.equal(observation.sessionLockMarkerValidated, false)
    assert.equal(observation.activeSessionLockObserved, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Windows session-lock observer reject malformed marker, wrong size và hardlink', {
  skip: process.platform === 'win32' ? false : 'Slice hiện chỉ hỗ trợ Windows file locking'
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'botchecker-paper-lock-invalid-'))
  const world = path.join(root, 'world')
  const file = path.join(world, 'session.lock')
  const other = path.join(root, 'other.lock')
  await mkdir(world)
  try {
    for (const bytes of [Buffer.from('abc'), Buffer.alloc(8)]) {
      await writeFile(file, bytes)
      assert.throws(
        () => createWindowsPaperProcessSessionLockObserver(provider(root)).observe(),
        sanitized
      )
    }
    await writeFile(other, Buffer.from('☃', 'utf8'))
    await rm(file, { force: true })
    await link(other, file)
    assert.throws(
      () => createWindowsPaperProcessSessionLockObserver(provider(root)).observe(),
      sanitized
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Paper process provider reject unbounded session-lock logical path', () => {
  const root = path.resolve('fixtures/paper-session-lock-rejection')
  for (const logicalPath of [
    '../world/session.lock',
    'world/../session.lock',
    'C:/world/session.lock',
    'world\\session.lock',
    '/world/session.lock',
    'world/not-session.lock',
    'world/secret-token.lock'
  ]) {
    assert.throws(
      () => provider(root, logicalPath),
      /^Error: Paper process provider configuration is invalid$/
    )
  }
})
