import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  createPaperProcessConfigurationFilesystemObserver,
  createPaperProcessFilesystemObserver
} from '../src/paper-process-filesystem-observer.js'
import { createPaperProcessProvider } from '../src/paper-process-provider.js'
import {
  createWindowsPaperProcessSessionLockObserver,
  PaperProcessDeclaredArtifactTcpAndSessionLockPreflightError,
  preflightPaperProcessWithDeclaredArtifactTcpAndSessionLockObservations
} from '../src/paper-process-session-lock-observer.js'
import {
  createWindowsPaperProcessTcpListenerObserver
} from '../src/paper-process-tcp-listener-observer.js'
import { buildArtifactTargetBinding } from '../src/target-binding.js'

const sha256 = (content: string) => createHash('sha256').update(content).digest('hex')

async function fixture(bindingId = 'paper-process-session-lock-preflight-fixture') {
  const root = await mkdtemp(path.join(tmpdir(), 'botchecker-paper-lock-preflight-'))
  const paper = 'paper-bytes'
  const candidate = 'candidate-bytes'
  const config = 'enabled: true\n'
  await mkdir(path.join(root, 'server'), { recursive: true })
  await mkdir(path.join(root, 'plugins', 'Plugin'), { recursive: true })
  await mkdir(path.join(root, 'world'), { recursive: true })
  await writeFile(path.join(root, 'server', 'paper.jar'), paper)
  await writeFile(path.join(root, 'plugins', 'Plugin.jar'), candidate)
  await writeFile(path.join(root, 'plugins', 'Plugin', 'config.yml'), config)
  await writeFile(path.join(root, 'world', 'session.lock'), Buffer.from('☃', 'utf8'))
  const binding = buildArtifactTargetBinding({
    schemaVersion: 1,
    bindingId,
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
        logicalPath: 'plugins/Plugin.jar', sha256: sha256(candidate)
      },
      {
        logicalId: 'config-main', role: 'config',
        logicalPath: 'plugins/Plugin/config.yml', sha256: sha256(config)
      },
      {
        logicalId: 'paper', role: 'paper',
        logicalPath: 'server/paper.jar', sha256: sha256(paper)
      }
    ]
  })
  return { root, binding }
}

function provider(root: string, binding: ReturnType<typeof buildArtifactTargetBinding>) {
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

function remainingFacts() {
  return {
    schemaVersion: 1,
    onlinePlayers: 0,
    authorizationId: 'approval-fixture-a',
    requiredScope: ['isolated-fixture', 'process-preflight']
  }
}

async function withNetstat<T>(output: string, action: () => T): Promise<T> {
  const original = childProcess.execFileSync
  Object.defineProperty(childProcess, 'execFileSync', {
    configurable: true,
    value: (command: unknown, ...args: unknown[]) =>
      command === 'C:\\Windows\\System32\\netstat.exe'
        ? output
        : original(command as never, ...(args as never[]))
  })
  syncBuiltinESMExports()
  try {
    return action()
  } finally {
    Object.defineProperty(childProcess, 'execFileSync', { configurable: true, value: original })
    syncBuiltinESMExports()
  }
}

test('declared-artifact/TCP preflight lấy clean session-lock fact từ issued observation', {
  skip: process.platform === 'win32' ? false : 'Slice hiện chỉ hỗ trợ Windows file locking'
}, async () => {
  const current = await fixture()
  try {
    const paper = provider(current.root, current.binding)
    const executable = createPaperProcessFilesystemObserver({
      schemaVersion: 1, approvedRoot: current.root, targetBinding: current.binding
    }).observe()
    const configuration = createPaperProcessConfigurationFilesystemObserver({
      schemaVersion: 1, approvedRoot: current.root, targetBinding: current.binding
    }).observe()
    const tcp = await withNetstat(
      '  TCP    0.0.0.0:135    0.0.0.0:0    LISTENING    4',
      () => createWindowsPaperProcessTcpListenerObserver({
        schemaVersion: 1, approvedRoot: current.root, port: 25580,
        targetBinding: current.binding
      }).observe()
    )
    const lock = createWindowsPaperProcessSessionLockObserver(paper).observe()

    const preview = preflightPaperProcessWithDeclaredArtifactTcpAndSessionLockObservations(
      paper, executable, configuration, tcp, lock, remainingFacts()
    )

    assert.equal(preview.configuredSessionLockByteRangeStateObserved, true)
    assert.equal(preview.configuredSessionLockLogicalPath, 'world/session.lock')
    assert.equal(preview.configuredSessionLockFilePresent, true)
    assert.equal(preview.configuredSessionLockMarkerValidated, true)
    assert.equal(preview.activeSessionLockObserved, false)
    assert.equal(preview.sessionLockObservationStableAcrossTwoReads, true)
    assert.equal(preview.sessionLockObservationTemporarilyAcquiresLockWhenClean, true)
    assert.equal(preview.sessionLockObservationAtomic, false)
    assert.equal(preview.sessionLockObservationFreshness, 'not-established')
    assert.equal(preview.sessionLockFactsAuthoritative, false)
    assert.equal(preview.provesPaperProcessIdentity, false)
    assert.equal(preview.factsAuthoritative, false)
    assert.equal(preview.mutationAllowed, false)
    assert.equal(Object.isFrozen(preview), true)
  } finally {
    await rm(current.root, { recursive: true, force: true })
  }
})

test('session-lock preflight reject forged, mismatched và caller-injected lock facts', {
  skip: process.platform === 'win32' ? false : 'Slice hiện chỉ hỗ trợ Windows file locking'
}, async () => {
  const current = await fixture()
  const other = await fixture('paper-process-session-lock-other-binding')
  try {
    const paper = provider(current.root, current.binding)
    const executable = createPaperProcessFilesystemObserver({
      schemaVersion: 1, approvedRoot: current.root, targetBinding: current.binding
    }).observe()
    const configuration = createPaperProcessConfigurationFilesystemObserver({
      schemaVersion: 1, approvedRoot: current.root, targetBinding: current.binding
    }).observe()
    const tcp = await withNetstat(
      '  TCP    0.0.0.0:135    0.0.0.0:0    LISTENING    4',
      () => createWindowsPaperProcessTcpListenerObserver({
        schemaVersion: 1, approvedRoot: current.root, port: 25580,
        targetBinding: current.binding
      }).observe()
    )
    const clean = createWindowsPaperProcessSessionLockObserver(paper).observe()
    const otherBinding = createWindowsPaperProcessSessionLockObserver(
      provider(other.root, other.binding)
    ).observe()
    await rm(path.join(current.root, 'world', 'session.lock'))
    const missing = createWindowsPaperProcessSessionLockObserver(paper).observe()
    const invalid: Array<{ observation: unknown; facts: unknown }> = [
      { observation: { ...clean }, facts: remainingFacts() },
      { observation: missing, facts: remainingFacts() },
      { observation: otherBinding, facts: remainingFacts() },
      { observation: clean, facts: { ...remainingFacts(), sessionLockPresent: false } }
    ]

    for (const entry of invalid) {
      assert.throws(
        () => preflightPaperProcessWithDeclaredArtifactTcpAndSessionLockObservations(
          paper, executable, configuration, tcp, entry.observation, entry.facts
        ),
        error => {
          assert.equal(
            error instanceof PaperProcessDeclaredArtifactTcpAndSessionLockPreflightError,
            true
          )
          assert.equal(
            String(error),
            'PaperProcessDeclaredArtifactTcpAndSessionLockPreflightError: '
              + 'Paper process declared artifact, TCP and session lock preflight rejected'
          )
          assert.equal(String(error).includes(other.root), false)
          return true
        }
      )
    }
  } finally {
    await rm(current.root, { recursive: true, force: true })
    await rm(other.root, { recursive: true, force: true })
  }
})
