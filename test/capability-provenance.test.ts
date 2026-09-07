import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  collectEntrypointReachableModules,
  collectRuntimeCapabilityManifest
} from '../src/capability-manifest.js'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('import graph từ entrypoint được derive từ source thật, không phải bảng tay', () => {
  const reachable = collectEntrypointReachableModules(rootDir, 'src')

  // Entrypoint và các module nó thực sự kéo theo.
  for (const expected of ['index', 'server', 'runner', 'config', 'queue',
    'scenario', 'evidence-bundle', 'evidence-writer', 'provider-registry',
    'target-binding', 'route-oracle', 'protocol-diagnostic', 'failure-envelope']) {
    assert.equal(reachable.has(expected), true, `${expected} phải reachable từ index`)
  }

  // Module library-only: tồn tại trên đĩa nhưng không nằm trong import graph.
  for (const unreachable of ['paper-bukkit-online-player-claim',
    'paper-bukkit-online-player-loopback-client', 'paper-bukkit-online-player-transport-codec',
    'paper-process-filesystem-observer', 'paper-process-tcp-listener-observer',
    'paper-process-session-lock-observer', 'google-cloud-kms-signing-backend',
    'multi-client-runner', 'compatibility-matrix']) {
    assert.equal(reachable.has(unreachable), false,
      `${unreachable} không được reachable từ index`)
  }
})

test('capability mode khớp exact import graph, không phải sự tồn tại của file', () => {
  const manifest = collectRuntimeCapabilityManifest({ rootDir })
  const reachable = collectEntrypointReachableModules(rootDir, manifest.codeRoot)

  const moduleOf: Record<string, string> = {
    'authorized-provider-registry': 'provider-registry',
    'evidence-bundle': 'evidence-bundle',
    'immutable-artifacts': 'evidence-writer',
    'failure-envelope': 'failure-envelope',
    'gui-journey': 'runner',
    'route-oracle': 'route-oracle',
    'protocol-diagnostics': 'protocol-diagnostic',
    'target-artifact-binding': 'target-binding',
    'paper-bukkit-online-player-claim': 'paper-bukkit-online-player-claim',
    'multi-client': 'multi-client-runner',
    'compatibility-matrix': 'compatibility-matrix'
  }

  for (const capability of manifest.capabilities) {
    const module = moduleOf[capability.name]
    if (!module) continue
    const expected = reachable.has(module) ? 'runtime-wired' : 'library-only'
    assert.equal(capability.mode, expected,
      `capability ${capability.name} (module ${module}) phải là ${expected}`)
  }
})

test('paper-bukkit-adapter nằm trong auxiliary provenance của manifest', () => {
  const manifest = collectRuntimeCapabilityManifest({ rootDir })
  assert.equal(manifest.schemaVersion, 2)

  const adapter = manifest.auxiliaryCode?.find(
    component => component.component === 'paper-bukkit-adapter')
  assert.ok(adapter, 'phải có auxiliary component paper-bukkit-adapter')
  assert.equal(adapter.sourceRoot, 'paper-bukkit-adapter')
  assert.ok(adapter.sources.length >= 17,
    `phải hash mọi .java của adapter, hiện ${adapter.sources.length}`)
  assert.ok(
    adapter.sources.some(source => source.path.endsWith('PaperBukkitOnlinePlayerPlugin.java')),
    'plugin main phải nằm trong provenance')
  assert.ok(
    adapter.sources.some(source =>
      source.path.includes('keystore-companion')),
    'keystore companion phải nằm trong provenance')
})

test('manifest.target ghi effective auth mode chứ không im lặng', async () => {
  const { TestRun } = await import('../src/runner.js')
  const { scenarioSchema } = await import('../src/scenario.js')
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')

  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-auth-manifest-'))
  try {
    const scenario = scenarioSchema.parse({
      name: 'auth-manifest', steps: [{ id: 'wait', action: 'wait', durationMs: 1 }]
    })
    const run = new TestRun(
      scenario,
      { host: 'localhost', port: 25565, username: 'tester', auth: 'microsoft' },
      reportDir,
      {}
    )
    const target = run.report().manifest.target as { auth?: string }
    assert.equal(target.auth, 'microsoft',
      'manifest.target phải ghi rõ auth mode thật của run')
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})
