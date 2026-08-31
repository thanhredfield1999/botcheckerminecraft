import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
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
    bindingId: 'paper-process-session-lock-command-fixture',
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

const sanitized = /^PaperProcessSessionLockObservationError: Paper process session lock observation rejected$/

test('Windows session-lock observer pin fixed PowerShell command và gửi path chỉ qua stdin', {
  skip: process.platform === 'win32' ? false : 'Slice hiện chỉ hỗ trợ Windows file locking'
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'botchecker-paper-lock-command-'))
  const world = path.join(root, 'world')
  const file = path.join(world, 'session.lock')
  await mkdir(world)
  await writeFile(file, Buffer.from('☃', 'utf8'))
  const original = childProcess.execFileSync
  let calls = 0
  Object.defineProperty(childProcess, 'execFileSync', {
    configurable: true,
    value: (command: string, args: string[], options: Record<string, unknown>) => {
      calls += 1
      assert.equal(
        command,
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
      )
      assert.deepEqual(args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'])
      assert.equal(args.length, 5)
      assert.equal(args.includes(file), false)
      assert.equal(options.input, file)
      assert.equal(options.timeout, 5_000)
      assert.equal(options.maxBuffer, 1024)
      assert.equal(options.windowsHide, true)
      return 'UNLOCKED'
    }
  })
  syncBuiltinESMExports()
  try {
    const observation = createWindowsPaperProcessSessionLockObserver(provider(root)).observe()
    assert.equal(observation.activeSessionLockObserved, false)
    assert.equal(calls, 2)
  } finally {
    Object.defineProperty(childProcess, 'execFileSync', { configurable: true, value: original })
    syncBuiltinESMExports()
    await rm(root, { recursive: true, force: true })
  }
})

test('Windows session-lock observer sanitize malformed, oversized, changing và command errors', {
  skip: process.platform === 'win32' ? false : 'Slice hiện chỉ hỗ trợ Windows file locking'
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'botchecker-paper-lock-command-'))
  const world = path.join(root, 'world')
  await mkdir(world)
  await writeFile(path.join(world, 'session.lock'), Buffer.from('☃', 'utf8'))
  const original = childProcess.execFileSync
  const cases: Array<Array<string | Error>> = [
    ['UNLOCKED\n'],
    ['X'.repeat(1025)],
    ['UNLOCKED', 'LOCKED'],
    [new Error('secret/powershell/path')]
  ]
  try {
    for (const outputs of cases) {
      let index = 0
      Object.defineProperty(childProcess, 'execFileSync', {
        configurable: true,
        value: () => {
          const output = outputs[Math.min(index, outputs.length - 1)]!
          index += 1
          if (output instanceof Error) throw output
          return output
        }
      })
      syncBuiltinESMExports()
      assert.throws(
        () => createWindowsPaperProcessSessionLockObserver(provider(root)).observe(),
        error => {
          assert.equal(error instanceof PaperProcessSessionLockObservationError, true)
          assert.match(String(error), sanitized)
          assert.equal(String(error).includes('secret'), false)
          return true
        }
      )
    }
  } finally {
    Object.defineProperty(childProcess, 'execFileSync', { configurable: true, value: original })
    syncBuiltinESMExports()
    await rm(root, { recursive: true, force: true })
  }
})
