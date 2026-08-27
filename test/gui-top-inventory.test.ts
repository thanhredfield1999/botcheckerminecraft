import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { TestRun } from '../src/runner.js'
import { scenarioSchema } from '../src/scenario.js'
import { formatGuiSnapshot, snapshotGui } from '../src/snapshot.js'

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

function windowFixture(type: string, topSlotCount: number, totalSlotCount: number): object {
  const slots: Array<object | null> = Array.from({ length: totalSlotCount }, () => null)
  slots[0] = { slot: 0, name: 'diamond_sword', displayName: 'UX Sword 001', count: 1, customLore: [] }
  slots[topSlotCount] = { slot: topSlotCount, name: 'diamond_sword', displayName: 'Player Sword', count: 1, customLore: [] }
  return { id: 7, type, title: 'ItemGuard', inventoryStart: topSlotCount, inventoryEnd: totalSlotCount, slots }
}

test('snapshotGui tách top container khỏi player inventory theo inventoryStart', () => {
  for (const [type, top, total] of [
    ['minecraft:generic_9x1', 9, 45],
    ['minecraft:generic_9x6', 54, 90],
    ['minecraft:generic_9x3', 27, 63],
    ['minecraft:hopper', 5, 41],
    ['minecraft:inventory', 9, 46]
  ] as const) {
    const gui = snapshotGui({ currentWindow: windowFixture(type, top, total) } as never)
    assert.ok(gui)
    assert.equal(gui.topSlotCount, top)
    assert.equal(gui.totalSlotCount, total)
    assert.equal(gui.inventoryStart, top)
    assert.equal(gui.slotCount, total)
    assert.equal(gui.items[0]?.section, 'top')
    assert.equal(gui.items[1]?.section, 'player')
    assert.match(formatGuiSnapshot(gui), new RegExp(`${top} top / ${total} total`))
  }
})

test('assert_gui kiểm topSlotCount, cardinality, absence và empty slot trong top inventory', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-gui-top-assert-'))
  const bot = new GuiBot()
  const slots: Array<object | null> = Array.from({ length: 90 }, () => null)
  for (let slot = 0; slot < 28; slot++) {
    slots[slot] = { slot, name: 'diamond_sword', displayName: `UX Staff Sword ${slot + 1}`, count: 1, customLore: [] }
  }
  slots[53] = { slot: 53, name: 'arrow', displayName: 'Trang sau', count: 1, customLore: [] }
  slots[54] = { slot: 54, name: 'diamond_sword', displayName: 'Player Sword', count: 1, customLore: [] }
  bot.currentWindow = { id: 8, type: 'minecraft:generic_9x6', title: 'ItemGuard - Browser', inventoryStart: 54, inventoryEnd: 90, slots }
  const scenario = scenarioSchema.parse({
    name: 'ItemGuard page 1 cardinality',
    maxDurationMs: 1_000,
    steps: [{
      id: 'page-1', action: 'assert_gui', topSlotCount: 54, timeoutMs: 100,
      items: [
        { material: 'diamond_sword', section: 'top', exactly: 28 },
        { material: 'arrow', section: 'top', nameIncludes: 'Trang sau', exactly: 1 },
        { material: 'barrier', section: 'top', absent: true },
        { slot: 52, section: 'top', slotEmpty: true }
      ]
    }]
  })
  const run = new TestRun(scenario, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    await started
    assert.equal(run.status, 'passed')
    const evidence = run.steps[0]?.evidence as { selectorMatches?: Array<{ matchCount: number }> }
    assert.deepEqual(evidence.selectorMatches?.map(match => match.matchCount), [28, 1, 0, 0])
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('click_gui mặc định chặn player inventory và chỉ cho phép khi section player explicit', async () => {
  async function runClick(section?: 'player'): Promise<{ run: TestRun; bot: GuiBot }> {
    const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-gui-section-click-'))
    const bot = new GuiBot()
    bot.currentWindow = windowFixture('minecraft:generic_9x1', 9, 45)
    const scenario = scenarioSchema.parse({
      name: 'section click', maxDurationMs: 1_000,
      steps: [{ id: 'click', action: 'click_gui', slot: 9, ...(section ? { section } : {}), inspectDelayMs: 0, timeoutMs: 100 }]
    })
    const run = new TestRun(scenario, minecraft, reportDir, {
      createBot: () => bot as never, prepareNavigation: () => {}, connectTimeoutMs: 100, disconnectTimeoutMs: 100
    })
    const started = run.start()
    bot.emit('spawn')
    await started
    await rm(reportDir, { recursive: true, force: true })
    return { run, bot }
  }

  const blocked = await runClick()
  assert.equal(blocked.run.status, 'failed')
  assert.deepEqual(blocked.bot.clickedSlots, [])
  assert.match(blocked.run.steps[0]?.message ?? '', /top inventory/i)

  const explicit = await runClick('player')
  assert.equal(explicit.run.status, 'passed')
  assert.deepEqual(explicit.bot.clickedSlots, [9])
})
