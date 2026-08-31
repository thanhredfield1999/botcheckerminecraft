import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  createWindowsPaperProcessTcpListenerObserver,
  PaperProcessTcpListenerObservationError
} from '../src/paper-process-tcp-listener-observer.js'
import { buildArtifactTargetBinding } from '../src/target-binding.js'

function binding() {
  return buildArtifactTargetBinding({
    schemaVersion: 1,
    bindingId: 'paper-process-tcp-fail-closed-fixture',
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

async function withNetstatOutput<T>(output: string, action: () => T): Promise<{
  result: T
  commands: string[]
}> {
  const original = childProcess.execFileSync
  const commands: string[] = []
  Object.defineProperty(childProcess, 'execFileSync', {
    configurable: true,
    value(command: string) {
      commands.push(command)
      return output
    }
  })
  syncBuiltinESMExports()
  try {
    return { result: action(), commands }
  } finally {
    Object.defineProperty(childProcess, 'execFileSync', {
      configurable: true,
      value: original
    })
    syncBuiltinESMExports()
  }
}

test('Windows TCP listener observer pin fixed System32 netstat executable', {
  skip: process.platform === 'win32' ? false : 'Slice hiện chỉ hỗ trợ Windows netstat'
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'botchecker-paper-tcp-'))
  const validOutput = '  TCP    0.0.0.0:135    0.0.0.0:0    LISTENING    4'
  try {
    const observed = await withNetstatOutput(validOutput, () =>
      createWindowsPaperProcessTcpListenerObserver({
        schemaVersion: 1, approvedRoot: root, port: 25580, targetBinding: binding()
      }).observe())
    assert.deepEqual(observed.commands, [
      'C:\\Windows\\System32\\netstat.exe',
      'C:\\Windows\\System32\\netstat.exe'
    ])
    assert.equal(observed.result.portListening, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Windows TCP listener observer reject unrecognizable output thay vì suy ra port free', {
  skip: process.platform === 'win32' ? false : 'Slice hiện chỉ hỗ trợ Windows netstat'
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'botchecker-paper-tcp-'))
  const observe = () => createWindowsPaperProcessTcpListenerObserver({
    schemaVersion: 1, approvedRoot: root, port: 25580, targetBinding: binding()
  }).observe()
  try {
    for (const output of ['', 'garbage', 'Proto Local Address']) {
      await withNetstatOutput(output, () => {
        assert.throws(observe, PaperProcessTcpListenerObservationError)
      })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
