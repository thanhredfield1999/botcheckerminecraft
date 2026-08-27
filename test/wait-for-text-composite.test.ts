import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { TestRun } from '../src/runner.js'
import { scenarioSchema } from '../src/scenario.js'

class TextBot extends EventEmitter {
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

test('wait_for_text allOf khớp nhiều predicate Unicode NFC trong cùng một event mới', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-composite-text-'))
  const bot = new TextBot()
  const scenario = scenarioSchema.parse({
    name: 'composite Unicode text',
    maxDurationMs: 1_000,
    steps: [{
      id: 'staff-search-line',
      action: 'wait_for_text',
      allOf: ['ux staff sword 001', 'ITEMGUARDSTAFFUX', 'Pha\u0301t hiện: 1 lần'],
      source: 'chat',
      timeoutMs: 200
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
    setTimeout(() => {
      bot.emit('messagestr', '- UX Staff Sword 001 | Chủ: ItemGuardStaffUX | Phát hiện: 1 lần')
    }, 25)
    await started

    assert.equal(run.status, 'passed')
    assert.equal(run.steps[0]?.status, 'passed')
    const evidence = run.steps[0]?.evidence as { eventIndex?: number; event?: { summary?: string } }
    assert.ok(Number.isInteger(evidence.eventIndex))
    assert.equal(evidence.event?.summary, '- UX Staff Sword 001 | Chủ: ItemGuardStaffUX | Phát hiện: 1 lần')
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})
