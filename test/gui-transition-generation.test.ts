import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { TestRun } from '../src/runner.js'
import { scenarioSchema } from '../src/scenario.js'

class TransitionBot extends EventEmitter {
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
    leftMouse: async (slot: number) => {
      this.clickedSlots.push(slot)
      setTimeout(() => {
        const previous = this.currentWindow
        this.currentWindow = null
        this.emit('windowClose', previous)
        this.currentWindow = {
          id: 9,
          type: 'minecraft:generic_9x1',
          title: 'Chi Tiết #1',
          slots: [{ slot: 0, name: 'arrow', displayName: 'Quay lại', count: 1, customLore: [] }]
        }
        this.emit('windowOpen', this.currentWindow)
      }, 25)
    },
    rightMouse: async () => {}
  }
}

const minecraft = { host: 'localhost', port: 25565, username: 'tester', auth: 'offline' as const }

test('assert_gui afterStep chờ generation mới dù window ID được tái sử dụng', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-gui-generation-'))
  const bot = new TransitionBot()
  bot.currentWindow = {
    id: 9,
    type: 'minecraft:generic_9x1',
    title: 'Lịch Sử Item',
    slots: [{ slot: 0, name: 'paper', displayName: 'Bản ghi', count: 1, customLore: [] }]
  }
  const scenario = scenarioSchema.parse({
    name: 'GUI generation transition',
    maxDurationMs: 1_000,
    steps: [
      { id: 'open-detail', action: 'click_gui', slot: 0, inspectDelayMs: 0, timeoutMs: 100 },
      {
        id: 'detail-ready',
        action: 'assert_gui',
        afterStep: 'open-detail',
        titleIncludes: 'Chi Tiết #1',
        items: [{ slot: 0, nameIncludes: 'Quay lại' }],
        timeoutMs: 200
      }
    ]
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
    assert.deepEqual(bot.clickedSlots, [0])
    const clickEvidence = run.steps[0]?.evidence as { windowGeneration?: number }
    const assertionEvidence = run.steps[1]?.evidence as { windowGeneration?: number }
    assert.ok(Number.isInteger(clickEvidence.windowGeneration))
    assert.ok((assertionEvidence.windowGeneration ?? -1) > (clickEvidence.windowGeneration ?? Infinity))
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('assert_gui afterStep không tái dùng GUI đã mở trong chính step tham chiếu', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-gui-completed-generation-'))
  const bot = new TransitionBot()
  const scenario = scenarioSchema.parse({
    name: 'GUI completion baseline',
    maxDurationMs: 1_000,
    steps: [
      { id: 'menu-ready', action: 'wait_for_gui', titleIncludes: 'Menu', timeoutMs: 100 },
      { id: 'must-be-new', action: 'assert_gui', afterStep: 'menu-ready', titleIncludes: 'Menu', timeoutMs: 40 }
    ]
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
    setTimeout(() => {
      bot.currentWindow = {
        id: 4,
        type: 'minecraft:generic_9x1',
        title: 'Menu',
        slots: []
      }
      bot.emit('windowOpen', bot.currentWindow)
    }, 10)
    await started

    assert.equal(run.status, 'failed')
    assert.equal(run.steps[0]?.status, 'passed')
    assert.equal(run.steps[1]?.status, 'failed')
    assert.equal((run.steps[1]?.evidence as { reason?: string })?.reason, 'window generation did not advance')
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})
