import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { TestRun } from '../src/runner.js'
import { scenarioSchema } from '../src/scenario.js'

class VisionBot extends EventEmitter {
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

interface FakeEvaluatorCall {
  pngBase64: string
  prompt: string
  apiKey: string | undefined
}

async function runVisionScenario(
  step: Record<string, unknown>,
  options: { window?: object, evaluator?: unknown, apiKey?: string, bot?: VisionBot } = {}
): Promise<{ run: TestRun, calls: FakeEvaluatorCall[] }> {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-vision-'))
  const bot = options.bot ?? new VisionBot()
  if (options.window !== undefined) bot.currentWindow = options.window
  const calls: FakeEvaluatorCall[] = []
  const evaluator = options.evaluator ?? {
    evaluate: async (input: { pngBase64: string, prompt: string }, auth: { apiKey: string | undefined }) => {
      calls.push({ pngBase64: input.pngBase64, prompt: input.prompt, apiKey: auth.apiKey })
      return { verdict: 'PASS' as const, code: 'PASS', reason: 'menu đúng' }
    }
  }
  const scenario = scenarioSchema.parse({
    name: 'vision test', maxDurationMs: 2_000,
    steps: [{ id: 'vision-check', action: 'assert_vision', prompt: 'item đúng không?', ...step }]
  })
  const run = new TestRun(scenario, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100,
    visionEvaluator: evaluator as never,
    visionApiKey: options.apiKey
  })
  const started = run.start()
  bot.emit('spawn')
  await started
  await rm(reportDir, { recursive: true, force: true })
  return { run, calls }
}

const window = {
  id: 1, type: 'minecraft:generic_9x1', title: 'ItemGuard - Recorded item history',
  inventoryStart: 9, slots: [
    { slot: 0, name: 'minecraft:diamond_sword', displayName: 'Diamond Sword', count: 1, customLore: ['Sharpness V'], nbt: undefined }
  ]
}

test('assert_vision render GUI ra PNG, gửi evaluator, PASS khi verdict khớp', async () => {
  const { run, calls } = await runVisionScenario({ expectVerdict: 'PASS' }, { window })
  assert.equal(run.status, 'passed')
  assert.equal(run.steps[0]?.status, 'passed')
  assert.equal(calls.length, 1)
  assert.ok(calls[0].pngBase64.length > 100, 'frame PNG base64 phải có nội dung')
  assert.ok(calls[0].prompt.includes('item đúng không?'))
  assert.equal(calls[0].apiKey, undefined)
  const evidence = run.steps[0]?.evidence as { verdict?: string, code?: string, framePngSha256?: string }
  assert.equal(evidence.verdict, 'PASS')
  assert.ok(evidence.framePngSha256 && /^[a-f0-9]{64}$/.test(evidence.framePngSha256))
})

test('assert_vision FAIL khi verdict của AI khác expectVerdict', async () => {
  const evaluator = {
    evaluate: async () => ({ verdict: 'FAIL' as const, code: 'FAIL', reason: 'title sai' })
  }
  const { run } = await runVisionScenario({ expectVerdict: 'PASS' }, { window, evaluator })
  assert.equal(run.status, 'failed')
  assert.equal(run.steps[0]?.status, 'failed')
  assert.match(run.steps[0]?.message ?? '', /Vision verdict FAIL/)
})

test('assert_vision INCONCLUSIVE khi chưa wire evaluator (fail-closed)', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-vision-unwired-'))
  const bot = new VisionBot()
  bot.currentWindow = window
  const scenario = scenarioSchema.parse({
    name: 'vision unwired', maxDurationMs: 2_000,
    steps: [{ id: 'vision-check', action: 'assert_vision', prompt: 'menu đúng chưa?' }]
  })
  const run = new TestRun(scenario, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })
  const started = run.start()
  bot.emit('spawn')
  await started
  await rm(reportDir, { recursive: true, force: true })
  assert.equal(run.status, 'failed')
  assert.match(run.steps[0]?.message ?? '', /INCONCLUSIVE_VISION_NOT_CONFIGURED/)
})

void assert