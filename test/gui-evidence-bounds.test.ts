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

  loadPlugin(): void {}
  closeWindow(): void { this.currentWindow = null }
  quit(): void { queueMicrotask(() => this.emit('end', 'quit')) }
}

const minecraft = { host: 'localhost', port: 25565, username: 'tester', auth: 'offline' as const }

function largeWindow(title: string): object {
  return {
    id: 10, type: 'minecraft:generic_9x6', title,
    slots: Array.from({ length: 90 }, (_, slot) => ({
      slot, name: 'paper', displayName: `Item ${slot}`, count: 1, customLore: []
    }))
  }
}

test('wait_for_gui chỉ giữ GUI đã bound cho run view khi title chưa khớp', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-gui-view-bounds-'))
  const bot = new GuiBot()
  bot.currentWindow = largeWindow('Đặt nguyên liệu - plot_1')
  const scenario = scenarioSchema.parse({
    name: 'GUI view bounds', maxDurationMs: 1_000,
    steps: [{ id: 'payment-gui', action: 'wait_for_gui', titleIncludes: 'Xác nhận thanh toán', timeoutMs: 25 }]
  })
  const run = new TestRun(scenario, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    await started

    assert.equal(run.steps[0]?.status, 'failed')
    const view = run.view() as { gui: { slotCount: number; items: unknown[] } | null }
    assert.equal(view.gui?.slotCount, 90)
    assert.equal(view.gui?.items.length, 64)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('wait_for_gui vẫn khớp title và trả evidence đã bound khi GUI lớn', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-gui-evidence-bounds-'))
  const bot = new GuiBot()
  bot.currentWindow = largeWindow('Xác nhận thanh toán')
  const scenario = scenarioSchema.parse({
    name: 'GUI evidence bounds', maxDurationMs: 1_000,
    steps: [{ id: 'payment-gui', action: 'wait_for_gui', titleIncludes: 'Xác nhận thanh toán', timeoutMs: 25 }]
  })
  const run = new TestRun(scenario, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })

  try {
    const started = run.start()
    bot.emit('spawn')
    await started

    assert.equal(run.steps[0]?.status, 'passed')
    const evidence = run.steps[0]?.evidence as { slotCount: number; items: unknown[] }
    assert.equal(evidence.slotCount, 90)
    assert.equal(evidence.items.length, 64)
    const view = run.view() as { gui: { items: unknown[] } | null }
    assert.equal(view.gui?.items.length, 64)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})
