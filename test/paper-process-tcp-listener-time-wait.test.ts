import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  createWindowsPaperProcessTcpListenerObserver
} from '../src/paper-process-tcp-listener-observer.js'
import { buildArtifactTargetBinding } from '../src/target-binding.js'

function binding() {
  return buildArtifactTargetBinding({
    schemaVersion: 1,
    bindingId: 'paper-process-tcp-time-wait-fixture',
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

test('Windows TCP listener observer chấp nhận TIME_WAIT PID 0 nhưng không coi là listener', {
  skip: process.platform === 'win32' ? false : 'Slice hiện chỉ hỗ trợ Windows netstat'
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'botchecker-paper-tcp-'))
  const original = childProcess.execFileSync
  const output = [
    '  TCP    127.0.0.1:25580    127.0.0.1:50000    TIME_WAIT    0',
    '  TCP    0.0.0.0:135        0.0.0.0:0          LISTENING    4'
  ].join('\r\n')
  Object.defineProperty(childProcess, 'execFileSync', {
    configurable: true,
    value: () => output
  })
  syncBuiltinESMExports()
  try {
    const observation = createWindowsPaperProcessTcpListenerObserver({
      schemaVersion: 1, approvedRoot: root, port: 25580, targetBinding: binding()
    }).observe()
    assert.equal(observation.portListening, false)
    assert.deepEqual(observation.owningPids, [])
  } finally {
    Object.defineProperty(childProcess, 'execFileSync', {
      configurable: true,
      value: original
    })
    syncBuiltinESMExports()
    await rm(root, { recursive: true, force: true })
  }
})
