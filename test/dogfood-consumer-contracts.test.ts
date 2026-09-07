import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Vec3 } from 'vec3'
import { TestRun } from '../src/runner.js'
import { scenarioSchema } from '../src/scenario.js'
import { CrossingTracker } from '../src/crossing.js'

// Consumer contract probes only: injected protocol state, never target-plugin/Paper evidence.
class ConsumerBot extends EventEmitter {
  currentWindow = null
  health = 20
  food = 20
  version = '1.21.11'
  protocolVersion = '774'
  game = { dimension: 'minecraft:overworld' }
  entity = { position: new Vec3(0, 64, 0) }
  entities = {}
  pathfinder = { stop: () => {}, setMovements: () => {} }
  held = { name: 'paper', displayName: 'Paper', customName: { text: 'Mảnh Thành Trì' }, slot: 9, count: 1 }
  inventory = { slots: [...Array(9).fill(null), this.held], items: () => [this.held], selectedItem: null }
  loadPlugin(): void {}
  closeWindow(): void {}
  quit(): void { queueMicrotask(() => this.emit('end', 'quit')) }
}

async function probe(steps: unknown[], stimulate: (run: TestRun, bot: ConsumerBot) => void) {
  const directory = await mkdtemp(path.join(tmpdir(), 'bc-consumer-contract-'))
  const bot = new ConsumerBot()
  const run = new TestRun(scenarioSchema.parse({ name: 'offline-consumer-contract', steps, maxDurationMs: 5_000 }), {
    host: 'localhost', port: 25565, username: 'injected-fixture', auth: 'offline'
  }, directory, {
    createBot: () => bot as never,
    prepareNavigation: () => queueMicrotask(() => stimulate(run, bot)),
    connectTimeoutMs: 1000, disconnectTimeoutMs: 100
  })
  try {
    const pending = run.start()
    bot.emit('spawn')
    await pending
    return run
  } finally { await rm(directory, { recursive: true, force: true }) }
}

function textOnStep(run: TestRun, bot: ConsumerBot, messages: Record<string, string>) {
  const seam = run as unknown as {
    record(type: string, summary: string, data?: unknown): void
  }
  const record = seam.record.bind(run)
  seam.record = (type, summary, data) => {
    record(type, summary, data)
    if (type === 'step_start') {
      const id = summary.split(':')[0]
      if (messages[id] !== undefined) queueMicrotask(() => bot.emit('messagestr', messages[id]))
    }
  }
}

test('consumer VillageDefense: inventory exactly detects duplicated reward count', async () => {
  for (const count of [1, 2]) {
    const run = await probe([
      { id: 'settle', action: 'wait', durationMs: 0 },
      { id: 'reward-count', action: 'assert_inventory', itemIncludes: 'paper', exactly: 1 }
    ], (_run, bot) => { bot.held.count = count })
    assert.equal(run.status, count === 1 ? 'passed' : 'failed')
  }
})

test('consumer LivingNPC: body-width oracle rejects edge collision and accepts center', () => {
  for (const lateral of [0, 0.49]) {
    const tracker = new CrossingTracker({
      approach: { x: 0, y: 64, z: 0 }, exit: { x: 0, y: 64, z: 10 },
      corridorHalfWidth: 0.6, entityHalfWidth: 0.3, entryClearance: 0.3, exitClearance: 0.3,
      verticalTolerance: 1, requiredExitSamples: 2, planeEpsilon: 0.1, maxStepDistance: 1.75, exitDwellMs: 300
    })
    let result = tracker.observe({ x: lateral, y: 64, z: 3 }, 0)
    for (const [z, time] of [[4.5, 200], [5.5, 400], [6.5, 600], [7.5, 800]]) {
      result = tracker.observe({ x: lateral, y: 64, z }, time)
    }
    assert.equal(result.crossed, lateral === 0)
  }
})

test('consumer ItemGuard: capture compares fresh displayed code, not PDC identity', async () => {
  for (const code of ['ABCD', 'WXYZ']) {
    const run = await probe([
      { id: 'settle', action: 'wait', durationMs: 0 },
      { id: 'before', action: 'capture', name: 'code', pattern: 'Ma so: ([A-Z]+)', source: 'chat', timeoutMs: 1000 },
      { id: 'after', action: 'assert_capture', name: 'code', pattern: 'Ma so: ([A-Z]+)', source: 'chat', timeoutMs: 1000 }
    ], (run, bot) => textOnStep(run, bot, { before: 'Ma so: ABCD', after: `Ma so: ${code}` }))
    assert.equal(run.status, code === 'ABCD' ? 'passed' : 'failed')
  }
})

test('consumer RestaurantTycoon: capture equals false detects visible state transition', async () => {
  for (const state of ['PAID', 'PENDING']) {
    const run = await probe([
      { id: 'settle', action: 'wait', durationMs: 0 },
      { id: 'before', action: 'capture', name: 'state', pattern: 'State: ([A-Z]+)', source: 'chat', timeoutMs: 1000 },
      { id: 'after', action: 'assert_capture', name: 'state', pattern: 'State: ([A-Z]+)', equals: false, source: 'chat', timeoutMs: 1000 }
    ], (run, bot) => textOnStep(run, bot, { before: 'State: PENDING', after: `State: ${state}` }))
    assert.equal(run.status, state === 'PAID' ? 'passed' : 'failed')
  }
})

test('consumer BastionForge: inventory matches custom component name in NFC', async () => {
  const run = await probe([
    { id: 'material', action: 'assert_inventory', itemIncludes: 'Mảnh Thành Trì'.normalize('NFD'), exactly: 1 }
  ], () => {})
  assert.equal(run.status, 'passed')
})
