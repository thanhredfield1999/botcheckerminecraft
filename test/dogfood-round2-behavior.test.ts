import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { Script } from 'node:vm'
import path from 'node:path'
import test from 'node:test'
import { Vec3 } from 'vec3'
import { TestRun } from '../src/runner.js'
import { scenarioSchema } from '../src/scenario.js'

type FixtureItem = {
  name: string; displayName: string; count: number; slot: number;
  type: number; metadata: number; nbt?: object
}

// Chạy TestRun thật với nguồn protocol được inject; không mở socket/Paper.
class DogfoodBot extends EventEmitter {
  currentWindow: object | null = null
  entity = { position: new Vec3(0, 64, 0) }
  entities: Record<string, { id: number; uuid: string; name: string; position: Vec3 }> = {}
  health = 20
  food = 20
  version = '1.21.11'
  protocolVersion = '774'
  game = { dimension: 'minecraft:overworld' }
  pathfinder = { stop: () => {}, setMovements: () => {} }
  held: FixtureItem[] = []
  inventory = { items: () => this.held.filter(item => item.slot >= 9 && item.slot < 45 && item.count > 0), selectedItem: null as FixtureItem | null,
    slots: [] as (FixtureItem | null)[], inventoryStart: 9, inventoryEnd: 45 }
  droppedSlots: number[] = []
  async clickWindow(slot: number, button: number, mode: number): Promise<void> {
    assert.equal(mode, 4)
    const item = this.held.find(candidate => candidate.slot === slot)!
    this.droppedSlots.push(slot)
    item.count -= button === 1 ? item.count : 1
  }
  supportFeature(): boolean { return false }
  loadPlugin(): void {}
  closeWindow(): void { this.currentWindow = null }
  quit(): void { queueMicrotask(() => this.emit('end', 'quit')) }
}

async function runScenario(
  bot: DogfoodBot, steps: unknown[],
  stimulate: (run: TestRun, bot: DogfoodBot) => void = () => {}
) {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'bc-round2-behavior-'))
  const scenario = scenarioSchema.parse({ name: 'round2', maxDurationMs: 5_000, steps })
  const run = new TestRun(scenario, {
    host: 'localhost', port: 25565, username: 'offline-fixture', auth: 'offline'
  }, reportDir, {
    createBot: () => bot as never,
    prepareNavigation: () => queueMicrotask(() => stimulate(run, bot)),
    connectTimeoutMs: 1_000,
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

test('R2: drop một phần phải giữ đúng slot đã chọn giữa các item cùng vật liệu', async () => {
  const bot = new DogfoodBot()
  bot.held = [
    { slot: 9, type: 10, metadata: 0, name: 'paper', displayName: 'Other', count: 8, nbt: { code: 'A' } },
    { slot: 10, type: 10, metadata: 0, name: 'paper', displayName: 'Target', count: 8, nbt: { code: 'B' } }
  ]
  // Injected click boundary tests selection only; real library packet test below.
  for (const item of bot.held) bot.inventory.slots[item.slot] = item
  const run = await runScenario(bot, [
    { id: 'drop-target', action: 'drop_item', itemIncludes: 'Target', count: 1, timeoutMs: 1_000 }
  ])
  assert.equal(run.status, 'passed')
  assert.deepEqual(bot.droppedSlots, [10])
  assert.deepEqual(bot.held.map(item => item.count), [8, 7])
})

for (const dropCount of [undefined, 1, 3]) test(`R2: real-library drop count=${dropCount ?? 'stack'} không dùng cursor hoặc đóng window`, async () => {
  const require = createRequire(import.meta.url)
  const bot = new DogfoodBot()
  Object.assign(bot, {
    registry: require('prismarine-registry')('1.21.11'),
    _client: Object.assign(new EventEmitter(), { write: () => {} }),
    supportFeature: (feature: string) => feature === 'stateIdUsed'
  })
  require('mineflayer/lib/plugins/inventory.js')(bot, { hideErrors: true })
  require('mineflayer/lib/plugins/simple_inventory.js')(bot)
  const Item = require('prismarine-item')('1.21.11')
  const registry = require('prismarine-registry')('1.21.11')
  const inventory = bot.inventory as any
  inventory.updateSlot(9, new Item(registry.itemsByName.paper.id, 8))
  inventory.updateSlot(10, new Item(registry.itemsByName.paper.id, 8))
  inventory.slots[9].customName = { text: 'Other' }
  inventory.slots[10].customName = { text: 'Target' }
  const clicks: { slot: number; mode: number; windowId: number; mouseButton: number }[] = []
  ;(bot as any)._client.write = (name: string, packet: any) => {
    if (name === 'window_click') clicks.push(packet)
  }
  const run = await runScenario(bot, [{ id: 'drop', action: 'drop_item', itemIncludes: 'Target', count: dropCount }])
  assert.equal(run.status, 'passed')
  assert.deepEqual(clicks.map(({ slot, mode, windowId, mouseButton }) => ({ slot, mode, windowId, mouseButton })),
    Array.from({ length: dropCount ?? 1 }, () => ({
      slot: 10, mode: 4, windowId: 0, mouseButton: dropCount === undefined ? 1 : 0
    })))
  assert.equal(inventory.slots[9].count, 8)
  assert.equal(inventory.selectedItem, null)
  assert.equal(run.events.some(event => event.type === 'gui_close'), false)
  const evidence = run.steps[0]?.evidence as { dropped: number; remaining: number; serverConfirmed: boolean }
  assert.equal(evidence.dropped, dropCount ?? 8)
  assert.equal(evidence.remaining, dropCount === undefined ? 0 : 8 - dropCount)
  assert.equal(evidence.serverConfirmed, false)
})

test('R2 L2: drop bị ngắt giữ evidence của từng click đã hoàn tất', async () => {
  const bot = new DogfoodBot()
  const item = { slot: 9, type: 10, metadata: 0, name: 'paper', displayName: 'Target', count: 8 }
  bot.held = [item]
  bot.inventory.slots[9] = item
  bot.clickWindow = async slot => {
    bot.droppedSlots.push(slot)
    item.count--
    bot.emit('end', 'lost connection')
  }
  const run = await runScenario(bot, [{ id: 'drop', action: 'drop_item', itemIncludes: 'Target', count: 3 }])
  assert.equal(run.steps[0]?.verdict, 'INCONCLUSIVE')
  assert.deepEqual(bot.droppedSlots, [9])
  const evidence = run.steps[0]?.evidence as { dropped: number; remaining: number; completedClicks: number }
  assert.equal(evidence.dropped, 1)
  assert.equal(evidence.remaining, 7)
  assert.equal(evidence.completedClicks, 1)
})

test('R2 L4: thiếu item ở slot đã chọn không nói sai tổng đang giữ', async () => {
  const bot = new DogfoodBot()
  bot.held = [9, 10].map(slot => ({ slot, type: 10, metadata: 0,
    name: 'paper', displayName: 'Target', count: 8 }))
  const run = await runScenario(bot, [{ id: 'drop', action: 'drop_item', itemIncludes: 'Target', count: 10 }])
  assert.match(run.steps[0]?.message ?? '', /only 8 in selected slot 9/)
  assert.deepEqual(bot.droppedSlots, [])
})

test('R2 L6: capture có tổng budget cho cả burst event, không chỉ từng regex', async t => {
  // This test isolates the aggregate guard from OS VM wall-clock preemption.
  // Real hostile-regex interruption is covered by capture-redos.ts separately.
  let evaluations = 0
  t.mock.method(Script.prototype, 'runInNewContext', (context: { pattern: string; text: string; group: number }) => {
    evaluations++
    return new RegExp(context.pattern).exec(context.text)?.[context.group]
  })
  const run = await runScenario(new DogfoodBot(), [{ id: 'capture', action: 'capture',
    name: 'code', pattern: 'Code: (.+)', source: 'chat', timeoutMs: 4000 }], (_run, bot) => {
    bot.emit('messagestr', 'Code: OLD')
    for (let index = 0; index < 160; index++) bot.emit('messagestr', `noise-${index}`)
  })
  assert.equal(run.steps[0]?.verdict, 'INCONCLUSIVE')
  assert.match(run.steps[0]?.message ?? '', /INCONCLUSIVE_CAPTURE_PATTERN:.*total/)
  assert.ok(evaluations > 0 && evaluations <= 128)
})

test('R3-07: late drop completion không sửa evidence của step/run đã kết thúc', async () => {
  const bot = new DogfoodBot()
  const item = { slot: 9, type: 10, metadata: 0, name: 'paper', displayName: 'Target', count: 8 }
  bot.held = [item]
  bot.inventory.slots[9] = item
  let complete: () => void = () => {}
  bot.clickWindow = async () => {
    item.count--
    await new Promise<void>(resolve => { complete = resolve })
  }
  const run = await runScenario(bot, [
    { id: 'drop', action: 'drop_item', itemIncludes: 'Target', count: 3, timeoutMs: 40, optional: true },
    { id: 'after', action: 'wait', durationMs: 0 }
  ])
  const before = JSON.stringify(run.steps)
  complete()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(JSON.stringify(run.steps), before)
  assert.equal(run.steps[1]?.status, 'passed')
  assert.equal((run.steps[0]?.evidence as { inFlight: boolean }).inFlight, true)
})

test('R3-07 late guard: finished run không có abort reason vẫn là INCONCLUSIVE', async () => {
  const bot = new DogfoodBot()
  const item = { slot: 9, type: 10, metadata: 0, name: 'paper', displayName: 'Target', count: 8 }
  bot.held = [item]
  bot.inventory.slots[9] = item
  const scenario = scenarioSchema.parse({ name: 'late-drop', steps: [
    { id: 'drop', action: 'drop_item', itemIncludes: 'Target', count: 1 }
  ] })
  const run = new TestRun(scenario, {
    host: 'localhost', port: 25565, username: 'offline-fixture', auth: 'offline'
  }, '.')
  run.bot = bot as never
  run.currentStep = 'drop'
  bot.clickWindow = async () => { item.count--; run.finishedAt = new Date() }
  const seam = run as unknown as {
    executeStep(step: unknown, signal: AbortSignal, cursor: number): Promise<unknown>
  }
  const signal = new AbortController().signal
  await assert.rejects(seam.executeStep(scenario.steps[0], signal, 0),
    /INCONCLUSIVE_DROP: run finished during click/)
  assert.equal(signal.aborted, false)
})

test('R2: drop phải chặn GUI hoặc cursor bận trước mọi inventory API', async () => {
  for (const boundary of ['gui', 'cursor'] as const) {
    const bot = new DogfoodBot()
    bot.held = [{ slot: 9, type: 10, metadata: 0, name: 'paper', displayName: 'Target', count: 8 }]
    if (boundary === 'gui') bot.currentWindow = { id: 1 }
    else bot.inventory.selectedItem = bot.held[0]
    const run = await runScenario(bot, [
      { id: 'blocked-drop', action: 'drop_item', itemIncludes: 'Target', count: 1, timeoutMs: 1_000 }
    ])
    assert.equal(run.status, 'failed', boundary)
    assert.deepEqual(bot.droppedSlots, [], boundary)
    assert.match(run.steps[0]?.message ?? '', /GUI|cursor/)
  }
})

test('R2: assert_inventory không bỏ sót giáp, off-hand và cursor', async () => {
  const require = createRequire(import.meta.url)
  const windows = require('prismarine-windows')('1.21.11')
  for (const slot of [5, 8, 45, 'cursor'] as const) {
    const bot = new DogfoodBot()
    const inventory = windows.createWindow(0, 'minecraft:inventory', 'Inventory')
    const item = { slot: typeof slot === 'number' ? slot : -1,
      type: 10, metadata: 0, name: 'paper', displayName: 'Target', count: 1 }
    if (slot === 'cursor') inventory.selectedItem = item
    else inventory.slots[slot] = item
    assert.equal(inventory.items().length, 0, 'thư viện items() không nhìn slot này')
    bot.inventory = inventory
    const run = await runScenario(bot, [{ id: 'not-lost', action: 'assert_inventory',
      itemIncludes: 'Target', maximum: 0, timeoutMs: 1_000 }])
    assert.equal(run.status, 'failed', String(slot))
    assert.match(run.steps[0]?.message ?? '', /found 1/)
  }
})

test('R2: inventory trong GUI dùng player slots đang hiển thị, không dùng bản sao cũ', async () => {
  const require = createRequire(import.meta.url)
  const windows = require('prismarine-windows')('1.21.11')
  const bot = new DogfoodBot()
  const inventory = windows.createWindow(0, 'minecraft:inventory', 'Inventory')
  const window = windows.createWindow(1, 'minecraft:generic_9x6', 'Chest')
  inventory.slots[9] = { slot: 9, type: 10, name: 'paper', displayName: 'Target', count: 1 }
  // Player slot bản GUI đã mất item, nhưng bản sao base vẫn còn cho tới close.
  bot.inventory = inventory
  bot.currentWindow = window
  const run = await runScenario(bot, [{ id: 'absent', action: 'assert_inventory',
    itemIncludes: 'Target', maximum: 0, timeoutMs: 1_000 }])
  assert.equal(run.status, 'passed')
  assert.deepEqual(run.steps[0]?.evidence, { count: 0, scope: 'player-owned-client-slots', serverConfirmed: false })
})

test('R2 M3: inventory không được PASS vắng mặt khi item ở input menu tạm', async () => {
  const windows = createRequire(import.meta.url)('prismarine-windows')('1.21.11')
  for (const type of ['anvil', 'crafting', 'grindstone', 'smithing']) {
    const bot = new DogfoodBot()
    bot.inventory = windows.createWindow(0, 'minecraft:inventory', 'Inventory')
    const window = windows.createWindow(1, `minecraft:${type}`, 'Menu')
    const input = window.craftingResultSlot === 0 ? 1 : 0
    window.slots[input] = { slot: input, type: 10, name: 'paper', displayName: 'Target', count: 1 }
    bot.currentWindow = window
    const run = await runScenario(bot, [{ id: 'absent', action: 'assert_inventory',
      itemIncludes: 'Target', maximum: 0, timeoutMs: 1000 }])
    assert.equal(run.steps[0]?.verdict, 'INCONCLUSIVE', type)
    assert.match(run.steps[0]?.message ?? '', /INCONCLUSIVE_INVENTORY_SCOPE/)
  }
})

test('R3-05: item selector cùng chuỗi và canonical equivalent không lệch vì lowercase trước NFC', async () => {
  for (const itemIncludes of ['J\u030Cade', '\u01F0ade']) {
    const bot = new DogfoodBot()
    bot.inventory.slots[9] = { slot: 9, type: 10, metadata: 0,
      name: 'paper', displayName: 'J\u030Cade', count: 1 }
    const run = await runScenario(bot, [{ id: 'unicode-item', action: 'assert_inventory',
      itemIncludes, exactly: 1, timeoutMs: 1000 }])
    assert.equal(run.status, 'passed', itemIncludes)
  }
})

test('R2 L5: selectors không phụ thuộc locale mặc định của host', () => {
  const child = spawnSync(process.execPath, ['--import', 'tsx', 'test/fixtures/selector-locale.ts'], {
    encoding: 'utf8', timeout: 10_000, windowsHide: true
  })
  assert.equal(child.error, undefined)
  assert.equal(child.status, 0, child.stderr)
  assert.match(child.stdout, /selector-locale: PASS/)
})

test('R2: regex backtracking có budget độc lập với event-loop timeout', () => {
  const child = spawnSync(process.execPath, ['--import', 'tsx', 'test/fixtures/capture-redos.ts'], {
    encoding: 'utf8', timeout: 10_000, windowsHide: true
  })
  assert.equal(child.error, undefined, 'regex không được treo subprocess tới timeout ngoài')
  assert.equal(child.status, 0, child.stderr)
  assert.match(child.stdout, /INCONCLUSIVE_CAPTURE_PATTERN:/)
})

test('R2 M4: entity count selector nhận NFC và NFD giống nhau', async () => {
  const bot = new DogfoodBot()
  bot.entities.npc = { id: 9, uuid: '11111111-1111-4111-8111-111111111111',
    name: 'Mảnh Thành Trì', position: new Vec3(1, 64, 0) }
  const run = await runScenario(bot, [{ id: 'count', action: 'assert_nearby_entity',
    nameIncludes: 'Mảnh Thành Trì'.normalize('NFD'), exactly: 1, timeoutMs: 1000 }])
  assert.equal(run.status, 'passed')
  const evidence = run.steps[0]?.evidence as { stableSamples: number; stableMs: number }
  assert.ok(evidence.stableSamples >= 3)
  assert.ok(evidence.stableMs >= 200)
})

test('R2 M1/M7: missing capture là thiếu quan sát, không phải lỗi sản phẩm', async () => {
  const run = await runScenario(new DogfoodBot(), [
    { id: 'before', action: 'capture', name: 'code', pattern: 'Code: (.+)', optional: true, timeoutMs: 30 },
    { id: 'after', action: 'assert_capture', name: 'code', pattern: 'Code: (.+)', timeoutMs: 1000 }
  ])
  assert.equal(run.steps[0]?.verdict, 'INCONCLUSIVE')
  assert.match(run.steps[1]?.message ?? '', /INCONCLUSIVE_CAPTURE_MISSING/)
  assert.equal(run.report().verdict, 'INCONCLUSIVE')
  const timeout = await runScenario(new DogfoodBot(), [{
    id: 'capture', action: 'capture', name: 'code', pattern: 'Code: (.+)', timeoutMs: 30
  }])
  assert.equal(timeout.steps[0]?.verdict, 'INCONCLUSIVE')
})

test('R2 L3: capture không chấp nhận giá trị rỗng làm identity', async () => {
  const run = await runScenario(new DogfoodBot(), [{
    id: 'code', action: 'capture', name: 'code', pattern: 'Code:(.*)', source: 'chat', timeoutMs: 1000
  }], (_run, bot) => bot.emit('messagestr', 'Code:'))
  assert.equal(run.steps[0]?.verdict, 'INCONCLUSIVE')
  assert.match(run.steps[0]?.message ?? '', /empty/)
})

test('R2 H2: capture bỏ qua event quá dài để tìm response hợp lệ', async () => {
  const run = await runScenario(new DogfoodBot(), [{
    id: 'code', action: 'capture', name: 'code', pattern: 'Code: (.+)', timeoutMs: 1000
  }], (_run, bot) => {
    bot.emit('messagestr', 'Code: ABCD')
    bot.emit('messagestr', 'x'.repeat(4097))
  })
  assert.equal(run.status, 'passed')
  assert.deepEqual(run.steps[0]?.evidence, { captured: 'code', value: 'ABCD' })
})

test('R2 interruption: library reject sau disconnect không phải product FAIL', async () => {
  const bot = new DogfoodBot()
  Object.assign(bot, { fish: async () => {
    bot.emit('end', 'lost connection')
    throw new Error('library fishing task stopped')
  } })
  const run = await runScenario(bot, [{ id: 'fish', action: 'fish', attempts: 1, timeoutMs: 1000 }])
  assert.equal(run.steps[0]?.verdict, 'INCONCLUSIVE')
  assert.equal(run.report().verdict, 'INCONCLUSIVE')
  assert.match(run.steps[0]?.message ?? '', /Connection ended/)
})

test('R2 interruption: library resolve sau cancel không chạy lần fish kế tiếp', async () => {
  const bot = new DogfoodBot()
  let attempts = 0
  Object.assign(bot, { fish: async () => {
    attempts++
    bot.emit('end', 'lost connection')
  } })
  const run = await runScenario(bot, [{ id: 'fish', action: 'fish', attempts: 2, timeoutMs: 1000 }])
  assert.equal(attempts, 1)
  assert.equal(run.steps[0]?.verdict, 'INCONCLUSIVE')
})

test('R2: disconnect/cancel không biến thiếu quan sát thành lỗi sản phẩm', async () => {
  for (const mode of ['disconnect', 'cancel'] as const) {
    for (const step of [
      { id: 'count', action: 'assert_nearby_entity', nameIncludes: 'villager', minimum: 2 },
      { id: 'capture', action: 'capture', name: 'code', pattern: 'Code: (.+)' }
    ]) {
      const run = await runScenario(new DogfoodBot(), [{ ...step, timeoutMs: 1_000 }],
        (run, bot) => mode === 'cancel' ? run.cancel() : bot.emit('end', 'lost connection'))
      assert.equal(run.steps[0]?.verdict, 'INCONCLUSIVE')
      assert.equal(run.report().verdict, 'INCONCLUSIVE')
      assert.match(run.steps[0]?.message ?? '', /Connection ended|Run cancelled/)
    }
  }
})

test('R2 M2: count không PASS ở mẫu đầu trước spawn packet tiếp theo', async () => {
  const bot = new DogfoodBot()
  bot.entities.first = { id: 1, uuid: '11111111-1111-4111-8111-111111111111',
    name: 'item', position: new Vec3(1, 64, 0) }
  const run = await runScenario(bot, [{ id: 'count', action: 'assert_nearby_entity',
    nameIncludes: 'item', exactly: 1, timeoutMs: 700 }], (_run, bot) => {
    bot.entities.second = { id: 2, uuid: '22222222-2222-4222-8222-222222222222',
      name: 'item', position: new Vec3(2, 64, 0) }
  })
  assert.equal(run.status, 'failed')
  const evidence = run.steps[0]?.evidence as { count: number; samples: number }
  assert.equal(evidence.count, 2)
  assert.ok(evidence.samples >= 2)
})

test('R3-01: count timeout khi thiếu mẫu ổn định là INCONCLUSIVE', async () => {
  const bot = new DogfoodBot()
  bot.entities.only = { id: 1, uuid: '11111111-1111-4111-8111-111111111111',
    name: 'item', position: new Vec3(1, 64, 0) }
  const run = await runScenario(bot, [
    { id: 'settle', action: 'wait', durationMs: 0 },
    { id: 'count', action: 'assert_nearby_entity', nameIncludes: 'item', exactly: 1, timeoutMs: 400 }
  ], run => {
    // Simulate an observer that obtains only one valid sample before timeout.
    const seam = run as unknown as { poll(check: () => unknown, signal: AbortSignal): Promise<unknown> }
    seam.poll = (check, signal) => {
      check()
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    }
  })
  assert.equal(run.steps[1]?.verdict, 'INCONCLUSIVE')
  assert.equal((run.steps[1]?.evidence as { count: number }).count, 1)
})

test('R3-02 correction: UUID exact identity khớp cùng policy với pin không đếm', async () => {
  const bot = new DogfoodBot()
  bot.entities.other = { id: 1, uuid: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
    name: 'villager', position: new Vec3(1, 64, 0) }
  const run = await runScenario(bot, [{ id: 'count', action: 'assert_nearby_entity',
    nameIncludes: 'villager', requiredUuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    exactly: 1, timeoutMs: 500 }])
  assert.equal((run.steps[0]?.evidence as { count: number }).count, 0)
  assert.equal(run.status, 'failed')
})

test('R2: count không được bỏ qua requiredUuid dù có entity cùng tên', async () => {
  for (const uuid of ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']) {
    const bot = new DogfoodBot()
    bot.entities.other = {
      id: 2, uuid,
      name: 'villager', position: new Vec3(1, 64, 0)
    }
    const run = await runScenario(bot, [{
      id: 'pinned-count', action: 'assert_nearby_entity', nameIncludes: 'villager',
      requiredUuid: '11111111-1111-4111-8111-111111111111', exactly: 1, timeoutMs: 800
    }])
    assert.equal(run.status, uuid.startsWith('11111111') ? 'passed' : 'failed')
    assert.equal((run.steps[0]?.evidence as { count: number }).count, uuid.startsWith('11111111') ? 1 : 0)
  }
})

test('R2: capture từ chối quá 512 ký tự, không cắt rồi so hai mã khác thành giống', async () => {
  const run = await runScenario(new DogfoodBot(), [
    { id: 'capture-code', action: 'capture', name: 'code', pattern: 'Code: (.+)',
      source: 'chat', timeoutMs: 1_000 }
  ], (_run, bot) => bot.emit('messagestr', `Code: ${'a'.repeat(512)}X`))
  assert.equal(run.status, 'failed')
  assert.match(run.steps[0]?.message ?? '', /512/)
})

// Emission nằm sau lần scan đầu nhưng trước deadline: vòng lặp cũ ngủ 100ms rồi
// thoát mà không scan lần cuối, nên mất toàn bộ message trong cửa sổ dưới 100ms.
test('R2: notText bắt message đến trong nhịp chờ cuối, không báo PASS giả', async () => {
  const run = await runScenario(new DogfoodBot(), [
    { id: 'absence', action: 'wait_for_text', notText: 'forbidden', source: 'chat',
      durationMs: 20, timeoutMs: 1_000 }
  ], (_run, bot) => bot.emit('messagestr', 'forbidden'))
  assert.equal(run.status, 'failed')
  assert.match(run.steps[0]?.message ?? '', /Forbidden text observed/)
})
