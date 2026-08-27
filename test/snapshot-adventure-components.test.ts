import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
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

  loadPlugin(): void {}
  closeWindow(): void { this.currentWindow = null }
  quit(): void { queueMicrotask(() => this.emit('end', 'quit')) }
}

const minecraft = { host: 'localhost', port: 25565, username: 'tester', auth: 'offline' as const }
const require = createRequire(import.meta.url)

function componentWindow(): object {
  const prismarineLikeName = {
    toJSON: () => ({ text: 'Quay ', extra: [{ text: 'lại' }] })
  }
  const nestedLore = [
    { text: 'Mã: ', extra: [{ text: '#UXS001' }] },
    {
      translate: 'itemguard.history.owner',
      with: ['Chủ: ', { text: 'ItemGuardStaffUX' }, { text: ' | ' }, { text: 'Phát hiện: 1 lần' }]
    }
  ]
  return {
    id: 7,
    type: 'minecraft:generic_9x1',
    title: { text: 'ItemGuard - ', extra: [{ text: 'Lịch Sử Item', color: 'gold', bold: true }] },
    slots: [
      { slot: 0, name: 'arrow', displayName: 'minecraft:arrow', customName: prismarineLikeName, customLore: ['string lore'], count: 1 },
      {
        slot: 1,
        name: 'diamond_sword',
        displayName: { text: 'UX Staff ', extra: [{ text: 'Sword 001' }] },
        customName: { text: 'Đóng' },
        customLore: nestedLore,
        count: 1
      }
    ]
  }
}

test('snapshotGui decodes captured-shaped Adventure components to ordered plain text', () => {
  const bot = { currentWindow: componentWindow() }
  const gui = snapshotGui(bot as never)

  assert.ok(gui)
  assert.equal(gui.title, 'ItemGuard - Lịch Sử Item')
  assert.equal(gui.items[0]?.customName, 'Quay lại')
  assert.deepEqual(gui.items[1], {
    slot: 1,
    section: 'top',
    material: 'diamond_sword',
    displayName: 'UX Staff Sword 001',
    customName: 'Đóng',
    lore: ['Mã: #UXS001', 'itemguard.history.owner Chủ: ItemGuardStaffUX | Phát hiện: 1 lần'],
    count: 1
  })
  assert.doesNotMatch(formatGuiSnapshot(gui), /\[object Object\]/)
})

test('snapshotGui decodes the installed prismarine-chat ChatMessage shape', () => {
  const registry = require('prismarine-registry')('1.21.11')
  const ChatMessage = require('prismarine-chat')(registry)
  const gui = snapshotGui({
    currentWindow: {
      id: 11,
      type: 'minecraft:generic_9x1',
      title: new ChatMessage({ text: 'ItemGuard - ', extra: [{ text: 'Lịch Sử Item' }] }),
      slots: [{
        slot: 0,
        name: 'arrow',
        displayName: 'minecraft:arrow',
        customName: new ChatMessage({ text: 'Quay ', extra: [{ text: 'lại' }] }),
        customLore: [new ChatMessage({ text: 'Mã: ', extra: [{ text: '#UXS001' }] })],
        count: 1
      }]
    }
  } as never)

  assert.equal(gui?.title, 'ItemGuard - Lịch Sử Item')
  assert.equal(gui?.items[0]?.customName, 'Quay lại')
  assert.deepEqual(gui?.items[0]?.lore, ['Mã: #UXS001'])
})

test('snapshotGui decodes protocol 774 prismarine-nbt wrapped GUI components', () => {
  const stringTag = (value: string) => ({ type: 'string', value })
  const compoundTag = (value: Record<string, unknown>) => ({ type: 'compound', value })
  const compoundListTag = (value: Record<string, unknown>[]) => ({
    type: 'list',
    value: { type: 'compound', value }
  })
  const component = (text: string, extra: Record<string, unknown>[] = []) => compoundTag({
    text: stringTag(text),
    ...(extra.length > 0 ? { extra: compoundListTag(extra) } : {})
  })
  const child = (text: string) => ({ text: stringTag(text) })

  const gui = snapshotGui({
    currentWindow: {
      id: 13,
      type: 'minecraft:generic_9x6',
      inventoryStart: 54,
      title: component('ItemGuard - Lich Su Item ', [child('(Trang 1/1)')]),
      slots: [{
        slot: 10,
        name: 'lime_dye',
        displayName: 'Lime Dye',
        customName: component('', [child('Nhat len '), child('#1')]),
        customLore: [
          component('', [child('Nguoi choi: '), child('IGMemberUX')]),
          component('', [child('Ma: '), child('#UM0001')])
        ],
        count: 1
      }, {
        slot: 49,
        name: 'arrow',
        displayName: 'Arrow',
        customName: component('', [child('Quay lại')]),
        customLore: [],
        count: 1
      }]
    }
  } as never)

  assert.equal(gui?.title, 'ItemGuard - Lich Su Item (Trang 1/1)')
  assert.equal(gui?.items[0]?.customName, 'Nhat len #1')
  assert.deepEqual(gui?.items[0]?.lore, ['Nguoi choi: IGMemberUX', 'Ma: #UM0001'])
  assert.equal(gui?.items[1]?.customName, 'Quay lại')
})

test('snapshotGui bounds and sanitizes component text without leaking object strings', () => {
  const longComponent = { text: `${'A'.repeat(400)}\u0000${'B'.repeat(400)}` }
  const bot = {
    currentWindow: {
      id: 8,
      type: 'minecraft:generic_9x1',
      title: longComponent,
      slots: [{ slot: 0, name: 'paper', displayName: longComponent, customName: longComponent, customLore: Array.from({ length: 20 }, () => longComponent), count: 1 }]
    }
  }

  const gui = snapshotGui(bot as never)
  assert.ok(gui)
  const serialized = JSON.stringify(gui)
  assert.doesNotMatch(serialized, /\[object Object\]|\\u0000/)
  assert.ok(gui.title.length > 256)
  assert.ok((gui.items[0]?.displayName.length ?? 0) > 256)
  assert.ok(((gui.items[0]?.customName)?.length ?? 0) > 256)
  assert.equal(gui.items[0]?.lore.length, 20)
  assert.ok(gui.items[0]?.lore.some(line => line.length > 256))
})

test('snapshotGui treats reused component objects as repeated text instead of cycles', () => {
  const shared = { text: 'lặp' }
  const gui = snapshotGui({
    currentWindow: {
      id: 9,
      type: 'minecraft:generic_9x1',
      title: { extra: [shared, { text: ' / ' }, shared] },
      slots: []
    }
  } as never)

  assert.equal(gui?.title, 'lặp / lặp')
})

test('snapshotGui hard-bounds internal selector text and lore traversal', () => {
  const huge = { text: 'x'.repeat(20_000) }
  const gui = snapshotGui({
    currentWindow: {
      id: 10,
      type: 'minecraft:generic_9x1',
      title: huge,
      slots: [{
        slot: 0,
        name: 'paper',
        displayName: huge,
        customLore: Array.from({ length: 200 }, () => huge),
        count: 1
      }]
    }
  } as never)

  assert.ok(gui)
  assert.ok(gui.title.length <= 4_096)
  assert.ok((gui.items[0]?.displayName.length ?? Infinity) <= 4_096)
  assert.equal(gui.items[0]?.lore.length, 64)
  assert.ok(gui.items[0]?.lore.every(line => line.length <= 4_096))
})

test('snapshotGui bounds component node traversal even when nodes render empty text', () => {
  let visited = 0
  const children = Array.from({ length: 10_000 }, () => ({
    toJSON: () => {
      visited++
      return {}
    }
  }))

  snapshotGui({
    currentWindow: {
      id: 12,
      type: 'minecraft:generic_9x1',
      title: { extra: children },
      slots: []
    }
  } as never)

  assert.ok(visited <= 512, `visited ${visited} component nodes`)
})

test('assert_gui title/name/lore selectors match decoded Adventure component text', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-adventure-components-'))
  const bot = new GuiBot()
  bot.currentWindow = componentWindow()
  const scenario = scenarioSchema.parse({
    name: 'Adventure selectors',
    maxDurationMs: 1_000,
    steps: [{
      id: 'history-detail',
      action: 'assert_gui',
      timeoutMs: 50,
      titleIncludes: 'Lịch Sử Item',
      items: [{ nameIncludes: 'Quay lại' }, { loreIncludes: '#UXS001' }]
    }]
  })
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

    assert.equal(run.status, 'passed')
    assert.equal(run.steps[0]?.status, 'passed')
    assert.doesNotMatch(JSON.stringify(run.report()), /\[object Object\]/)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('assert_gui chuẩn hóa NFC cho title, name và lore selectors', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-gui-unicode-nfc-'))
  const bot = new GuiBot()
  bot.currentWindow = {
    id: 12,
    type: 'minecraft:generic_9x1',
    title: 'Chi tiết'.normalize('NFD'),
    slots: [{
      slot: 0,
      name: 'paper',
      displayName: 'Quay lại'.normalize('NFD'),
      customLore: ['Mã: #UXS001'.normalize('NFD')],
      count: 1
    }]
  }
  const scenario = scenarioSchema.parse({
    name: 'GUI Unicode NFC', maxDurationMs: 1_000,
    steps: [{
      id: 'detail', action: 'assert_gui', timeoutMs: 50,
      titleIncludes: 'Chi tiết',
      items: [{ nameIncludes: 'Quay lại', loreIncludes: 'Mã: #UXS001' }]
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
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('timeline GUI summary luôn bounded dù selector cần internal text dài hơn', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-gui-summary-bound-'))
  const bot = new GuiBot()
  bot.currentWindow = {
    id: 13,
    type: 'minecraft:generic_9x1',
    title: { text: 'T'.repeat(4_000) },
    slots: []
  }
  const scenario = scenarioSchema.parse({
    name: 'GUI summary bound', maxDurationMs: 1_000,
    steps: [{ id: 'done', action: 'wait', durationMs: 0 }]
  })
  const run = new TestRun(scenario, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('windowOpen', bot.currentWindow)
    bot.emit('spawn')
    await started
    assert.ok(run.report().timeline.every(event => event.summary.length <= 256))
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})
