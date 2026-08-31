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
    bindingId: 'paper-process-tcp-partial-parse-fixture',
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

test('Windows TCP listener observer reject partial parse có TCP row malformed', {
  skip: process.platform === 'win32' ? false : 'Slice hiện chỉ hỗ trợ Windows netstat'
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'botchecker-paper-tcp-'))
  const original = childProcess.execFileSync
  const output = [
    '  TCP    0.0.0.0:135    0.0.0.0:0    LISTENING    4',
    '  TCP    0.0.0.0:25580  malformed'
  ].join('\r\n')
  Object.defineProperty(childProcess, 'execFileSync', {
    configurable: true,
    value: () => output
  })
  syncBuiltinESMExports()
  try {
    assert.throws(
      () => createWindowsPaperProcessTcpListenerObserver({
        schemaVersion: 1, approvedRoot: root, port: 25580, targetBinding: binding()
      }).observe(),
      /^PaperProcessTcpListenerObservationError: Paper process TCP listener observation rejected$/
    )
  } finally {
    Object.defineProperty(childProcess, 'execFileSync', {
      configurable: true,
      value: original
    })
    syncBuiltinESMExports()
    await rm(root, { recursive: true, force: true })
  }
})

test('Windows TCP listener observer validate local port và PID trên mọi TCP row', {
  skip: process.platform === 'win32' ? false : 'Slice hiện chỉ hỗ trợ Windows netstat'
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'botchecker-paper-tcp-'))
  const original = childProcess.execFileSync
  const invalidOutputs = [
    [
      '  TCP    0.0.0.0:25580    0.0.0.0:0    LISTENING    2',
      '  TCP    0.0.0.0:99999    0.0.0.0:0    LISTENING    3'
    ].join('\r\n'),
    [
      '  TCP    0.0.0.0:25580    0.0.0.0:0    LISTENING    2',
      '  TCP    127.0.0.1:135    127.0.0.1:50000    ESTABLISHED    99999999999999999999'
    ].join('\r\n')
  ]
  try {
    for (const output of invalidOutputs) {
      Object.defineProperty(childProcess, 'execFileSync', {
        configurable: true,
        value: () => output
      })
      syncBuiltinESMExports()
      assert.throws(
        () => createWindowsPaperProcessTcpListenerObserver({
          schemaVersion: 1, approvedRoot: root, port: 25580, targetBinding: binding()
        }).observe(),
        /^PaperProcessTcpListenerObservationError: Paper process TCP listener observation rejected$/
      )
    }
  } finally {
    Object.defineProperty(childProcess, 'execFileSync', {
      configurable: true,
      value: original
    })
    syncBuiltinESMExports()
    await rm(root, { recursive: true, force: true })
  }
})
