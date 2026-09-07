import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { verifyEvidenceBundle, writeEvidenceBundle } from '../src/evidence-bundle.js'
import { scenarioSchema } from '../src/scenario.js'

const RUN_ID = 'atomic-run-1'
const SCENARIO_SHA = 'a'.repeat(64)

test('bundle write thất bại giữa chừng không để lại artifact orphan', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-bundle-atomic-'))
  try {
    await assert.rejects(writeEvidenceBundle(directory, `${RUN_ID}.bundle.json`, {
      runId: RUN_ID,
      scenarioSha256: SCENARIO_SHA,
      artifacts: [
        { role: 'report', fileName: `${RUN_ID}.json`, content: '{"verdict":"PASS"}' },
        { role: 'other', fileName: `${RUN_ID}-oversized.json`, content: 'x'.repeat(17 * 1024 * 1024) }
      ]
    }), /exceeds/)

    assert.deepEqual(await readdir(directory), [],
      'artifact đã ghi phải được rollback khi seal không hoàn tất')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('bundle write hỏng vẫn cho phép retry cùng runId và verify thành công', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-bundle-retry-'))
  try {
    await assert.rejects(writeEvidenceBundle(directory, `${RUN_ID}.bundle.json`, {
      runId: RUN_ID,
      scenarioSha256: SCENARIO_SHA,
      artifacts: [
        { role: 'report', fileName: `${RUN_ID}.json`, content: '{"verdict":"PASS"}' },
        { role: 'other', fileName: `${RUN_ID}-oversized.json`, content: 'x'.repeat(17 * 1024 * 1024) }
      ]
    }))

    const manifest = await writeEvidenceBundle(directory, `${RUN_ID}.bundle.json`, {
      runId: RUN_ID,
      scenarioSha256: SCENARIO_SHA,
      artifacts: [{ role: 'report', fileName: `${RUN_ID}.json`, content: '{"verdict":"PASS"}' }]
    })

    assert.equal(manifest.runId, RUN_ID)
    assert.equal(manifest.artifacts.length, 1)
    await verifyEvidenceBundle(directory, `${RUN_ID}.bundle.json`)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('bundle rollback giữ nguyên artifact đã tồn tại từ trước của run khác', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-bundle-preserve-'))
  try {
    await writeEvidenceBundle(directory, 'other-run.bundle.json', {
      runId: 'other-run',
      scenarioSha256: SCENARIO_SHA,
      artifacts: [{ role: 'report', fileName: 'other-run.json', content: '{"verdict":"PASS"}' }]
    })
    const before = (await readdir(directory)).sort()

    await assert.rejects(writeEvidenceBundle(directory, `${RUN_ID}.bundle.json`, {
      runId: RUN_ID,
      scenarioSha256: SCENARIO_SHA,
      artifacts: [
        { role: 'report', fileName: `${RUN_ID}.json`, content: '{"verdict":"PASS"}' },
        { role: 'other', fileName: `${RUN_ID}-oversized.json`, content: 'x'.repeat(17 * 1024 * 1024) }
      ]
    }))

    assert.deepEqual((await readdir(directory)).sort(), before,
      'rollback chỉ được xóa artifact của chính lần ghi hỏng')
    await verifyEvidenceBundle(directory, 'other-run.bundle.json')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('scenario schema chặn số step vượt bound', () => {
  const step = (id: string) => ({ id, action: 'wait', durationMs: 1 })
  const withSteps = (count: number) => ({
    name: 'bounded steps',
    steps: Array.from({ length: count }, (_, index) => step(`s${index}`))
  })

  assert.doesNotThrow(() => scenarioSchema.parse(withSteps(256)))
  assert.throws(() => scenarioSchema.parse(withSteps(257)), /too big|at most|256/i)
})

test('observe_crossing evidence bị cắt bounded và ghi rõ số sample đã bỏ', async () => {
  const { TestRun } = await import('../src/runner.js')
  const { EventEmitter } = await import('node:events')

  class MovingBot extends EventEmitter {
    currentWindow: object | null = null
    entity = { position: { x: 0, y: 64, z: 0 } }
    health = 20
    food = 20
    version = '1.21.11'
    protocolVersion = '774'
    game = { dimension: 'minecraft:overworld' }
    target = { id: 7, uuid: '3d1d6e6d-6f19-4214-b794-f3ba0c202a1d', name: 'player',
      username: 'Alex', displayName: 'Alex', position: { x: 0, y: 64, z: 0 } }
    entities: Record<number, object> = { 7: this.target }
    pathfinder = { stop: () => {}, setMovements: () => {} }
    loadPlugin(): void {}
    blockAt(): null { return null }
    closeWindow(): void {}
    quit(): void { queueMicrotask(() => this.emit('end', 'quit')) }
  }

  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-crossing-bound-'))
  const bot = new MovingBot()
  const scenario = scenarioSchema.parse({
    name: 'crossing bound',
    maxDurationMs: 4_000,
    steps: [{
      id: 'cross', action: 'observe_crossing', nameIncludes: 'Alex',
      approach: { x: 0.5, y: 64, z: 0.5 }, exit: { x: 2.5, y: 64, z: 0.5 },
      sampleMs: 50, timeoutMs: 300
    }]
  })
  const run = new TestRun(
    scenario,
    { host: 'localhost', port: 25565, username: 'tester', auth: 'offline' },
    reportDir,
    { createBot: () => bot as never, prepareNavigation: () => {},
      connectTimeoutMs: 100, disconnectTimeoutMs: 100 }
  )

  try {
    const started = run.start()
    bot.emit('spawn')
    // Đợi step crossing gắn listener entityMoved rồi mới đẩy sample.
    await new Promise(resolve => setTimeout(resolve, 60))
    for (let index = 0; index < 900; index += 1) {
      bot.target.position = { x: 0.5 + (index % 3) * 0.01, y: 64, z: 0.5 }
      bot.emit('entityMoved', bot.target)
    }
    await started

    const evidence = run.steps[0]?.evidence as {
      observations?: unknown[]
      truncatedObservationCount?: number
    } | undefined
    assert.ok(evidence, 'phải có evidence cho step crossing')
    assert.ok((evidence.observations?.length ?? 0) <= 512,
      `observations phải bounded, thực tế ${evidence.observations?.length}`)
    assert.ok((evidence.truncatedObservationCount ?? 0) > 0,
      'phải ghi rõ số sample bị cắt khi vượt bound')
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})
