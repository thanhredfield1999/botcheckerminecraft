import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { TestRun } from '../src/runner.js'
import { scenarioSchema } from '../src/scenario.js'

const multiAccountResult = {
  verdict: 'PASS' as const,
  plan: {
    verdict: 'PASS' as const, project: 'ExamplePlugin', fixture: 'paper-fixture-1',
    authorization: ['isolated-fixture'], maxConcurrent: 1 as const,
    accounts: [{ accountRef: 'account-player', role: 'player', order: 1, status: 'READY' as const }]
  },
  accounts: [{ accountRef: 'account-player', role: 'player', order: 1, verdict: 'PASS' as const, message: 'ok', evidence: { mutationCount: 0 } }]
}

class BotStub extends EventEmitter {
  currentWindow: object | null = null
  entity = { position: { x: 0, y: 64, z: 0 } }
  health = 20
  food = 20
  version = '1.21.11'
  protocolVersion = '774'
  game = { dimension: 'minecraft:overworld' }
  _getDimensionName = () => 'StillCliff'
  pathfinder = { stop: () => {}, setMovements: () => {} }
  loadPlugin(): void {}
  closeWindow(): void {}
  quit(): void { queueMicrotask(() => this.emit('end', 'quit')) }
}

test('manifest liên kết side before/after của persistence execution', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-qa-execution-'))
  const bot = new BotStub()
  const scenario = scenarioSchema.parse({
    name: 'persistence side',
    qa: {
      project: 'ExamplePlugin', fixture: 'paper-fixture-1', accountRole: 'player',
      authorization: ['read-only'], phase: 'persistence'
    },
    steps: [{ id: 'done', action: 'wait', durationMs: 0 }]
  })
  const run = new TestRun(scenario, {
    host: '127.0.0.1', port: 25565, username: 'tester', auth: 'offline', version: '1.21.11'
  }, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100,
    qaExecution: {
      executionId: 'exec-1', beforeRunId: 'run-before', afterRunId: 'run-after', side: 'before'
    }
  })
  try {
    const started = run.start()
    bot.emit('spawn')
    await started
    assert.deepEqual(run.report().manifest.qa?.execution, {
      executionId: 'exec-1', beforeRunId: 'run-before', afterRunId: 'run-after', side: 'before'
    })
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

void assert
