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
  createWindowsPaperProcessTcpListenerObserver,
  PaperProcessDeclaredArtifactAndTcpListenerPreflightError,
  preflightPaperProcessWithDeclaredArtifactAndTcpListenerObservations
} from '../src/paper-process-tcp-listener-observer.js'
import { buildArtifactTargetBinding } from '../src/target-binding.js'

const sha256 = (content: string) => createHash('sha256').update(content).digest('hex')

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'botchecker-paper-tcp-preflight-'))
  const paper = 'paper-bytes'
  const candidate = 'candidate-bytes'
  const config = 'enabled: true\n'
  await mkdir(path.join(root, 'server'), { recursive: true })
  await mkdir(path.join(root, 'plugins', 'Plugin'), { recursive: true })
  await writeFile(path.join(root, 'server', 'paper.jar'), paper)
  await writeFile(path.join(root, 'plugins', 'Plugin.jar'), candidate)
  await writeFile(path.join(root, 'plugins', 'Plugin', 'config.yml'), config)
  const binding = buildArtifactTargetBinding({
    schemaVersion: 1,
    bindingId: 'paper-process-tcp-preflight-fixture',
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
    authorization: {
      id: 'approval-fixture-a', scope: ['isolated-fixture', 'process-preflight']
    },
    targetBinding: binding
  })
}

function remainingFacts() {
  return {
    schemaVersion: 1,
    sessionLockPresent: false,
    onlinePlayers: 0,
    authorizationId: 'approval-fixture-a',
    requiredScope: ['isolated-fixture', 'process-preflight']
  }
}

async function withNetstat<T>(output: string, action: () => T): Promise<T> {
  const original = childProcess.execFileSync
  Object.defineProperty(childProcess, 'execFileSync', {
    configurable: true,
    value: () => output
  })
  syncBuiltinESMExports()
  try {
    return action()
  } finally {
    Object.defineProperty(childProcess, 'execFileSync', {
      configurable: true,
      value: original
    })
    syncBuiltinESMExports()
  }
}

test('declared-artifact preflight lấy clean port/PID facts từ issued TCP observation', {
  skip: process.platform === 'win32' ? false : 'Slice hiện chỉ hỗ trợ Windows netstat'
}, async () => {
  const current = await fixture()
  try {
    const executable = createPaperProcessFilesystemObserver({
      schemaVersion: 1, approvedRoot: current.root, targetBinding: current.binding
    }).observe()
    const configuration = createPaperProcessConfigurationFilesystemObserver({
      schemaVersion: 1, approvedRoot: current.root, targetBinding: current.binding
    }).observe()
    const tcp = await withNetstat(
      '  TCP    0.0.0.0:135    0.0.0.0:0    LISTENING    4',
      () => createWindowsPaperProcessTcpListenerObserver({
      schemaVersion: 1,
      approvedRoot: current.root,
      port: 25580,
      targetBinding: current.binding
      }).observe()
    )

    const preview = preflightPaperProcessWithDeclaredArtifactAndTcpListenerObservations(
      provider(current.root, current.binding), executable, configuration, tcp, remainingFacts()
    )

    assert.equal(preview.configuredTcpPortListenerOwnersObserved, true)
    assert.equal(preview.configuredTcpPortListening, false)
    assert.deepEqual(preview.configuredTcpPortOwningPids, [])
    assert.equal(Object.isFrozen(preview.configuredTcpPortOwningPids), true)
    assert.equal(preview.tcpListenerObservationStableAcrossTwoReads, true)
    assert.equal(preview.tcpListenerObservationAtomic, false)
    assert.equal(preview.tcpListenerObservationFreshness, 'not-established')
    assert.equal(preview.tcpListenerFactsAuthoritative, false)
    assert.equal(preview.provesPaperProcessIdentity, false)
    assert.equal(preview.factsAuthoritative, false)
    assert.equal(preview.mutationAllowed, false)
    assert.equal(Object.isFrozen(preview), true)
  } finally {
    await rm(current.root, { recursive: true, force: true })
  }
})

test('TCP preflight reject forged, occupied, mismatched và caller-injected process facts', {
  skip: process.platform === 'win32' ? false : 'Slice hiện chỉ hỗ trợ Windows netstat'
}, async () => {
  const current = await fixture()
  const otherRoot = await mkdtemp(path.join(tmpdir(), 'botchecker-paper-tcp-other-'))
  try {
    const executable = createPaperProcessFilesystemObserver({
      schemaVersion: 1, approvedRoot: current.root, targetBinding: current.binding
    }).observe()
    const configuration = createPaperProcessConfigurationFilesystemObserver({
      schemaVersion: 1, approvedRoot: current.root, targetBinding: current.binding
    }).observe()
    const cleanOutput = '  TCP    0.0.0.0:135    0.0.0.0:0    LISTENING    4'
    const clean = await withNetstat(cleanOutput, () =>
      createWindowsPaperProcessTcpListenerObserver({
        schemaVersion: 1,
        approvedRoot: current.root,
        port: 25580,
        targetBinding: current.binding
      }).observe())
    const occupiedOutput = '  TCP    0.0.0.0:25580    0.0.0.0:0    LISTENING    1234'
    const occupied = await withNetstat(occupiedOutput, () =>
      createWindowsPaperProcessTcpListenerObserver({
        schemaVersion: 1,
        approvedRoot: current.root,
        port: 25580,
        targetBinding: current.binding
      }).observe())
    const otherRootObservation = await withNetstat(cleanOutput, () =>
      createWindowsPaperProcessTcpListenerObserver({
        schemaVersion: 1,
        approvedRoot: otherRoot,
        port: 25580,
        targetBinding: current.binding
      }).observe())
    const otherBinding = buildArtifactTargetBinding({
      schemaVersion: 1,
      bindingId: 'paper-process-tcp-other-binding',
      provider: current.binding.provider,
      authorization: current.binding.authorization,
      artifacts: current.binding.artifacts
    })
    const otherBindingObservation = await withNetstat(cleanOutput, () =>
      createWindowsPaperProcessTcpListenerObserver({
        schemaVersion: 1,
        approvedRoot: current.root,
        port: 25580,
        targetBinding: otherBinding
      }).observe())
    const paper = provider(current.root, current.binding)
    const invalid: Array<{ observation: unknown; facts: unknown }> = [
      { observation: { ...clean }, facts: remainingFacts() },
      { observation: occupied, facts: remainingFacts() },
      { observation: otherRootObservation, facts: remainingFacts() },
      { observation: otherBindingObservation, facts: remainingFacts() },
      { observation: clean, facts: { ...remainingFacts(), port: 25580, pid: null } }
    ]

    for (const entry of invalid) {
      assert.throws(
        () => preflightPaperProcessWithDeclaredArtifactAndTcpListenerObservations(
          paper, executable, configuration, entry.observation, entry.facts
        ),
        error => {
          assert.equal(error instanceof PaperProcessDeclaredArtifactAndTcpListenerPreflightError, true)
          assert.equal(
            String(error),
            'PaperProcessDeclaredArtifactAndTcpListenerPreflightError: '
              + 'Paper process declared artifact and TCP listener preflight rejected'
          )
          assert.equal(String(error).includes(otherRoot), false)
          return true
        }
      )
    }
  } finally {
    await rm(current.root, { recursive: true, force: true })
    await rm(otherRoot, { recursive: true, force: true })
  }
})
