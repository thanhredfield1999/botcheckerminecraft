import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { syncBuiltinESMExports } from 'node:module'
import {
  createWindowsPaperProcessTcpListenerObserver,
  PaperProcessTcpListenerObservationError
} from '../src/paper-process-tcp-listener-observer.js'
import {
  artifactTargetBindingSha256,
  buildArtifactTargetBinding
} from '../src/target-binding.js'

function binding() {
  return buildArtifactTargetBinding({
    schemaVersion: 1,
    bindingId: 'paper-process-tcp-fixture',
    provider: {
      kind: 'paper-process', id: 'paper-process-fixture',
      version: '1.0.0', instanceId: 'fixture-a'
    },
    authorization: {
      id: 'approval-fixture-a',
      scope: ['isolated-fixture', 'process-preflight']
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

async function listenLoopback(): Promise<{ server: net.Server; port: number }> {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Expected TCP address')
  return { server, port: address.port }
}

async function close(server: net.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}

test('Windows TCP listener observer bind exact configured port và owner PID từ OS', {
  skip: process.platform === 'win32' ? false : 'Slice hiện chỉ hỗ trợ Windows netstat'
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'botchecker-paper-tcp-'))
  const { server, port } = await listenLoopback()
  try {
    const currentBinding = binding()
    const observer = createWindowsPaperProcessTcpListenerObserver({
      schemaVersion: 1,
      approvedRoot: root,
      port,
      targetBinding: currentBinding
    })
    const observation = observer.observe()

    assert.deepEqual(observation, {
      schemaVersion: 1,
      root,
      targetBindingSha256: artifactTargetBindingSha256(currentBinding),
      port,
      configuredTcpPortListenerOwnersObserved: true,
      portListening: true,
      owningPids: [process.pid],
      observationSource: 'windows-netstat-ano',
      observationStableAcrossTwoReads: true,
      observationAtomic: false,
      observationFreshness: 'not-established',
      tcpListenerFactsAuthoritative: false,
      provesPaperProcessIdentity: false
    })
    assert.equal(Object.isFrozen(observer), true)
    assert.equal(Object.isFrozen(observation), true)
    assert.equal(Object.isFrozen(observation.owningPids), true)
  } finally {
    await close(server)
    await rm(root, { recursive: true, force: true })
  }
})

async function withMockedNetstat<T>(
  outputs: readonly (string | Error)[],
  action: () => Promise<T> | T
): Promise<{ result: T; calls: number }> {
  const original = childProcess.execFileSync
  let calls = 0
  Object.defineProperty(childProcess, 'execFileSync', {
    configurable: true,
    value(command: string, args: readonly string[], options: Record<string, unknown>) {
      assert.equal(command, 'C:\\Windows\\System32\\netstat.exe')
      assert.deepEqual(args, ['-ano', '-p', 'tcp'])
      assert.equal(options.timeout, 5_000)
      assert.equal(options.maxBuffer, 1024 * 1024)
      assert.equal(options.windowsHide, true)
      const output = outputs[calls++]
      if (output instanceof Error) throw output
      if (output === undefined) throw new Error('Unexpected netstat call')
      return output
    }
  })
  syncBuiltinESMExports()
  try {
    return { result: await action(), calls }
  } finally {
    Object.defineProperty(childProcess, 'execFileSync', {
      configurable: true,
      value: original
    })
    syncBuiltinESMExports()
  }
}

test('Windows TCP listener observer chỉ nhận LISTENING exact port rồi dedupe/sort PID', {
  skip: process.platform === 'win32' ? false : 'Slice hiện chỉ hỗ trợ Windows netstat'
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'botchecker-paper-tcp-'))
  const output = [
    '  TCP    0.0.0.0:25580       0.0.0.0:0       LISTENING       22',
    '  TCP    [::]:25580          [::]:0          LISTENING       11',
    '  TCP    127.0.0.1:25580     127.0.0.1:50000 ESTABLISHED     99',
    '  TCP    0.0.0.0:2558        0.0.0.0:0       LISTENING       77',
    '  TCP    127.0.0.1:25580     0.0.0.0:0       LISTENING       22'
  ].join('\r\n')
  try {
    const observed = await withMockedNetstat([output, output], () =>
      createWindowsPaperProcessTcpListenerObserver({
        schemaVersion: 1, approvedRoot: root, port: 25580, targetBinding: binding()
      }).observe())
    assert.equal(observed.calls, 2)
    assert.deepEqual(observed.result.owningPids, [11, 22])
    assert.equal(observed.result.portListening, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Windows TCP listener observer reject khi owner PID đổi giữa hai snapshot', {
  skip: process.platform === 'win32' ? false : 'Slice hiện chỉ hỗ trợ Windows netstat'
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'botchecker-paper-tcp-'))
  try {
    const first = '  TCP    0.0.0.0:25580    0.0.0.0:0    LISTENING    11'
    const second = '  TCP    0.0.0.0:25580    0.0.0.0:0    LISTENING    22'
    const observed = await withMockedNetstat([first, second], () => {
      assert.throws(
        () => createWindowsPaperProcessTcpListenerObserver({
          schemaVersion: 1, approvedRoot: root, port: 25580, targetBinding: binding()
        }).observe(),
        /^PaperProcessTcpListenerObservationError: Paper process TCP listener observation rejected$/
      )
    })
    assert.equal(observed.calls, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Windows TCP listener observer bound output và sanitize command failure', {
  skip: process.platform === 'win32' ? false : 'Slice hiện chỉ hỗ trợ Windows netstat'
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'botchecker-paper-tcp-'))
  const observe = () => createWindowsPaperProcessTcpListenerObserver({
    schemaVersion: 1, approvedRoot: root, port: 25580, targetBinding: binding()
  }).observe()
  try {
    await withMockedNetstat(['x'.repeat(1024 * 1024 + 1)], () => {
      assert.throws(observe, PaperProcessTcpListenerObservationError)
    })
    await withMockedNetstat([new Error('secret/netstat/path')], () => {
      assert.throws(observe, error => {
        assert.equal(
          String(error),
          'PaperProcessTcpListenerObservationError: Paper process TCP listener observation rejected'
        )
        assert.equal(String(error).includes('secret'), false)
        return true
      })
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
