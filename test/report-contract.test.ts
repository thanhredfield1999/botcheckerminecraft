import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { TestRun } from '../src/runner.js'
import { scenarioSchema } from '../src/scenario.js'

class ReportBot extends EventEmitter {
  currentWindow: object | null = null
  entity = { position: { x: 1, y: 64, z: 2 } }
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

const minecraft = {
  host: '127.0.0.1', port: 25565, username: 'tester', auth: 'offline' as const,
  password: 'khong-duoc-ghi-vao-report', version: '1.21.11'
}

async function execute(message: string) {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-report-contract-'))
  const bot = new ReportBot()
  const scenario = scenarioSchema.parse({
    name: 'report contract',
    maxDurationMs: 1_000,
    steps: [{ id: 'oracle', action: 'wait_for_text', text: message, source: 'chat', timeoutMs: 20 }]
  })
  const run = new TestRun(scenario, minecraft, reportDir, {
    createBot: () => bot as never,
    prepareNavigation: () => {},
    connectTimeoutMs: 100,
    disconnectTimeoutMs: 100,
    sourceRevision: 'abc123'
  })
  const started = run.start()
  bot.emit('spawn')
  await started
  return { run, reportDir }
}

test('report phân biệt lỗi assertion thành FAIL', async () => {
  const { run, reportDir } = await execute('khong-xuat-hien')
  try {
    assert.equal(run.steps[0]?.verdict, 'FAIL')
    assert.equal(run.report().verdict, 'FAIL')
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('manifest ghi provenance ổn định và loại credentials', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-manifest-'))
  const bot = new ReportBot()
  const scenario = scenarioSchema.parse({
    name: 'manifest success', maxDurationMs: 1_000,
    steps: [{ id: 'done', action: 'wait', durationMs: 0 }]
  })
  const run = new TestRun(scenario, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100,
    sourceRevision: 'abc123'
  })
  try {
    const started = run.start()
    bot.emit('spawn')
    await started
    const report = run.report()

    assert.equal(report.verdict, 'PASS')
    assert.equal(report.steps[0]?.verdict, 'PASS')
    assert.equal(report.manifest.schemaVersion, 1)
    assert.deepEqual(report.manifest.runner, {
      name: 'botcheckerminecraft', version: '0.1.0', sourceRevision: 'abc123'
    })
    assert.equal(report.manifest.scenario.name, 'manifest success')
    assert.match(report.manifest.scenario.sha256, /^[a-f0-9]{64}$/)
    assert.deepEqual(report.manifest.target, {
      host: '127.0.0.1', port: 25565, configuredVersion: '1.21.11'
    })
    assert.deepEqual(report.manifest.observed, {
      negotiatedVersion: '1.21.11', protocolVersion: '774',
      serverWorld: 'StillCliff', dimension: 'overworld'
    })
    const serialized = JSON.stringify(report)
    assert.doesNotMatch(serialized, /khong-duoc-ghi-vao-report|"password"|"username"/)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})
