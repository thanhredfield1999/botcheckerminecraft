import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { TestRun } from '../src/runner.js'
import { scenarioSchema } from '../src/scenario.js'

class GuiBot extends EventEmitter {
  currentWindow: object | null = null
  entity = { position: { x: 0, y: 64, z: 0 } }
  health = 20
  food = 20
  version = '1.21.11'
  protocolVersion = '774'
  game = { dimension: 'minecraft:overworld' }
  pathfinder = { stop: () => {}, setMovements: () => {} }
  clickedSlots: number[] = []

  loadPlugin(): void {}
  closeWindow(): void { this.currentWindow = null }
  quit(): void { queueMicrotask(() => this.emit('end', 'quit')) }
  simpleClick = {
    leftMouse: async (slot: number) => { this.clickedSlots.push(slot) },
    rightMouse: async (slot: number) => { this.clickedSlots.push(slot) }
  }
}

const minecraft = { host: 'localhost', port: 25565, username: 'tester', auth: 'offline' as const }

async function runGuiAssertion(
  scenario: ReturnType<typeof scenarioSchema.parse>,
  window: object
): Promise<TestRun> {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-assert-gui-findings-'))
  const bot = new GuiBot()
  bot.currentWindow = window
  const run = new TestRun(scenario, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })
  const started = run.start()
  bot.emit('spawn')
  await started
  await rm(reportDir, { recursive: true, force: true })
  return run
}

test('assert_gui nameIncludes chỉ xét material, displayName và customName', async () => {
  const scenario = scenarioSchema.parse({
    name: 'name source', maxDurationMs: 1_000,
    steps: [{ id: 'payment-ready', action: 'assert_gui', timeoutMs: 25, items: [{ nameIncludes: 'Thanh toán' }] }]
  })
  const run = await runGuiAssertion(scenario, {
    id: 10, type: 'minecraft:generic_9x1', title: 'Thanh toán',
    slots: [{ slot: 0, name: 'paper', displayName: 'Xác nhận', count: 1, customLore: ['Thanh toán'], nbt: undefined }]
  })

  assert.equal(run.status, 'failed')
  assert.deepEqual(run.steps[0]?.evidence, {
    reason: 'selector mismatch',
    gui: {
      id: 10, type: 'minecraft:generic_9x1', title: 'Thanh toán', slotCount: 1,
      items: [{ slot: 0, material: 'paper', displayName: 'Xác nhận', lore: ['Thanh toán'], count: 1 }]
    }
  })
})

test('assert_gui lưu evidence cuối cùng đã sanitize khi selector mismatch', async () => {
  const scenario = scenarioSchema.parse({
    name: 'GUI evidence', maxDurationMs: 1_000,
    steps: [{ id: 'payment-ready', action: 'assert_gui', timeoutMs: 25, items: [{ nameIncludes: 'Thanh toán' }] }]
  })
  const run = await runGuiAssertion(scenario, {
    id: 10, type: 'minecraft:generic_9x1', title: 'Thanh toán\u0000'.repeat(100),
    slots: [{
      slot: 0, name: 'paper', displayName: 'Xác nhận', count: 1,
      customLore: ['Lore an toàn\u0000'.repeat(100)],
      components: { raw: 'COMPONENT_SECRET' }, nbt: { raw: 'NBT_SECRET' }
    }]
  })

  const step = run.steps[0]
  assert.equal(step?.status, 'failed')
  const evidence = step?.evidence as { reason?: string; gui?: { title?: string; items?: Array<{ lore?: string[] }> } }
  assert.equal(evidence.reason, 'selector mismatch')
  assert.ok((evidence.gui?.title?.length ?? Infinity) <= 256)
  assert.ok((evidence.gui?.items?.[0]?.lore?.[0]?.length ?? Infinity) <= 256)
  const serialized = JSON.stringify(run.report())
  assert.doesNotMatch(serialized, /COMPONENT_SECRET|NBT_SECRET|\\u0000/)
})

test('assert_gui từ chối selector overlap thay vì dùng một item hai lần', async () => {
  const scenario = scenarioSchema.parse({
    name: 'GUI overlap', maxDurationMs: 1_000,
    steps: [{
      id: 'payment-ready', action: 'assert_gui', timeoutMs: 25,
      items: [{ nameIncludes: 'Xác nhận' }, { nameIncludes: 'thanh toán' }]
    }]
  })
  const run = await runGuiAssertion(scenario, {
    id: 10, type: 'minecraft:generic_9x1', title: 'Thanh toán',
    slots: [{ slot: 0, name: 'paper', displayName: 'Xác nhận thanh toán', count: 1, customLore: [], nbt: undefined }]
  })

  assert.equal(run.status, 'failed')
  assert.deepEqual(run.steps[0]?.evidence, {
    reason: 'selector overlap',
    gui: {
      id: 10, type: 'minecraft:generic_9x1', title: 'Thanh toán', slotCount: 1,
      items: [{ slot: 0, material: 'paper', displayName: 'Xác nhận thanh toán', lore: [], count: 1 }]
    }
  })
})

test('assert_gui tìm được item ở slot vượt giới hạn evidence', async () => {
  const scenario = scenarioSchema.parse({
    name: 'large GUI', maxDurationMs: 1_000,
    steps: [{ id: 'late-slot', action: 'assert_gui', timeoutMs: 25, items: [{ slot: 80, nameIncludes: 'Thanh toán' }] }]
  })
  const slots = Array.from({ length: 90 }, (_, slot) => ({
    slot, name: 'paper', displayName: slot === 80 ? 'Thanh toán' : `Item ${slot}`, count: 1, customLore: []
  }))
  const run = await runGuiAssertion(scenario, {
    id: 10, type: 'minecraft:generic_9x6', title: 'Thanh toán', slots
  })

  assert.equal(run.status, 'passed')
  assert.equal(run.steps[0]?.status, 'passed')
  const evidence = run.steps[0]?.evidence as { gui: { slotCount: number; items: Array<{ slot: number }> }; matchedItems: Array<{ slot: number }> }
  assert.equal(evidence.gui.slotCount, 90)
  assert.equal(evidence.gui.items.length, 64)
  assert.equal(evidence.gui.items.some(item => item.slot === 80), false)
  assert.deepEqual(evidence.matchedItems, [{ slot: 80, material: 'paper', displayName: 'Thanh toán', lore: [], count: 1 }])
})

test('click_gui click được slot vượt giới hạn evidence sau khi inspect', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-click-late-slot-'))
  const bot = new GuiBot()
  const slots = Array.from({ length: 90 }, (_, slot) => ({
    slot, name: 'paper', displayName: slot === 80 ? 'Thanh toán' : `Item ${slot}`, count: 1, customLore: []
  }))
  bot.currentWindow = { id: 10, type: 'minecraft:generic_9x6', title: 'Thanh toán', slots }
  const scenario = scenarioSchema.parse({
    name: 'large GUI click', maxDurationMs: 1_000,
    steps: [{ id: 'late-slot', action: 'click_gui', slot: 80, inspectDelayMs: 0 }]
  })
  const run = new TestRun(scenario, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {}, connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  const started = run.start()
  bot.emit('spawn')
  await started
  await rm(reportDir, { recursive: true, force: true })

  assert.equal(run.status, 'passed')
  assert.deepEqual(bot.clickedSlots, [80])
})
