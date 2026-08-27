import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { verifyEvidenceBundle } from '../src/evidence-bundle.js'
import { TestRun } from '../src/runner.js'
import { scenarioSchema } from '../src/scenario.js'
import { artifactTargetBindingSha256, buildArtifactTargetBinding } from '../src/target-binding.js'

class ReportBot extends EventEmitter {
  currentWindow: object | null = null
  entity = { position: { x: 0, y: 64, z: 0 } }
  health = 20
  food = 20
  version = '1.21.11'
  protocolVersion = '774'
  game = { dimension: 'minecraft:overworld' }
  pathfinder = { stop: () => {}, setMovements: () => {} }

  loadPlugin(): void {}
  closeWindow(): void {}
  quit(): void { queueMicrotask(() => this.emit('end', 'quit')) }
}

const minecraft = { host: 'localhost', port: 25565, username: 'tester', auth: 'offline' as const }

function createRun(reportDir: string, bot: ReportBot, targetBinding?: ReturnType<typeof buildArtifactTargetBinding>): TestRun {
  const scenario = scenarioSchema.parse({
    name: 'immutable report', maxDurationMs: 1_000,
    steps: [{ id: 'done', action: 'wait', durationMs: 0 }]
  })
  return new TestRun(scenario, minecraft, reportDir, {
    createBot: () => bot as never,
    prepareNavigation: () => {},
    connectTimeoutMs: 100,
    disconnectTimeoutMs: 100,
    ...(targetBinding ? { targetBinding } : {})
  })
}

const targetBinding = buildArtifactTargetBinding({
  schemaVersion: 1,
  bindingId: 'persistence-target',
  provider: { kind: 'filesystem-snapshot', id: 'fixture-resolver', version: '1.0.0' },
  authorization: { id: 'approval-20260827', scope: ['artifact-bind'] },
  artifacts: [
    { logicalId: 'candidate', role: 'candidate', logicalPath: 'plugins/Plugin.jar', sha256: '5'.repeat(64) },
    { logicalId: 'paper', role: 'paper', logicalPath: 'server/paper.jar', sha256: '6'.repeat(64) },
    { logicalId: 'config', role: 'config', logicalPath: 'plugins/Plugin/config.yml', sha256: '7'.repeat(64) }
  ]
})

async function startRun(run: TestRun, bot: ReportBot): Promise<void> {
  const started = run.start()
  bot.emit('spawn')
  await started
}

test('TestRun persist report create-new và không để temp artifact', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-report-persistence-'))
  const bot = new ReportBot()
  const run = createRun(reportDir, bot)
  try {
    await startRun(run, bot)
    const fileName = `${run.id}.json`
    const sealFileName = `${run.id}.bundle.json`
    assert.deepEqual(new Set(await readdir(reportDir)), new Set([fileName, sealFileName]))
    assert.deepEqual(
      JSON.parse(await readFile(path.join(reportDir, fileName), 'utf8')),
      JSON.parse(JSON.stringify(run.report()))
    )
    const seal = await verifyEvidenceBundle(reportDir, sealFileName)
    assert.equal(seal.runId, run.id)
    assert.equal(seal.scenarioSha256, run.report().manifest.scenario.sha256)
    assert.deepEqual(seal.artifacts.map(artifact => ({ role: artifact.role, fileName: artifact.fileName })), [
      { role: 'report', fileName }
    ])
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('TestRun artifact-bound ghi cùng canonical target binding hash vào report và seal', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-report-target-binding-'))
  const bot = new ReportBot()
  const run = createRun(reportDir, bot, targetBinding)
  try {
    await startRun(run, bot)
    const report = JSON.parse(await readFile(path.join(reportDir, `${run.id}.json`), 'utf8'))
    const seal = await verifyEvidenceBundle(reportDir, `${run.id}.bundle.json`)
    const expectedHash = artifactTargetBindingSha256(targetBinding)
    assert.equal(report.manifest.evidence.targetBindingSha256, expectedHash)
    assert.deepEqual(report.manifest.evidence.targetBinding, targetBinding)
    assert.equal(seal.targetBindingSha256, expectedHash)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('TestRun từ chối report collision và bảo toàn bytes có trước', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-report-collision-'))
  const bot = new ReportBot()
  const run = createRun(reportDir, bot)
  const reportPath = path.join(reportDir, `${run.id}.json`)
  try {
    await writeFile(reportPath, 'pre-existing', { encoding: 'utf8', flag: 'wx' })

    await assert.rejects(startRun(run, bot), /already exists/i)
    assert.equal(await readFile(reportPath, 'utf8'), 'pre-existing')
    assert.deepEqual(await readdir(reportDir), [`${run.id}.json`])
    assert.equal(run.status, 'failed')
    assert.equal(run.report().verdict, 'FAIL')
    assert.match(run.error ?? '', /persist/i)
    assert.equal(run.report().timeline.at(-1)?.type, 'persist_error')
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('TestRun dùng ordinal an toàn cho route artifact thay vì raw step ID', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-route-artifact-name-'))
  const run = createRun(reportDir, new ReportBot())
  run.steps.push({
    id: 'đi tới plot / A B', action: 'observe_route', status: 'passed', verdict: 'PASS',
    startedAt: new Date().toISOString(), durationMs: 1, message: 'Completed',
    evidence: {
      routePixelMap: {
        checkpoints: [{ id: 'A', position: { x: 0, y: 64, z: 0 }, radius: 1 }],
        fences: [], samples: []
      }
    }
  })
  try {
    run.cancel()
    await run.persistCancelled()
    const expected = new Set([
      `${run.id}.json`, `${run.id}.bundle.json`,
      `${run.id}-step-0001-route-map.json`, `${run.id}-step-0001-route-map.html`
    ])
    assert.deepEqual(new Set(await readdir(reportDir)), expected)
    await verifyEvidenceBundle(reportDir, `${run.id}.bundle.json`)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})
