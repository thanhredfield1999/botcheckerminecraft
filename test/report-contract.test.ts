import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { CapabilityManifest } from '../src/capability-manifest.js'
import { TestRun } from '../src/runner.js'
import { scenarioSchema } from '../src/scenario.js'
import { artifactTargetBindingSha256, buildArtifactTargetBinding } from '../src/target-binding.js'

class ReportBot extends EventEmitter {
  currentWindow: object | null = null
  entity = { position: { x: 1, y: 64, z: 2 } }
  health = 20
  food = 20
  version = '1.21.11'
  protocolVersion = '774'
  game = { dimension: 'minecraft:overworld' }
  _getDimensionName = () => 'StillCliff'
  pathfinder = { stop: () => {}, setMovements: () => {} }

  loadPlugin(): void {}
  closeWindow(): void {}
  quit(): void { queueMicrotask(() => this.emit('end', 'quit')) }
}

const minecraft = {
  host: '127.0.0.1', port: 25565, username: 'tester', auth: 'offline' as const,
  password: 'khong-duoc-ghi-vao-report', version: '1.21.11'
}

const capabilityManifest: CapabilityManifest = {
  schemaVersion: 1,
  git: { commit: '3339f2229679a0cf78aa31b8a35ea9ea2ae2d29d', dirty: true },
  runtime: { node: 'v22.22.0', platform: 'win32', arch: 'x64' },
  codeRoot: 'src',
  packageJsonSha256: '1'.repeat(64),
  loadedPackageJson: { path: 'package.json', sha256: '1'.repeat(64) },
  packageLockSha256: '2'.repeat(64),
  sourceFingerprint: '3'.repeat(64),
  sources: [{ path: 'src/runner.ts', sha256: '4'.repeat(64) }],
  dependencies: [{ name: 'mineflayer', version: '4.37.1' }],
  capabilities: [{ name: 'gui-journey', mode: 'runtime-wired' }]
}

const targetBinding = buildArtifactTargetBinding({
  schemaVersion: 1,
  bindingId: 'report-contract-target',
  provider: { kind: 'filesystem-snapshot', id: 'fixture-resolver', version: '1.0.0' },
  authorization: { id: 'approval-20260827', scope: ['artifact-bind'] },
  artifacts: [
    { logicalId: 'candidate', role: 'candidate', logicalPath: 'plugins/Plugin.jar', sha256: '5'.repeat(64) },
    { logicalId: 'paper', role: 'paper', logicalPath: 'server/paper.jar', sha256: '6'.repeat(64) },
    { logicalId: 'config', role: 'config', logicalPath: 'plugins/Plugin/config.yml', sha256: '7'.repeat(64) }
  ]
})

async function execute(message: string) {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-report-contract-'))
  const bot = new ReportBot()
  const scenario = scenarioSchema.parse({
    name: 'report contract',
    maxDurationMs: 1_000,
    steps: [{ id: 'oracle', action: 'wait_for_text', text: message, source: 'chat', timeoutMs: 20 }]
  })
  const run = new TestRun(scenario, minecraft, reportDir, {
    createBot: () => bot as never,
    prepareNavigation: () => {},
    connectTimeoutMs: 100,
    disconnectTimeoutMs: 100,
    sourceRevision: 'a'.repeat(40)
  })
  const started = run.start()
  bot.emit('spawn')
  await started
  return { run, reportDir }
}

test('report phân biệt lỗi assertion thành FAIL', async () => {
  const { run, reportDir } = await execute('khong-xuat-hien')
  try {
    assert.equal(run.steps[0]?.verdict, 'FAIL')
    assert.equal(run.report().verdict, 'FAIL')
    assert.deepEqual(run.report().manifest.evidence, {
      evidenceGrade: 'development-unbound', releaseEligible: false
    })
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('manifest ghi provenance ổn định và loại credentials', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-manifest-'))
  const bot = new ReportBot()
  const scenario = scenarioSchema.parse({
    name: 'manifest success', maxDurationMs: 1_000,
    steps: [{ id: 'done', action: 'wait', durationMs: 0 }]
  })
  const run = new TestRun(scenario, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100,
    sourceRevision: capabilityManifest.git.commit, capabilityManifest, targetBinding
  })
  try {
    const started = run.start()
    bot.emit('spawn')
    await started
    const report = run.report()

    assert.equal(report.verdict, 'PASS')
    assert.equal(report.steps[0]?.verdict, 'PASS')
    assert.equal(report.manifest.schemaVersion, 1)
    assert.deepEqual(report.manifest.runner, {
      name: 'botcheckerminecraft', version: '0.1.0', sourceRevision: capabilityManifest.git.commit
    })
    assert.deepEqual(report.manifest.capability, capabilityManifest)
    assert.deepEqual(report.manifest.evidence, {
      evidenceGrade: 'artifact-bound', releaseEligible: false,
      targetBinding,
      targetBindingSha256: artifactTargetBindingSha256(targetBinding)
    })
    assert.equal(report.manifest.scenario.name, 'manifest success')
    assert.match(report.manifest.scenario.sha256, /^[a-f0-9]{64}$/)
    assert.deepEqual(report.manifest.target, {
      host: '127.0.0.1', port: 25565, configuredVersion: '1.21.11'
    })
    assert.deepEqual(report.manifest.observed, {
      negotiatedVersion: '1.21.11', protocolVersion: '774',
      serverWorld: 'StillCliff', dimension: 'overworld'
    })
    const serialized = JSON.stringify(report)
    assert.doesNotMatch(serialized, /khong-duoc-ghi-vao-report|"password"|"username"/)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('manifest ghi metadata QA nhưng không ghi credentials', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-qa-manifest-'))
  const bot = new ReportBot()
  const scenario = scenarioSchema.parse({
    name: 'qa metadata',
    qa: {
      project: 'ExamplePlugin', fixture: 'paper-fixture-1', accountRole: 'player',
      authorization: ['read-only'], phase: 'negative-security'
    },
    steps: [{ id: 'done', action: 'wait', durationMs: 0 }]
  })
  const run = new TestRun(scenario, minecraft, reportDir, {
    createBot: () => bot as never, prepareNavigation: () => {},
    connectTimeoutMs: 100, disconnectTimeoutMs: 100
  })
  try {
    const started = run.start()
    bot.emit('spawn')
    await started
    assert.deepEqual(run.report().manifest.qa, {
      project: 'ExamplePlugin', fixture: 'paper-fixture-1', accountRole: 'player',
      authorization: ['read-only'], phase: 'negative-security'
    })
    assert.doesNotMatch(JSON.stringify(run.report()), /khong-duoc-ghi-vao-report|"password"/)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('TestRun từ chối sourceRevision mâu thuẫn capability manifest', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-manifest-mismatch-'))
  const scenario = scenarioSchema.parse({
    name: 'manifest mismatch', maxDurationMs: 1_000,
    steps: [{ id: 'done', action: 'wait', durationMs: 0 }]
  })
  try {
    assert.throws(() => new TestRun(scenario, minecraft, reportDir, {
      sourceRevision: 'a'.repeat(40), capabilityManifest
    }), /does not match capability manifest/i)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('TestRun từ chối GIT_COMMIT fallback mâu thuẫn capability manifest', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-manifest-env-mismatch-'))
  const previous = process.env.GIT_COMMIT
  process.env.GIT_COMMIT = 'a'.repeat(40)
  const scenario = scenarioSchema.parse({
    name: 'manifest env mismatch', maxDurationMs: 1_000,
    steps: [{ id: 'done', action: 'wait', durationMs: 0 }]
  })
  try {
    assert.throws(() => new TestRun(scenario, minecraft, reportDir, {
      capabilityManifest
    }), /does not match capability manifest/i)
  } finally {
    if (previous === undefined) delete process.env.GIT_COMMIT
    else process.env.GIT_COMMIT = previous
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('TestRun không để sourceRevision rỗng vô hiệu hóa GIT_COMMIT fallback', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-manifest-empty-revision-'))
  const previous = process.env.GIT_COMMIT
  process.env.GIT_COMMIT = capabilityManifest.git.commit
  const scenario = scenarioSchema.parse({
    name: 'manifest empty revision', maxDurationMs: 1_000,
    steps: [{ id: 'done', action: 'wait', durationMs: 0 }]
  })
  try {
    const run = new TestRun(scenario, minecraft, reportDir, {
      sourceRevision: '   ', capabilityManifest
    })
    assert.equal(run.report().manifest.runner.sourceRevision, capabilityManifest.git.commit)
  } finally {
    if (previous === undefined) delete process.env.GIT_COMMIT
    else process.env.GIT_COMMIT = previous
    await rm(reportDir, { recursive: true, force: true })
  }
})
