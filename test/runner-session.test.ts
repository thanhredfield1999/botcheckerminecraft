import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { TestRun } from '../src/runner.js'
import { scenarioSchema } from '../src/scenario.js'

class FakeBot extends EventEmitter {
  currentWindow: object | null = { id: 9 }
  entity = { position: { x: 0, y: 64, z: 0 } }
  health = 20
  food = 20
  version = '1.21.11'
  protocolVersion = '774'
  game = { dimension: 'minecraft:overworld' }
  serverWorld = 'StillCliff'
  _getDimensionName = () => this.serverWorld
  gateBlock: {
    name: string
    position: { x: number; y: number; z: number; offset?: (x: number, y: number, z: number) => { x: number; y: number; z: number } }
    getProperties: () => Record<string, string | boolean>
  } = {
    name: 'spruce_door',
    position: { x: 0, y: 64, z: 0, offset: (x, y, z) => ({ x, y: 64 + y, z }) },
    getProperties: () => ({ facing: 'east', half: 'lower', open: false })
  }
  stops = 0
  closes = 0
  quits = 0
  movements = 0
  lookedAt: unknown[] = []
  activated: unknown[] = []
  clickedSlots: number[] = []
  inventoryItems: Array<{ name: string; displayName: string; count: number }> = []
  fishEffect?: () => void
  blockLookup?: (position: { x: number; y: number; z: number }) => any
  pathfinder = {
    stop: () => { this.stops++ },
    setMovements: () => { this.movements++ },
    goto: async () => {}
  }

  entities: Record<number, object> = {}
  players: Record<string, object> = {}

  loadPlugin(): void {}
  blockAt(position: { x: number; y: number; z: number }): any {
    return this.blockLookup?.(position) ?? this.gateBlock
  }
  nearestEntity(predicate: (entity: any) => boolean): any {
    return Object.values(this.entities).find(predicate)
  }
  async lookAt(position: unknown): Promise<void> { this.lookedAt.push(position) }
  async activateEntity(entity: unknown): Promise<void> { this.activated.push(entity) }
  simpleClick = {
    leftMouse: async (slot: number) => { this.clickedSlots.push(slot) },
    rightMouse: async (slot: number) => { this.clickedSlots.push(slot) }
  }
  inventory = { items: () => this.inventoryItems }
  async fish(): Promise<void> { this.fishEffect?.() }
  findBlock(): any { return this.gateBlock }
  async equip(): Promise<void> {}
  async placeBlock(): Promise<void> {}
  closeWindow(): void { this.closes++; this.currentWindow = null }
  quit(): void { this.quits++; queueMicrotask(() => this.emit('end', 'quit')) }
}

const scenario = scenarioSchema.parse({
  name: 'session cleanup',
  maxDurationMs: 1_000,
  steps: [{ id: 'complete', action: 'wait', durationMs: 0 }]
})
const minecraft = { host: 'localhost', port: 25565, username: 'tester', auth: 'offline' as const }

test('TestRun owns one bounded cleanup after a successful session', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-session-'))
  const bot = new FakeBot()
  const run = new TestRun(scenario, minecraft, reportDir, {
    createBot: () => bot as never,
    prepareNavigation: () => { bot.movements++ },
    connectTimeoutMs: 100,
    disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    await started

    assert.equal(run.status, 'passed')
    assert.deepEqual(run.events.find(event => event.type === 'spawn')?.data, {
      configuredVersion: undefined,
      negotiatedVersion: '1.21.11', protocolVersion: '774',
      dimension: 'minecraft:overworld', position: { x: 0, y: 64, z: 0 }
    })
    assert.equal(bot.movements, 1)
    assert.equal(bot.stops, 1)
    assert.equal(bot.closes, 1)
    assert.equal(bot.quits, 1)
    assert.equal(bot.listenerCount('messagestr'), 0)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('wait_for_text ignores matching text recorded before the step starts', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-fresh-text-'))
  const bot = new FakeBot()
  bot.currentWindow = null
  const freshTextScenario = scenarioSchema.parse({
    name: 'fresh text only', maxDurationMs: 1_000,
    steps: [
      { id: 'allow-old-message', action: 'wait', durationMs: 30 },
      { id: 'fresh-message', action: 'wait_for_text', text: 'quest accepted', source: 'chat', timeoutMs: 50 }
    ]
  })
  const run = new TestRun(freshTextScenario, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    setTimeout(() => bot.emit('messagestr', 'Quest accepted'), 5)
    await started

    assert.equal(run.status, 'failed')
    assert.match(run.steps[1].message, /Timeout: fresh-message/)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('windowClose ghi title GUI đã sanitize vào timeline', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-window-close-title-'))
  const bot = new FakeBot()
  const closeScenario = scenarioSchema.parse({
    name: 'sanitized window close', maxDurationMs: 1_000,
    steps: [{ id: 'wait', action: 'wait', durationMs: 30 }]
  })
  const run = new TestRun(closeScenario, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {}, connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    bot.emit('windowClose', { title: 'Thanh\u0000 toán' })
    await started

    assert.equal(run.events.find(event => event.type === 'gui_close')?.summary, 'Thanh  toán')
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('click_gui fails closed when a selector matches multiple slots', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-gui-ambiguous-'))
  const bot = new FakeBot()
  const item = (slot: number) => ({
    slot, name: 'paper', displayName: 'Quest', count: 1, customLore: ['Accept quest'], nbt: undefined
  })
  bot.currentWindow = {
    id: 9, type: 'minecraft:generic_9x1', title: 'Quest Menu',
    slots: [item(0), item(1), null, null, null, null, null, null, null]
  }
  const ambiguousGui = scenarioSchema.parse({
    name: 'ambiguous GUI', maxDurationMs: 1_000,
    steps: [{ id: 'choose-quest', action: 'click_gui', nameIncludes: 'Quest', inspectDelayMs: 0 }]
  })
  const run = new TestRun(ambiguousGui, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    await started

    assert.equal(run.status, 'failed')
    assert.match(run.steps[0].message, /2 GUI items match/)
    assert.deepEqual(bot.clickedSlots, [])
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('click_gui giữ tương thích nameIncludes tìm trong lore', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-gui-lore-name-'))
  const bot = new FakeBot()
  bot.currentWindow = {
    id: 10, type: 'minecraft:generic_9x1', title: 'Quest Menu',
    slots: [{ slot: 0, name: 'paper', displayName: 'Nhiệm vụ', count: 1, customLore: ['Accept quest'], nbt: undefined }]
  }
  const scenario = scenarioSchema.parse({
    name: 'legacy lore selector', maxDurationMs: 1_000,
    steps: [{ id: 'choose-quest', action: 'click_gui', nameIncludes: 'Accept quest', inspectDelayMs: 0 }]
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
    assert.deepEqual(bot.clickedSlots, [0])
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('click_gui tìm được lore ngoài giới hạn evidence', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-gui-long-lore-'))
  const bot = new FakeBot()
  const lore = Array.from({ length: 17 }, (_, index) => index === 16 ? `${'x'.repeat(300)} legacy target` : `Dòng ${index}`)
  bot.currentWindow = {
    id: 11, type: 'minecraft:generic_9x1', title: 'Quest Menu',
    slots: [{ slot: 0, name: 'paper', displayName: 'Nhiệm vụ', count: 1, customLore: lore, nbt: undefined }]
  }
  const scenario = scenarioSchema.parse({
    name: 'long lore selector', maxDurationMs: 1_000,
    steps: [{ id: 'choose-quest', action: 'click_gui', nameIncludes: 'legacy target', inspectDelayMs: 0 }]
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
    assert.deepEqual(bot.clickedSlots, [0])
    const evidence = run.events.find(event => event.type === 'gui_inspection')?.data as { gui: { items: Array<{ lore: string[] }> } }
    assert.equal(evidence.gui.items[0].lore.length, 16)
    assert.ok(evidence.gui.items[0].lore.every(line => line.length <= 256))
    const clickEvidence = run.steps[0]?.evidence as { item: { lore: string[] } }
    assert.equal(clickEvidence.item.lore.length, 16)
    assert.ok(clickEvidence.item.lore.every(line => line.length <= 256))
    assert.doesNotMatch(JSON.stringify(clickEvidence), /legacy target/)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('assert_gui kiểm title và item làm hậu điều kiện sau click', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-gui-postcondition-'))
  const bot = new FakeBot()
  const item = { slot: 11, name: 'lime_concrete', displayName: 'Thanh toán 25', count: 1, customLore: ['Đơn sẽ được ghi bền vững'], nbt: undefined }
  bot.currentWindow = {
    id: 10, type: 'minecraft:generic_9x3', title: 'Xác nhận thanh toán',
    slots: Array.from({ length: 27 }, (_, slot) => slot === 11 ? item : null)
  }
  const guiScenario = scenarioSchema.parse({
    name: 'GUI postcondition', maxDurationMs: 1_000,
    steps: [{
      id: 'payment-ready', action: 'assert_gui', titleIncludes: 'Xác nhận thanh toán',
      items: [{ slot: 11, nameIncludes: 'Thanh toán', loreIncludes: 'ghi bền vững', count: 1 }]
    }]
  })
  const run = new TestRun(guiScenario, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    await started

    assert.equal(run.status, 'passed')
    assert.equal(run.steps[0].status, 'passed')
    const evidence = run.steps[0].evidence as { matchedItems?: Array<{ slot?: number }> }
    assert.equal(evidence.matchedItems?.[0]?.slot, 11)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('assert_gui chờ GUI chuyển trạng thái trước khi kiểm hậu điều kiện', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-gui-transition-'))
  const bot = new FakeBot()
  bot.currentWindow = { id: 9, type: 'minecraft:generic_9x1', title: 'Đặt nguyên liệu', slots: Array(9).fill(null) }
  const guiScenario = scenarioSchema.parse({
    name: 'GUI transition', maxDurationMs: 1_000,
    steps: [{ id: 'payment-ready', action: 'assert_gui', timeoutMs: 500, titleIncludes: 'Xác nhận thanh toán' }]
  })
  const run = new TestRun(guiScenario, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    setTimeout(() => {
      bot.currentWindow = { id: 10, type: 'minecraft:generic_9x3', title: 'Xác nhận thanh toán', slots: Array(27).fill(null) }
    }, 25)
    await started
    assert.equal(run.status, 'passed')
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('assert_gui dùng được slot 80 trong GUI 90 slot; evidence bounded 64', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-gui-slot80-assert-'))
  const bot = new FakeBot()
  const slots = Array.from({ length: 90 }, (_, i) =>
    i === 80 ? { slot: 80, name: 'emerald', displayName: 'Emerald', count: 5, nbt: undefined } : null
  )
  bot.currentWindow = { id: 20, type: 'minecraft:generic_9x10', title: 'Big GUI', slots }
  const guiScenario = scenarioSchema.parse({
    name: 'slot 80 assert', maxDurationMs: 1_000,
    steps: [{ id: 'high-slot', action: 'assert_gui', titleIncludes: 'Big GUI', items: [{ slot: 80, nameIncludes: 'Emerald', count: 5 }] }]
  })
  const run = new TestRun(guiScenario, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    await started

    assert.equal(run.status, 'passed')
    assert.equal(run.steps[0].status, 'passed')
    const evidence = run.steps[0].evidence as { matchedItems?: Array<{ slot?: number }>; gui?: { items?: unknown[] } }
    assert.equal(evidence.matchedItems?.[0]?.slot, 80)
    // evidence GUI bounded to 64 items
    assert.ok((evidence.gui?.items?.length ?? 0) <= 64, 'evidence GUI items phải bounded <= 64')
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('click_gui dùng được slot 80 trong GUI 90 slot', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-gui-slot80-click-'))
  const bot = new FakeBot()
  const slots = Array.from({ length: 90 }, (_, i) =>
    i === 80 ? { slot: 80, name: 'emerald', displayName: 'Emerald', count: 5, nbt: undefined } : null
  )
  bot.currentWindow = { id: 21, type: 'minecraft:generic_9x10', title: 'Big GUI', slots }
  const clickScenario = scenarioSchema.parse({
    name: 'slot 80 click', maxDurationMs: 1_000,
    steps: [{ id: 'click-high', action: 'click_gui', slot: 80, inspectDelayMs: 0 }]
  })
  const run = new TestRun(clickScenario, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    await started

    assert.equal(run.status, 'passed')
    assert.deepEqual(bot.clickedSlots, [80])
    const evidence = run.steps[0].evidence as { clickedSlot?: number }
    assert.equal(evidence.clickedSlot, 80)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('assert_gui selectors không trùng slot trả fail', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-gui-overlap-'))
  const bot = new FakeBot()
  const item = { slot: 5, name: 'paper', displayName: 'Quest', count: 1, nbt: undefined }
  bot.currentWindow = {
    id: 22, type: 'minecraft:generic_9x1', title: 'Quest Menu',
    slots: Array.from({ length: 9 }, (_, i) => i === 5 ? item : null)
  }
  const overlapScenario = scenarioSchema.parse({
    name: 'overlap selector', maxDurationMs: 1_000,
    steps: [{
      id: 'overlap', action: 'assert_gui', titleIncludes: 'Quest',
      items: [{ slot: 5, nameIncludes: 'Quest' }, { nameIncludes: 'Quest' }],
      timeoutMs: 200
    }]
  })
  const run = new TestRun(overlapScenario, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    await started

    assert.equal(run.status, 'failed')
    const evidence = run.steps[0].evidence as { reason?: string }
    assert.equal(evidence?.reason, 'selector overlap')
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('fish fails when attempts produce no inventory gain', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-fish-oracle-'))
  const bot = new FakeBot()
  bot.currentWindow = null
  bot.inventoryItems = [{ name: 'cod', displayName: 'Cod', count: 1 }]
  const fishScenario = scenarioSchema.parse({
    name: 'fish oracle', maxDurationMs: 1_000,
    steps: [{ id: 'catch', action: 'fish', attempts: 1, timeoutMs: 100 }]
  })
  const run = new TestRun(fishScenario, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    await started

    assert.equal(run.status, 'failed')
    assert.match(run.steps[0].message, /no inventory gain/i)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('plant fails when placeBlock resolves but world state stays air', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-plant-oracle-'))
  const bot = new FakeBot()
  bot.currentWindow = null
  bot.inventoryItems = [{ name: 'wheat_seeds', displayName: 'Wheat Seeds', count: 1 }]
  bot.gateBlock = {
    name: 'farmland',
    position: { x: 0, y: 64, z: 0, offset: (x: number, y: number, z: number) => ({ x, y: 64 + y, z }) },
    getProperties: () => ({})
  }
  bot.blockLookup = position => position.y === 65
    ? { name: 'air', position, getProperties: () => ({}) }
    : bot.gateBlock
  const plantScenario = scenarioSchema.parse({
    name: 'plant oracle', maxDurationMs: 1_000,
    steps: [{ id: 'plant', action: 'plant', seedIncludes: 'seeds', soil: 'farmland', timeoutMs: 50 }]
  })
  const run = new TestRun(plantScenario, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    await started

    assert.equal(run.status, 'failed')
    assert.match(run.steps[0].message, /Timeout: plant/)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('missing entity reports bounded nearby player candidates and bot position', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-entity-diagnostic-'))
  const bot = new FakeBot()
  bot.currentWindow = null
  bot.entity = { position: { x: 23.5, y: -60, z: -18.5 } }
  bot.entities = {
    1: {
      id: 1,
      name: 'player',
      username: 'Jumonka',
      type: 'player',
      position: {
        x: 44, y: -60, z: -5,
        distanceTo(other: { x: number; y: number; z: number }) {
          return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z)
        }
      },
      getCustomName: () => 'Jumonka'
    }
  }
  const missingEntityScenario = scenarioSchema.parse({
    name: 'missing entity diagnostic',
    maxDurationMs: 1_000,
    steps: [{
      id: 'locate-target', action: 'interact_entity', nameIncludes: 'ThanhRedfield',
      maxDistance: 48, interactionRange: 3, waitForGui: false
    }]
  })
  const run = new TestRun(missingEntityScenario, minecraft, reportDir, {
    createBot: () => bot as never,
    prepareNavigation: () => {},
    connectTimeoutMs: 100,
    disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    await started

    assert.equal(run.status, 'failed')
    const message = run.report().steps[0]?.message ?? ''
    assert.match(message, /Entity not found: ThanhRedfield/)
    assert.match(message, /bot=23\.50,-60\.00,-18\.50/)
    assert.match(message, /Jumonka@24\./)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('interaction selects only the exact required UUID and records it', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-interaction-identity-'))
  const bot = new FakeBot()
  bot.currentWindow = null
  const requiredUuid = '46a5553d-cedc-428f-b51a-4f5ddec03c9b'
  const wrong = {
    id: 1, uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'player', height: 2,
    getCustomName: () => ({ toString: () => 'ThanhRedfield' }),
    position: { x: 1, y: 64, z: 0, distanceTo: () => 1, offset: () => ({ target: 'wrong' }) }
  }
  const target = {
    id: 2, uuid: requiredUuid, name: 'player', height: 2,
    getCustomName: () => ({ toString: () => 'ThanhRedfield' }),
    position: { x: 2, y: 64, z: 0, distanceTo: () => 2, offset: () => ({ target: 'exact' }) }
  }
  bot.entities = { 1: wrong, 2: target }
  const interaction = scenarioSchema.parse({
    name: 'exact interaction', maxDurationMs: 1_000,
    steps: [{
      id: 'interact', action: 'interact_entity', nameIncludes: 'ThanhRedfield',
      requiredUuid, maxDistance: 48, interactionRange: 3, waitForGui: false
    }]
  })
  const run = new TestRun(interaction, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    await started

    assert.equal(run.status, 'passed')
    assert.deepEqual(bot.activated, [target])
    assert.equal((run.steps[0].evidence as { uuid?: string }).uuid, requiredUuid)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('interaction fails closed when only a same-name wrong UUID exists', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-interaction-wrong-uuid-'))
  const bot = new FakeBot()
  bot.currentWindow = null
  bot.entities[1] = {
    id: 1, uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'player', height: 2,
    getCustomName: () => ({ toString: () => 'ThanhRedfield' }),
    position: { x: 1, y: 64, z: 0, distanceTo: () => 1, offset: () => ({}) }
  }
  const interaction = scenarioSchema.parse({
    name: 'wrong interaction identity', maxDurationMs: 1_000,
    steps: [{
      id: 'interact', action: 'interact_entity', nameIncludes: 'ThanhRedfield',
      requiredUuid: '46a5553d-cedc-428f-b51a-4f5ddec03c9b', maxDistance: 48
    }]
  })
  const run = new TestRun(interaction, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    await started

    assert.equal(run.status, 'failed')
    assert.match(run.steps[0].message, /INCONCLUSIVE_IDENTITY.*46a5553d-cedc-428f-b51a-4f5ddec03c9b/)
    assert.equal(bot.activated.length, 0)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('interaction revalidates exact identity after travel and immediately before activation', async t => {
  const requiredUuid = '46a5553d-cedc-428f-b51a-4f5ddec03c9b'
  const cases = [
    {
      name: 'target disappears during travel', phase: 'goto', expected: /INCONCLUSIVE_TRACKING/,
      mutate: (bot: FakeBot) => { delete bot.entities[1] }
    },
    {
      name: 'target object is replaced during travel', phase: 'goto', expected: /object replaced/,
      mutate: (bot: FakeBot) => { bot.entities[1] = { ...(bot.entities[1] as object) } }
    },
    {
      name: 'target UUID changes during lookAt', phase: 'lookAt', expected: /INCONCLUSIVE_IDENTITY/,
      mutate: (bot: FakeBot) => {
        bot.entities[1] = { ...(bot.entities[1] as object), uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
      }
    },
    {
      name: 'duplicate exact identity appears during lookAt', phase: 'lookAt', expected: /2 entities match/,
      mutate: (bot: FakeBot) => { bot.entities[2] = { ...(bot.entities[1] as object), id: 2 } }
    },
    {
      name: 'target moves outside interaction range during lookAt', phase: 'lookAt', expected: /interaction range/,
      mutate: (bot: FakeBot) => {
        const target = bot.entities[1] as { position: { distanceTo: () => number } }
        target.position.distanceTo = () => 10
      }
    }
  ] as const

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-interaction-revalidate-'))
      const bot = new FakeBot()
      bot.currentWindow = null
      const target = {
        id: 1, uuid: requiredUuid, name: 'player', height: 2,
        getCustomName: () => ({ toString: () => 'ThanhRedfield' }),
        position: { x: 10, y: 64, z: 0, distanceTo: () => 10, offset: () => ({}) }
      }
      bot.entities = { 1: target }
      ;(bot.pathfinder as any).goto = async () => {
        if (testCase.phase === 'goto') testCase.mutate(bot)
        else target.position.distanceTo = () => 2
      }
      bot.lookAt = async position => {
        bot.lookedAt.push(position)
        if (testCase.phase === 'lookAt') testCase.mutate(bot)
      }
      const interaction = scenarioSchema.parse({
        name: testCase.name, maxDurationMs: 1_000,
        steps: [{
          id: 'interact', action: 'interact_entity', nameIncludes: 'ThanhRedfield',
          requiredUuid, maxDistance: 48, interactionRange: 3, waitForGui: false
        }]
      })
      const run = new TestRun(interaction, minecraft, reportDir, {
        createBot: () => bot as never, prepareNavigation: () => {},
        connectTimeoutMs: 100, disconnectTimeoutMs: 100
      })

      try {
        const started = run.start()
        bot.emit('spawn')
        await started

        assert.equal(run.status, 'failed')
        assert.match(run.steps[0].message, testCase.expected)
        assert.equal(bot.activated.length, 0)
      } finally {
        await rm(reportDir, { recursive: true, force: true })
      }
    })
  }
})

test('TestRun isolates shared Minecraft options from Mineflayer mutation', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-options-'))
  const bot = new FakeBot()
  bot.currentWindow = null
  const sharedMinecraft = { host: 'localhost', port: 25565, username: 'tester', auth: 'offline' as const }
  const run = new TestRun(scenario, sharedMinecraft, reportDir, {
    createBot: options => {
      options.version = '1.21.11'
      ;(options as typeof options & { protocolVersion?: number }).protocolVersion = 774
      return bot as never
    },
    prepareNavigation: () => {},
    connectTimeoutMs: 100,
    disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    await started

    assert.deepEqual(sharedMinecraft, {
      host: 'localhost', port: 25565, username: 'tester', auth: 'offline'
    })
    assert.equal(run.events.find(event => event.type === 'spawn')?.summary, 'Connected to localhost:25565')
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('cancelling during connect aborts waiting and cleans the client once', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-connect-'))
  const bot = new FakeBot()
  bot.currentWindow = null
  const run = new TestRun(scenario, minecraft, reportDir, {
    createBot: () => bot as never,
    prepareNavigation: () => {},
    connectTimeoutMs: 1_000,
    disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    run.cancel()
    await started

    assert.equal(run.status, 'cancelled')
    assert.equal(bot.quits, 1)
    for (const event of ['spawn', 'error', 'kicked', 'end', 'messagestr']) assert.equal(bot.listenerCount(event), 0)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('client errors retain bounded diagnostic context', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-error-'))
  const bot = new FakeBot()
  bot.currentWindow = null
  const run = new TestRun(scenario, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    const error = new TypeError('protocol decode failed')
    error.stack = `TypeError: protocol decode failed\n${'at parser (protocol.js:1)\n'.repeat(100)}`
    bot.emit('error', error)
    await started
    const data = run.events.find(item => item.type === 'client_error')?.data as { name?: string; stack?: string; protocol?: unknown }
    assert.equal(data.name, 'TypeError')
    assert.match(data.stack ?? '', /protocol\.js:1/)
    assert.ok((data.stack?.length ?? 0) <= 4096)
    assert.equal(data.protocol, undefined)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('client protocol diagnostics are opt-in and retain only a bounded frame fingerprint', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-protocol-error-'))
  const bot = new FakeBot()
  bot.currentWindow = null
  const run = new TestRun(scenario, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100,
    protocolDiagnosticsEnabled: true
  })

  try {
    const started = run.start()
    const buffer = Buffer.alloc(100, 0x61)
    const error = Object.assign(new TypeError('protocol decode failed'), {
      field: 'play.toClient.packet.params.slot.components.data.pages',
      buffer,
      password: 'khong-duoc-ghi'
    })
    bot.emit('error', error)
    await started
    const data = run.events.find(item => item.type === 'client_error')?.data as {
      protocol?: { field?: string; frameLength?: number; frameSha256?: string }
    }
    assert.equal(data.protocol?.field, error.field)
    assert.equal(data.protocol?.frameLength, 100)
    assert.equal(data.protocol?.frameSha256?.length, 64)
    assert.doesNotMatch(JSON.stringify(data), /khong-duoc-ghi/)
    assert.equal('buffer' in (data.protocol ?? {}), false)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('read-only assertions return runtime evidence', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-assert-'))
  const bot = new FakeBot()
  bot.currentWindow = null
  bot.entities[1] = {
    id: 1, uuid: 'uuid-citizen', name: 'player',
    getCustomName: () => ({ toString: () => 'ThanhRedfield' }),
    position: { x: 3, y: 64, z: 4, distanceTo: () => 5 }
  }
  const assertions = scenarioSchema.parse({
    name: 'runtime assertions',
    maxDurationMs: 1_000,
    steps: [
      { id: 'state', action: 'assert_state', minimumHealth: 20, minimumFood: 20 },
      { id: 'npc', action: 'assert_nearby_entity', nameIncludes: 'ThanhRedfield', maxDistance: 48 }
    ]
  })
  const run = new TestRun(assertions, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    await started
    assert.equal(run.status, 'passed')
    assert.deepEqual(run.steps[0].evidence, { health: 20, food: 20, gui: 'closed' })
    assert.deepEqual(run.steps[1].evidence, {
      entity: 'ThanhRedfield', distance: 5, position: { x: 3, y: 64, z: 4 }
    })
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('nearby entity UUID assertion records the exact verified identity', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-identity-evidence-'))
  const bot = new FakeBot()
  bot.currentWindow = null
  const requiredUuid = '46a5553d-cedc-428f-b51a-4f5ddec03c9b'
  bot.entities[1] = {
    id: 1, uuid: requiredUuid, name: 'player',
    getCustomName: () => ({ toString: () => 'ThanhRedfield' }),
    position: { x: 3, y: 64, z: 4, distanceTo: () => 5 }
  }
  const assertions = scenarioSchema.parse({
    name: 'exact identity evidence', maxDurationMs: 1_000,
    steps: [{
      id: 'identity', action: 'assert_nearby_entity', nameIncludes: 'ThanhRedfield',
      requiredUuid, maxDistance: 48
    }]
  })
  const run = new TestRun(assertions, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    await started

    assert.equal(run.status, 'passed')
    assert.deepEqual(run.steps[0].evidence, {
      entity: 'ThanhRedfield', uuid: requiredUuid,
      distance: 5, position: { x: 3, y: 64, z: 4 }
    })
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('nearby entity UUID assertion fails closed when only a same-name wrong UUID exists', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-wrong-identity-'))
  const bot = new FakeBot()
  bot.currentWindow = null
  bot.entities[1] = {
    id: 1, uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'player',
    getCustomName: () => ({ toString: () => 'ThanhRedfield' }),
    position: { x: 3, y: 64, z: 4, distanceTo: () => 5 }
  }
  const assertions = scenarioSchema.parse({
    name: 'wrong exact identity', maxDurationMs: 1_000,
    steps: [{
      id: 'identity', action: 'assert_nearby_entity', nameIncludes: 'ThanhRedfield',
      requiredUuid: '46a5553d-cedc-428f-b51a-4f5ddec03c9b', maxDistance: 48
    }]
  })
  const run = new TestRun(assertions, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    await started

    assert.equal(run.status, 'failed')
    assert.match(run.steps[0].message,
      /INCONCLUSIVE_IDENTITY.*46a5553d-cedc-428f-b51a-4f5ddec03c9b/)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('entity diagnostic chỉ ghi snapshot bounded và sanitized', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-entity-diagnostic-'))
  const bot = new FakeBot()
  bot.currentWindow = null
  bot.entities[1] = {
    id: 1, uuid: 'uuid-citizen', name: 'player', username: undefined,
    displayName: 'Player', type: 'player',
    getCustomName: () => ({ toString: () => 'ThanhRedfield' }),
    metadata: [{ toString: () => 'ThanhRedfield' }, { secret: 'khong-duoc-ghi' }],
    position: { x: 3, y: 64, z: 4, distanceTo: () => 5 },
    password: 'khong-duoc-ghi'
  }
  bot.entities[2] = {
    id: 2, uuid: 'uuid-far', name: 'player',
    position: { x: 100, y: 64, z: 0, distanceTo: () => 100 }
  }
  bot.players['ThanhRedfield'] = {
    username: 'ThanhRedfield', uuid: 'uuid-citizen', displayName: { toString: () => 'Thanh Redfield' },
    ping: 3, secret: 'khong-duoc-ghi'
  }
  const diagnostic = scenarioSchema.parse({
    name: 'entity diagnostic', maxDurationMs: 1_000,
    steps: [{ id: 'entities', action: 'inspect_entities', maxDistance: 48, limit: 1 }]
  })
  const run = new TestRun(diagnostic, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    await started

    assert.equal(run.status, 'passed')
    assert.deepEqual(run.steps[0].evidence, {
      entityCountInRange: 1,
      entities: [{
        id: 1, uuid: 'uuid-citizen', name: 'player', displayName: 'Player',
        type: 'player', customName: 'ThanhRedfield', distance: 5,
        position: { x: 3, y: 64, z: 4 }, metadata: ['ThanhRedfield', '[object Object]']
      }],
      playerCount: 1,
      players: [{ username: 'ThanhRedfield', uuid: 'uuid-citizen', displayName: 'Thanh Redfield', ping: 3 }]
    })
    assert.doesNotMatch(JSON.stringify(run.steps[0].evidence), /khong-duoc-ghi/)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('nearby entity assertion waits for the entity stream to catch up after spawn', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-entity-wait-'))
  const bot = new FakeBot()
  bot.currentWindow = null
  const assertions = scenarioSchema.parse({
    name: 'delayed entity', maxDurationMs: 1_000,
    steps: [{ id: 'npc', action: 'assert_nearby_entity', nameIncludes: 'ThanhRedfield', maxDistance: 48, timeoutMs: 500 }]
  })
  const run = new TestRun(assertions, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    setTimeout(() => {
      bot.entities[1] = {
        name: 'player', username: 'ThanhRedfield', displayName: 'player',
        position: { x: 3, y: 64, z: 4, distanceTo: () => 5 }
      }
    }, 20)
    await started
    assert.equal(run.status, 'passed')
    assert.deepEqual(run.steps[0].evidence, {
      entity: 'ThanhRedfield', distance: 5, position: { x: 3, y: 64, z: 4 }
    })
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('world pairing mismatch giữ lại expected và observed runtime evidence', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-world-pairing-'))
  const bot = new FakeBot()
  bot.currentWindow = null
  bot.serverWorld = 'WrongWorld'
  const targetUuid = '3d1d6e6d-6f19-4214-b794-f3ba0c202a1d'
  bot.entities[7] = {
    id: 7, uuid: targetUuid, name: 'player', username: 'Alex',
    position: { x: -1, y: 64, z: 0 }
  }
  const crossing = scenarioSchema.parse({
    name: 'world pairing mismatch', maxDurationMs: 1_000,
    steps: [{
      id: 'cross', action: 'observe_crossing', timeoutMs: 300, sampleMs: 50,
      nameIncludes: 'Alex', targetUuid, serverWorld: 'StillCliff', dimension: 'overworld',
      gateBlock: { x: 0, y: 64, z: 0 },
      approach: { x: -0.5, y: 64, z: 0.5 }, exit: { x: 1.5, y: 64, z: 0.5 }
    }]
  })
  const run = new TestRun(crossing, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    await started

    assert.equal(run.status, 'failed')
    assert.match(run.steps[0].message,
      /INCONCLUSIVE_PAIRING: expected server world StillCliff, observed WrongWorld/)
    const evidence = run.steps[0].evidence as {
      pairing: {
        targetUuid: string
        serverWorld: string
        dimension: string
        gateBlock: { x: number; y: number; z: number }
        observedServerWorld?: string
        observedDimension?: string
        observedGateBlock?: { name: string; facing?: string; half?: string; open?: boolean }
      }
    }
    assert.deepEqual(evidence.pairing, {
      targetUuid,
      serverWorld: 'StillCliff',
      dimension: 'overworld',
      gateBlock: { x: 0, y: 64, z: 0 },
      observedServerWorld: 'WrongWorld',
      observedDimension: 'overworld',
      observedGateBlock: {
        name: 'spruce_door', facing: 'east', half: 'lower', open: false
      }
    })
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('gate pairing từ chối runtime block không còn là cửa hoặc fence gate', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-gate-pairing-'))
  const bot = new FakeBot()
  bot.currentWindow = null
  bot.gateBlock = {
    name: 'stone',
    position: { x: 0, y: 64, z: 0 },
    getProperties: () => ({})
  }
  const targetUuid = '3d1d6e6d-6f19-4214-b794-f3ba0c202a1d'
  bot.entities[7] = {
    id: 7, uuid: targetUuid, name: 'player', username: 'Alex',
    position: { x: -0.5, y: 64, z: 0.5 }
  }
  const crossing = scenarioSchema.parse({
    name: 'gate block mismatch', maxDurationMs: 1_000,
    steps: [{
      id: 'cross', action: 'observe_crossing', timeoutMs: 300, sampleMs: 50,
      nameIncludes: 'Alex', targetUuid, serverWorld: 'StillCliff', dimension: 'overworld',
      gateBlock: { x: 0, y: 64, z: 0 },
      approach: { x: -0.5, y: 64, z: 0.5 }, exit: { x: 1.5, y: 64, z: 0.5 }
    }]
  })
  const run = new TestRun(crossing, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    await started

    assert.equal(run.status, 'failed')
    assert.match(run.steps[0].message,
      /INCONCLUSIVE_PAIRING: expected door or fence gate at 0,64,0, observed stone/)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('gate pairing sai thoáng qua vẫn bị latch giữa hai poll', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-gate-pairing-window-'))
  const bot = new FakeBot()
  bot.currentWindow = null
  const targetUuid = '3d1d6e6d-6f19-4214-b794-f3ba0c202a1d'
  bot.entities[7] = {
    id: 7, uuid: targetUuid, name: 'player', username: 'Alex',
    position: { x: -0.5, y: 64, z: 0.5 }
  }
  const crossing = scenarioSchema.parse({
    name: 'transient gate mismatch', maxDurationMs: 1_000,
    steps: [{
      id: 'cross', action: 'observe_crossing', timeoutMs: 500, sampleMs: 100,
      nameIncludes: 'Alex', targetUuid, serverWorld: 'StillCliff', dimension: 'overworld',
      gateBlock: { x: 0, y: 64, z: 0 },
      approach: { x: -0.5, y: 64, z: 0.5 }, exit: { x: 1.5, y: 64, z: 0.5 }
    }]
  })
  const run = new TestRun(crossing, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    setTimeout(() => {
      const door = bot.gateBlock
      bot.gateBlock = {
        name: 'stone', position: { x: 0, y: 64, z: 0 }, getProperties: () => ({})
      }
      bot.emit('blockUpdate', door, bot.gateBlock)
      bot.gateBlock = door
    }, 20)
    await started

    assert.equal(run.status, 'failed')
    assert.match(run.steps[0].message,
      /INCONCLUSIVE_PAIRING: expected door or fence gate at 0,64,0, observed stone/)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('gate pairing cho phép cửa mở hợp lệ và dọn listener sau crossing', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-gate-open-'))
  const bot = new FakeBot()
  bot.currentWindow = null
  const targetUuid = '3d1d6e6d-6f19-4214-b794-f3ba0c202a1d'
  const entity = {
    id: 7, uuid: targetUuid, name: 'player', username: 'Alex',
    position: { x: -0.5, y: 64, z: 0.5 }
  }
  bot.entities[7] = entity
  const crossing = scenarioSchema.parse({
    name: 'valid gate opening', maxDurationMs: 1_000,
    steps: [{
      id: 'cross', action: 'observe_crossing', timeoutMs: 500, sampleMs: 50,
      nameIncludes: 'Alex', targetUuid, serverWorld: 'StillCliff', dimension: 'overworld',
      gateBlock: { x: 0, y: 64, z: 0 },
      approach: { x: -0.5, y: 64, z: 0.5 }, exit: { x: 1.5, y: 64, z: 0.5 },
      requiredExitSamples: 1, exitDwellMs: 0
    }]
  })
  const run = new TestRun(crossing, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    setTimeout(() => {
      const closed = bot.gateBlock
      bot.gateBlock = {
        ...closed,
        getProperties: () => ({ facing: 'east', half: 'lower', open: true })
      }
      bot.emit('blockUpdate', closed, bot.gateBlock)
      bot.emit('chunkColumnUnload', { x: 16, y: 0, z: 0 })
      entity.position = { x: 0.75, y: 64, z: 0.5 }
      bot.emit('entityMoved', entity)
      setTimeout(() => {
        entity.position = { x: 1.5, y: 64, z: 0.5 }
      }, 10)
    }, 20)
    await started

    assert.equal(run.status, 'passed')
    assert.equal(bot.listenerCount('blockUpdate'), 0)
    assert.equal(bot.listenerCount('chunkColumnUnload'), 0)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('gate pairing bị latch khi chunk chứa gate bị unload', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-gate-chunk-unload-'))
  const bot = new FakeBot()
  bot.currentWindow = null
  const targetUuid = '3d1d6e6d-6f19-4214-b794-f3ba0c202a1d'
  bot.entities[7] = {
    id: 7, uuid: targetUuid, name: 'player', username: 'Alex',
    position: { x: -0.5, y: 64, z: 0.5 }
  }
  const crossing = scenarioSchema.parse({
    name: 'gate chunk unload', maxDurationMs: 1_000,
    steps: [{
      id: 'cross', action: 'observe_crossing', timeoutMs: 500, sampleMs: 100,
      nameIncludes: 'Alex', targetUuid, serverWorld: 'StillCliff', dimension: 'overworld',
      gateBlock: { x: 0, y: 64, z: 0 },
      approach: { x: -0.5, y: 64, z: 0.5 }, exit: { x: 1.5, y: 64, z: 0.5 }
    }]
  })
  const run = new TestRun(crossing, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    setTimeout(() => bot.emit('chunkColumnUnload', { x: 0, y: 0, z: 0 }), 20)
    await started

    assert.equal(run.status, 'failed')
    assert.match(run.steps[0].message,
      /INCONCLUSIVE_PAIRING: gate chunk unloaded during crossing trajectory/)
    assert.equal(bot.listenerCount('chunkColumnUnload'), 0)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('world pairing sai thoáng qua vẫn bị latch trong suốt observation window', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-world-pairing-window-'))
  const bot = new FakeBot()
  bot.currentWindow = null
  const targetUuid = '3d1d6e6d-6f19-4214-b794-f3ba0c202a1d'
  bot.entities[7] = {
    id: 7, uuid: targetUuid, name: 'player', username: 'Alex',
    position: { x: -1, y: 64, z: 0 }
  }
  const crossing = scenarioSchema.parse({
    name: 'transient world pairing mismatch', maxDurationMs: 1_000,
    steps: [{
      id: 'cross', action: 'observe_crossing', timeoutMs: 500, sampleMs: 100,
      nameIncludes: 'Alex', targetUuid, serverWorld: 'StillCliff', dimension: 'overworld',
      gateBlock: { x: 0, y: 64, z: 0 },
      approach: { x: -0.5, y: 64, z: 0.5 }, exit: { x: 1.5, y: 64, z: 0.5 }
    }]
  })
  const run = new TestRun(crossing, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    setTimeout(() => {
      bot.serverWorld = 'WrongWorld'
      bot.emit('move')
      bot.serverWorld = 'StillCliff'
    }, 20)
    await started

    assert.equal(run.status, 'failed')
    assert.match(run.steps[0].message,
      /INCONCLUSIVE_PAIRING: expected server world StillCliff, observed WrongWorld/)
    const evidence = run.steps[0].evidence as {
      pairing: { observedServerWorld?: string; observedDimension?: string }
    }
    assert.equal(evidence.pairing.observedServerWorld, 'WrongWorld')
    assert.equal(evidence.pairing.observedDimension, 'overworld')
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('timeout của observe_crossing optional không abort các step sau', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-step-timeout-'))
  const bot = new FakeBot()
  bot.currentWindow = null
  bot.entities[7] = {
    id: 7, uuid: 'uuid-alex', name: 'player', username: 'Alex',
    position: { x: -1, y: 64, z: 0 }
  }
  const optionalObserver = scenarioSchema.parse({
    name: 'optional observer timeout', maxDurationMs: 1_000,
    steps: [
      {
        id: 'cross', action: 'observe_crossing', optional: true,
        timeoutMs: 30, sampleMs: 50, nameIncludes: 'Alex',
        approach: { x: -1, y: 64, z: 0 }, exit: { x: 1, y: 64, z: 0 }
      },
      { id: 'after_timeout', action: 'wait', durationMs: 0 }
    ]
  })
  const run = new TestRun(optionalObserver, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    await started

    assert.equal(run.status, 'passed')
    assert.deepEqual(run.steps.map(step => [step.id, step.status]), [
      ['cross', 'skipped'], ['after_timeout', 'passed']
    ])
    assert.match(run.steps[0].message, /INCONCLUSIVE_TRACKING: timeout/)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('entityGone giữa hai sample làm trajectory inconclusive dù cùng object xuất hiện lại', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-entity-gone-'))
  const bot = new FakeBot()
  bot.currentWindow = null
  const observed = {
    id: 7, uuid: 'uuid-alex', name: 'player', username: 'Alex',
    position: { x: -1, y: 64, z: 0 }
  }
  bot.entities[7] = observed
  const crossing = scenarioSchema.parse({
    name: 'entity gone latch', maxDurationMs: 1_000,
    steps: [{
      id: 'cross', action: 'observe_crossing', timeoutMs: 300, sampleMs: 50,
      nameIncludes: 'Alex', approach: { x: -1, y: 64, z: 0 },
      exit: { x: 1, y: 64, z: 0 }, requiredExitSamples: 1, exitDwellMs: 0
    }]
  })
  const run = new TestRun(crossing, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    setTimeout(() => {
      bot.emit('entityGone', observed)
      observed.position.x = 0.2
    }, 10)
    setTimeout(() => { observed.position.x = 0.5 }, 70)
    await started

    assert.equal(run.status, 'failed')
    assert.match(run.steps[0].message, /INCONCLUSIVE_TRACKING.*disappeared during trajectory/)
    assert.equal(bot.listenerCount('entityGone'), 0)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('ambiguity thoáng qua giữa hai sample làm trajectory inconclusive', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-transient-ambiguity-'))
  const bot = new FakeBot()
  bot.currentWindow = null
  const observed = {
    id: 7, uuid: 'uuid-alex', name: 'player', username: 'Alex',
    position: { x: -1, y: 64, z: 0 }
  }
  const ambiguous = {
    id: 8, uuid: 'uuid-alex-other', name: 'player', username: 'Alex',
    position: { x: -1, y: 64, z: 0 }
  }
  bot.entities[7] = observed
  const crossing = scenarioSchema.parse({
    name: 'transient ambiguity latch', maxDurationMs: 1_000,
    steps: [{
      id: 'cross', action: 'observe_crossing', timeoutMs: 400, sampleMs: 50,
      nameIncludes: 'Alex', approach: { x: -1, y: 64, z: 0 },
      exit: { x: 1, y: 64, z: 0 }, requiredExitSamples: 1, exitDwellMs: 0
    }]
  })
  const run = new TestRun(crossing, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    setTimeout(() => {
      bot.entities[8] = ambiguous
      bot.emit('entitySpawn', ambiguous)
    }, 10)
    setTimeout(() => {
      delete bot.entities[8]
      bot.emit('entityGone', ambiguous)
    }, 20)
    setTimeout(() => { observed.position.x = 0.2 }, 70)
    setTimeout(() => { observed.position.x = 0.5 }, 130)
    await started

    assert.equal(run.status, 'failed')
    assert.match(run.steps[0].message, /INCONCLUSIVE_IDENTITY.*2 entities/)
    for (const event of ['entitySpawn', 'entityUpdate', 'entityMoved', 'entityGone']) {
      assert.equal(bot.listenerCount(event), 0)
    }
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('metadata ambiguity thoáng qua giữa hai sample làm trajectory inconclusive', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-transient-metadata-'))
  const bot = new FakeBot()
  bot.currentWindow = null
  const observed = {
    id: 7, uuid: 'uuid-alex', name: 'player', username: 'Alex',
    position: { x: -1, y: 64, z: 0 }
  }
  const ambiguous = {
    id: 8, uuid: 'uuid-other', name: 'player', username: 'Bob',
    position: { x: -1, y: 64, z: 0 }
  }
  bot.entities[7] = observed
  bot.entities[8] = ambiguous
  const crossing = scenarioSchema.parse({
    name: 'transient metadata ambiguity latch', maxDurationMs: 1_000,
    steps: [{
      id: 'cross', action: 'observe_crossing', timeoutMs: 400, sampleMs: 50,
      nameIncludes: 'Alex', approach: { x: -1, y: 64, z: 0 },
      exit: { x: 1, y: 64, z: 0 }, requiredExitSamples: 1, exitDwellMs: 0
    }]
  })
  const run = new TestRun(crossing, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    setTimeout(() => {
      ambiguous.username = 'Alex'
      bot.emit('entityUpdate', ambiguous)
    }, 10)
    setTimeout(() => {
      ambiguous.username = 'Bob'
      bot.emit('entityUpdate', ambiguous)
    }, 20)
    setTimeout(() => { observed.position.x = 0.2 }, 70)
    setTimeout(() => { observed.position.x = 0.5 }, 130)
    await started

    assert.equal(run.status, 'failed')
    assert.match(run.steps[0].message, /INCONCLUSIVE_IDENTITY.*2 entities/)
    assert.equal(bot.listenerCount('entityUpdate'), 0)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('range ambiguity thoáng qua giữa hai sample làm trajectory inconclusive', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-transient-range-'))
  const bot = new FakeBot()
  bot.currentWindow = null
  const observed = {
    id: 7, uuid: 'uuid-alex', name: 'player', username: 'Alex',
    position: { x: -1, y: 64, z: 0 }
  }
  const ambiguous = {
    id: 8, uuid: 'uuid-alex-other', name: 'player', username: 'Alex',
    position: { x: 100, y: 64, z: 0 }
  }
  bot.entities[7] = observed
  bot.entities[8] = ambiguous
  const crossing = scenarioSchema.parse({
    name: 'transient range ambiguity latch', maxDurationMs: 1_000,
    steps: [{
      id: 'cross', action: 'observe_crossing', timeoutMs: 400, sampleMs: 50,
      nameIncludes: 'Alex', maxDistance: 32,
      approach: { x: -1, y: 64, z: 0 }, exit: { x: 1, y: 64, z: 0 },
      requiredExitSamples: 1, exitDwellMs: 0
    }]
  })
  const run = new TestRun(crossing, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    setTimeout(() => {
      ambiguous.position.x = -1
      bot.emit('entityMoved', ambiguous)
    }, 10)
    setTimeout(() => {
      ambiguous.position.x = 100
      bot.emit('entityMoved', ambiguous)
    }, 20)
    setTimeout(() => { observed.position.x = 0.2 }, 70)
    setTimeout(() => { observed.position.x = 0.5 }, 130)
    await started

    assert.equal(run.status, 'failed')
    assert.match(run.steps[0].message, /INCONCLUSIVE_IDENTITY.*2 entities/)
    assert.equal(bot.listenerCount('entityMoved'), 0)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('excursion geometry thoáng qua giữa hai sample không thể tạo crossing proof', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-transient-geometry-'))
  const bot = new FakeBot()
  bot.currentWindow = null
  const observed = {
    id: 7, uuid: 'uuid-alex', name: 'player', username: 'Alex',
    position: { x: -1, y: 64, z: 0 }
  }
  bot.entities[7] = observed
  const crossing = scenarioSchema.parse({
    name: 'transient geometry latch', maxDurationMs: 1_000,
    steps: [{
      id: 'cross', action: 'observe_crossing', timeoutMs: 250, sampleMs: 100,
      nameIncludes: 'Alex',
      approach: { x: -1, y: 64, z: 0 }, exit: { x: 1, y: 64, z: 0 },
      corridorHalfWidth: 0.75, maxStepDistance: 1.75,
      requiredExitSamples: 1, exitDwellMs: 0
    }]
  })
  const run = new TestRun(crossing, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    setTimeout(() => {
      observed.position.x = -0.2
      observed.position.z = 2
      bot.emit('entityMoved', observed)
    }, 10)
    setTimeout(() => {
      observed.position.x = 0.5
      observed.position.z = 0
      bot.emit('entityMoved', observed)
    }, 20)
    await started

    assert.equal(run.status, 'failed')
    assert.match(run.steps[0].message, /INCONCLUSIVE_TRACKING: timeout/)
    const evidence = run.steps[0].evidence as { observations: Array<{ withinCorridor: boolean }> }
    assert.ok(evidence.observations.some(observation => !observation.withinCorridor))
    assert.equal(bot.listenerCount('entityMoved'), 0)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

for (const lifecycleEvent of ['death', 'respawn'] as const) {
  test(`${lifecycleEvent} trong observe_crossing làm trajectory inconclusive`, async () => {
    const reportDir = await mkdtemp(path.join(tmpdir(), `botchecker-${lifecycleEvent}-crossing-`))
    const bot = new FakeBot()
    bot.currentWindow = null
    const observed = {
      id: 7, uuid: 'uuid-alex', name: 'player', username: 'Alex',
      position: { x: -1, y: 64, z: 0 }
    }
    bot.entities[7] = observed
    const crossing = scenarioSchema.parse({
      name: `${lifecycleEvent} invalidates crossing`, maxDurationMs: 1_000,
      steps: [{
        id: 'cross', action: 'observe_crossing', timeoutMs: 400, sampleMs: 50,
        nameIncludes: 'Alex', approach: { x: -1, y: 64, z: 0 },
        exit: { x: 1, y: 64, z: 0 }, requiredExitSamples: 1, exitDwellMs: 0
      }]
    })
    const run = new TestRun(crossing, minecraft, reportDir, {
      createBot: () => bot as never, prepareNavigation: () => {},
      connectTimeoutMs: 100, disconnectTimeoutMs: 100
    })

    try {
      const started = run.start()
      bot.emit('spawn')
      setTimeout(() => bot.emit(lifecycleEvent), 10)
      setTimeout(() => { observed.position.x = 0.2 }, 70)
      setTimeout(() => { observed.position.x = 0.5 }, 130)
      await started

      assert.equal(run.status, 'failed')
      assert.match(run.steps[0].message, new RegExp(`INCONCLUSIVE_TRACKING.*${lifecycleEvent}`))
      assert.equal(bot.listenerCount(lifecycleEvent), 0)
    } finally {
      await rm(reportDir, { recursive: true, force: true })
    }
  })
}

test('bot rời range thoáng qua giữa hai sample làm trajectory inconclusive', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-transient-observer-range-'))
  const bot = new FakeBot()
  bot.currentWindow = null
  const observed = {
    id: 7, uuid: 'uuid-alex', name: 'player', username: 'Alex',
    position: { x: -1, y: 64, z: 0 }
  }
  bot.entities[7] = observed
  const crossing = scenarioSchema.parse({
    name: 'transient observer range latch', maxDurationMs: 1_000,
    steps: [{
      id: 'cross', action: 'observe_crossing', timeoutMs: 400, sampleMs: 50,
      nameIncludes: 'Alex', maxDistance: 32,
      approach: { x: -1, y: 64, z: 0 }, exit: { x: 1, y: 64, z: 0 },
      requiredExitSamples: 1, exitDwellMs: 0
    }]
  })
  const run = new TestRun(crossing, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    setTimeout(() => {
      bot.entity.position.x = 100
      bot.emit('move', { x: 0, y: 64, z: 0 })
    }, 10)
    setTimeout(() => {
      bot.entity.position.x = 0
      bot.emit('move', { x: 100, y: 64, z: 0 })
    }, 20)
    setTimeout(() => { observed.position.x = 0.2 }, 70)
    setTimeout(() => { observed.position.x = 0.5 }, 130)
    await started

    assert.equal(run.status, 'failed')
    assert.match(run.steps[0].message, /INCONCLUSIVE_TRACKING.*no entity matching Alex/)
    assert.equal(bot.listenerCount('move'), 0)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})
