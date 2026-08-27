import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { TestRun } from '../src/runner.js'
import { scenarioSchema } from '../src/scenario.js'

class StateBot extends EventEmitter {
  currentWindow: object | null = null
  entity = { position: { x: 0, y: 64, z: 0 } }
  health = 20
  food = 20
  version = '1.21.11'
  protocolVersion = '774'
  game = { dimension: 'minecraft:overworld' }
  pathfinder = { stop: () => {}, setMovements: () => {} }

  loadPlugin(): void {}
  closeWindow(): void { this.currentWindow = null }
  quit(): void { queueMicrotask(() => this.emit('end', 'quit')) }
}

const minecraft = { host: 'localhost', port: 25565, username: 'tester', auth: 'offline' as const }

async function runStateScenario(bot: StateBot, steps: unknown[]) {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-assert-state-polling-'))
  const scenario = scenarioSchema.parse({ name: 'assert_state polling', maxDurationMs: 1_000, steps })
  const run = new TestRun(scenario, minecraft, reportDir, {
    createBot: () => bot as never,
    prepareNavigation: () => {},
    connectTimeoutMs: 100,
    disconnectTimeoutMs: 100
  })
  try {
    const started = run.start()
    bot.emit('spawn')
    await started
    return run
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
}

test('assert_state polls GUI closed predicate until timeout window observes close', async () => {
  const bot = new StateBot()
  bot.currentWindow = { id: 5, type: 'minecraft:generic_9x1', title: 'Closing soon', slots: [] }
  setTimeout(() => {
    bot.currentWindow = null
    bot.emit('windowClose', { title: 'Closing soon' })
  }, 25)

  const run = await runStateScenario(bot, [
    { id: 'closed-eventually', action: 'assert_state', gui: 'closed', timeoutMs: 100 }
  ])

  assert.equal(run.status, 'passed')
  assert.equal(run.steps[0]?.status, 'passed')
  assert.deepEqual(run.steps[0]?.evidence, { health: 20, food: 20, gui: 'closed' })
})

test('assert_state polls health food and GUI predicates together before passing', async () => {
  const bot = new StateBot()
  bot.health = 18
  bot.food = 19
  bot.currentWindow = null
  setTimeout(() => {
    bot.health = 20
    bot.food = 20
    bot.currentWindow = { id: 6, type: 'minecraft:generic_9x1', title: 'Ready', slots: [] }
    bot.emit('windowOpen', bot.currentWindow)
  }, 25)

  const run = await runStateScenario(bot, [
    { id: 'ready-eventually', action: 'assert_state', minimumHealth: 20, minimumFood: 20, gui: 'open', timeoutMs: 120 }
  ])

  assert.equal(run.status, 'passed')
  assert.deepEqual(run.steps[0]?.evidence, { health: 20, food: 20, gui: 'open' })
})

test('assert_state timeout keeps last observed state evidence and failure reason', async () => {
  const bot = new StateBot()
  bot.health = 12
  bot.food = 11
  bot.currentWindow = { id: 7, type: 'minecraft:generic_9x1', title: 'Still open', slots: [] }

  const run = await runStateScenario(bot, [
    { id: 'closed-timeout', action: 'assert_state', minimumHealth: 20, minimumFood: 20, gui: 'closed', timeoutMs: 40 }
  ])

  assert.equal(run.status, 'failed')
  assert.match(run.steps[0]?.message ?? '', /Expected health >= 20, found 12/)
  assert.match(run.steps[0]?.message ?? '', /Expected food >= 20, found 11/)
  assert.match(run.steps[0]?.message ?? '', /Expected GUI closed, found open/)
  const evidence = run.steps[0]?.evidence as { health?: number; food?: number; gui?: string; elapsedMs?: number; failures?: string[] }
  assert.deepEqual(evidence.failures, [
    'Expected health >= 20, found 12',
    'Expected food >= 20, found 11',
    'Expected GUI closed, found open'
  ])
  assert.equal(evidence.health, 12)
  assert.equal(evidence.food, 11)
  assert.equal(evidence.gui, 'open')
  assert.ok((evidence.elapsedMs ?? 0) >= 0)
})

test('assert_state polling kết thúc bằng failure evidence khi step timeout abort', async () => {
  const bot = new StateBot()
  bot.currentWindow = { id: 8, type: 'minecraft:generic_9x1', title: 'Never closes', slots: [] }

  const run = await runStateScenario(bot, [
    { id: 'short-timeout', action: 'assert_state', gui: 'closed', timeoutMs: 30 }
  ])

  assert.equal(run.status, 'failed')
  assert.equal(run.steps.length, 1)
  assert.equal(run.steps[0]?.status, 'failed')
  assert.match(run.steps[0]?.message ?? '', /Expected GUI closed, found open/)
  assert.deepEqual((run.steps[0]?.evidence as { failures?: string[] }).failures, [
    'Expected GUI closed, found open'
  ])
})

test('assert_state uses a dedicated fast cadence without densifying every runner poll', async () => {
  const source = await readFile(new URL('../src/runner.ts', import.meta.url), 'utf8')

  assert.match(source, /case 'assert_state':[\s\S]*?}, signal, 10\)/)
  assert.match(source, /timeout => stepController\.abort\(timeout\)/)
  assert.match(source, /private async poll<[\s\S]*?intervalMs = 100[\s\S]*?await wait\(intervalMs, signal\)/)
})
