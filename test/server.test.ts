import assert from 'node:assert/strict'
import test from 'node:test'
import type { CapabilityManifest } from '../src/capability-manifest.js'
import { createProviderRegistry, type ResolvedAuthorizedPlan } from '../src/provider-registry.js'
import { createServer } from '../src/server.js'
import { scenarioSchema } from '../src/scenario.js'
import { buildArtifactTargetBinding } from '../src/target-binding.js'
import type { RunStatus } from '../src/types.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(next => { resolve = next })
  return { promise, resolve }
}

const scenario = scenarioSchema.parse({
  name: 'queue-test',
  steps: [{ id: 'wait', action: 'wait', durationMs: 1 }]
})

const capabilityManifest: CapabilityManifest = {
  schemaVersion: 1,
  git: { commit: '3339f2229679a0cf78aa31b8a35ea9ea2ae2d29d', dirty: true },
  runtime: { node: 'v22.22.0', platform: 'win32', arch: 'x64' },
  codeRoot: 'src', packageJsonSha256: '1'.repeat(64),
  loadedPackageJson: { path: 'package.json', sha256: '1'.repeat(64) },
  packageLockSha256: '2'.repeat(64), sourceFingerprint: '3'.repeat(64),
  sources: [{ path: 'src/server.ts', sha256: '4'.repeat(64) }],
  dependencies: [], capabilities: [{ name: 'gui-journey', mode: 'runtime-wired' }]
}

function planRequest() {
  return {
    schemaVersion: 1 as const,
    scenario: 'queue-test',
    providers: [{
      kind: 'server-probe' as const,
      id: 'paper-probe',
      version: '1.0.0',
      instanceId: 'fixture-a',
      capabilities: ['jvm-observation'],
      authorizationId: 'approval-fixture-a',
      requiredScope: ['artifact-observe'],
      targetRoot: 'fixtures/paper-a',
      mutationClass: 'observe-only' as const
    }]
  }
}

const targetBinding = buildArtifactTargetBinding({
  schemaVersion: 1,
  bindingId: 'server-target',
  provider: { kind: 'filesystem-snapshot', id: 'fixture-resolver', version: '1.0.0' },
  authorization: { id: 'approval-20260827', scope: ['artifact-bind'] },
  artifacts: [
    { logicalId: 'candidate', role: 'candidate', logicalPath: 'plugins/Plugin.jar', sha256: '5'.repeat(64) },
    { logicalId: 'paper', role: 'paper', logicalPath: 'server/paper.jar', sha256: '6'.repeat(64) },
    { logicalId: 'config', role: 'config', logicalPath: 'plugins/Plugin/config.yml', sha256: '7'.repeat(64) }
  ]
})

test('default server collect capability manifest và target binding eager khi createServer', async () => {
  let collections = 0
  let bindingLoads = 0
  const app = createServer({
    logger: false,
    capabilityManifestCollector: () => { collections++; return capabilityManifest },
    targetBindingFile: 'fixture-binding.json',
    targetBindingLoader: file => {
      bindingLoads++
      assert.equal(file, 'fixture-binding.json')
      return targetBinding
    }
  })
  try {
    assert.equal(collections, 1)
    assert.equal(bindingLoads, 1)
  } finally {
    await app.close()
  }
})

test('server injected runFactory không đọc target binding file', async () => {
  let bindingLoads = 0
  const app = createServer({
    logger: false,
    targetBindingFile: 'must-not-read.json',
    targetBindingLoader: () => { bindingLoads++; throw new Error('must not read') },
    runFactory: () => ({
      id: 'injected', status: 'queued', start: async () => {}, cancel: () => {},
      persistCancelled: async () => {}, view: () => ({}), report: () => ({})
    })
  })
  try {
    assert.equal(bindingLoads, 0)
  } finally {
    await app.close()
  }
})

test('API queues FIFO, exposes pressure, rejects overflow and cancels queued runs without starting them', async t => {
  const gates = [deferred(), deferred(), deferred()]
  const starts: string[] = []
  const persisted: string[] = []
  const created: Array<{ id: string; status: RunStatus }> = []
  let nextId = 0

  const app = createServer({
    logger: false,
    queueCapacity: 1,
    scenarioLoader: async () => scenario,
    runFactory: () => {
      const index = nextId++
      const run = {
        id: `run-${index + 1}`,
        status: 'queued' as RunStatus,
        async start() {
          starts.push(this.id)
          this.status = 'running'
          await gates[index].promise
          if ((this.status as RunStatus) !== 'cancelled') this.status = 'passed'
        },
        cancel() { this.status = 'cancelled' },
        async persistCancelled() { persisted.push(this.id) },
        view() { return { runId: this.id, status: this.status } },
        report() { return { runId: this.id, status: this.status } }
      }
      created.push(run)
      return run
    }
  })
  t.after(() => app.close())

  const first = await app.inject({ method: 'POST', url: '/api/runs', payload: { scenario: 'queue-test' } })
  const second = await app.inject({ method: 'POST', url: '/api/runs', payload: { scenario: 'queue-test' } })
  const overflow = await app.inject({ method: 'POST', url: '/api/runs', payload: { scenario: 'queue-test' } })

  assert.equal(first.statusCode, 202)
  assert.equal(second.statusCode, 202)
  assert.equal(overflow.statusCode, 429)
  assert.deepEqual(starts, ['run-1'])

  const health = await app.inject({ method: 'GET', url: '/health' })
  assert.deepEqual(health.json().queue, { active: 1, pending: 1, capacity: 1 })

  const cancelled = await app.inject({ method: 'POST', url: '/api/runs/run-2/cancel' })
  assert.equal(cancelled.statusCode, 200)
  assert.equal(cancelled.json().status, 'cancelled')
  assert.deepEqual(persisted, ['run-2'])

  gates[0].resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(starts, ['run-1'])
  assert.equal(created[1].status, 'cancelled')
})

test('server provider-registry mode resolve authorized plan trước scenario/run creation', async t => {
  const registry = createProviderRegistry([{
    declaration: {
      schemaVersion: 1,
      kind: 'server-probe',
      id: 'paper-probe',
      version: '1.0.0',
      instanceId: 'fixture-a',
      capabilities: ['jvm-observation'],
      authorization: { id: 'approval-fixture-a', scope: ['artifact-observe'] },
      targetRoot: 'fixtures/paper-a',
      mutationClass: 'observe-only'
    },
    port: Object.freeze({ name: 'probe-port' })
  }])
  const order: string[] = []
  let resolution: Readonly<ResolvedAuthorizedPlan> | undefined
  const app = createServer({
    logger: false,
    providerRegistry: registry,
    scenarioLoader: async (_directory, name) => {
      order.push(`scenario:${name}`)
      return scenario
    },
    runFactory: (_scenario, resolvedPlan) => {
      order.push('run')
      resolution = resolvedPlan
      return {
        id: 'authorized-run', status: 'queued', start: async () => {}, cancel: () => {},
        persistCancelled: async () => {}, view: () => ({}), report: () => ({})
      }
    }
  })
  t.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: '/api/runs',
    payload: {
      authorizedPlan: {
        schemaVersion: 1,
        scenario: 'queue-test',
        providers: [{
          kind: 'server-probe', id: 'paper-probe', version: '1.0.0', instanceId: 'fixture-a',
          capabilities: ['jvm-observation'], authorizationId: 'approval-fixture-a',
          requiredScope: ['artifact-observe'], targetRoot: 'fixtures/paper-a', mutationClass: 'observe-only'
        }]
      }
    }
  })

  assert.equal(response.statusCode, 202)
  assert.deepEqual(order, ['scenario:queue-test', 'run'])
  assert.equal(resolution?.scenario, 'queue-test')
  assert.equal(Object.isFrozen(resolution), true)
  assert.equal(Object.isFrozen(resolution?.providers), true)
})

test('server provider-registry mode sanitize unexpected registry failure trước scenario/run', async t => {
  let scenarioLoads = 0
  let runs = 0
  const app = createServer({
    logger: false,
    providerRegistry: {
      resolve: () => { throw new Error('secret/registry/path') }
    },
    scenarioLoader: async () => { scenarioLoads += 1; return scenario },
    runFactory: () => {
      runs += 1
      throw new Error('must not create')
    }
  })
  t.after(() => app.close())

  const response = await app.inject({ method: 'POST', url: '/api/runs', payload: {
    authorizedPlan: planRequest()
  } })
  assert.equal(response.statusCode, 500)
  assert.equal(response.json().error, 'Provider registry failed')
  assert.equal(response.body.includes('secret'), false)
  assert.equal(scenarioLoads, 0)
  assert.equal(runs, 0)
})

test('server provider-registry mode reject resolution do registry khác cấp', async t => {
  const otherRegistry = createProviderRegistry([{
    declaration: {
      schemaVersion: 1,
      kind: 'server-probe', id: 'paper-probe', version: '1.0.0', instanceId: 'fixture-a',
      capabilities: ['jvm-observation'],
      authorization: { id: 'approval-fixture-a', scope: ['artifact-observe'] },
      targetRoot: 'fixtures/paper-a', mutationClass: 'observe-only'
    },
    port: {}
  }])
  let scenarioLoads = 0
  let runs = 0
  const app = createServer({
    logger: false,
    providerRegistry: { resolve: input => otherRegistry.resolve(input) },
    scenarioLoader: async () => { scenarioLoads += 1; return scenario },
    runFactory: () => {
      runs += 1
      throw new Error('must not create')
    }
  })
  t.after(() => app.close())

  const response = await app.inject({ method: 'POST', url: '/api/runs', payload: {
    authorizedPlan: planRequest()
  } })
  assert.equal(response.statusCode, 400)
  assert.equal(response.json().error, 'Authorized plan is invalid')
  assert.equal(scenarioLoads, 0)
  assert.equal(runs, 0)
})

test('server provider-registry mode reject forged registry resolution trước scenario/run', async t => {
  let scenarioLoads = 0
  let runs = 0
  const app = createServer({
    logger: false,
    providerRegistry: {
      resolve: () => ({
        schemaVersion: 1,
        scenario: 'queue-test',
        providers: []
      })
    },
    scenarioLoader: async () => { scenarioLoads += 1; return scenario },
    runFactory: () => {
      runs += 1
      throw new Error('must not create')
    }
  })
  t.after(() => app.close())

  const response = await app.inject({ method: 'POST', url: '/api/runs', payload: {
    authorizedPlan: planRequest()
  } })
  assert.equal(response.statusCode, 400)
  assert.equal(response.json().error, 'Authorized plan is invalid')
  assert.equal(scenarioLoads, 0)
  assert.equal(runs, 0)
})

test('server provider-registry mode snapshot registry option đúng một lần', async t => {
  const actualRegistry = createProviderRegistry([{
    declaration: {
      schemaVersion: 1,
      kind: 'server-probe', id: 'paper-probe', version: '1.0.0', instanceId: 'fixture-a',
      capabilities: ['jvm-observation'],
      authorization: { id: 'approval-fixture-a', scope: ['artifact-observe'] },
      targetRoot: 'fixtures/paper-a', mutationClass: 'observe-only'
    },
    port: {}
  }])
  let reads = 0
  const app = createServer({
    logger: false,
    get providerRegistry() {
      reads += 1
      if (reads > 1) throw new Error('secret/registry/path')
      return actualRegistry
    },
    scenarioLoader: async () => scenario,
    runFactory: () => ({
      id: 'snapshot-registry', status: 'queued', start: async () => {}, cancel: () => {},
      persistCancelled: async () => {}, view: () => ({}), report: () => ({})
    })
  })
  t.after(() => app.close())

  const response = await app.inject({ method: 'POST', url: '/api/runs', payload: {
    authorizedPlan: planRequest()
  } })
  assert.equal(response.statusCode, 202)
  assert.equal(reads, 1)
})

test('server provider-registry mode reject scenario loader mismatch trước run creation', async t => {
  const registry = createProviderRegistry([{
    declaration: {
      schemaVersion: 1,
      kind: 'server-probe', id: 'paper-probe', version: '1.0.0', instanceId: 'fixture-a',
      capabilities: ['jvm-observation'],
      authorization: { id: 'approval-fixture-a', scope: ['artifact-observe'] },
      targetRoot: 'fixtures/paper-a', mutationClass: 'observe-only'
    },
    port: {}
  }])
  let runs = 0
  const app = createServer({
    logger: false,
    providerRegistry: registry,
    scenarioLoader: async () => scenarioSchema.parse({
      name: 'different-scenario', steps: [{ id: 'wait', action: 'wait', durationMs: 1 }]
    }),
    runFactory: () => {
      runs += 1
      throw new Error('must not create')
    }
  })
  t.after(() => app.close())

  const response = await app.inject({ method: 'POST', url: '/api/runs', payload: {
    authorizedPlan: planRequest()
  } })
  assert.equal(response.statusCode, 400)
  assert.equal(runs, 0)
})

test('server provider-registry mode fail closed trước scenario/run khi provider thiếu hoặc plan malformed', async t => {
  const registry = createProviderRegistry([{
    declaration: {
      schemaVersion: 1,
      kind: 'server-probe', id: 'paper-probe', version: '1.0.0', instanceId: 'fixture-a',
      capabilities: ['jvm-observation'],
      authorization: { id: 'approval-fixture-a', scope: ['artifact-observe'] },
      targetRoot: 'fixtures/paper-a', mutationClass: 'observe-only'
    },
    port: {}
  }])
  let scenarioLoads = 0
  let runs = 0
  const app = createServer({
    logger: false,
    providerRegistry: registry,
    scenarioLoader: async () => { scenarioLoads += 1; return scenario },
    runFactory: () => {
      runs += 1
      return {
        id: 'must-not-create', status: 'queued', start: async () => {}, cancel: () => {},
        persistCancelled: async () => {}, view: () => ({}), report: () => ({})
      }
    }
  })
  t.after(() => app.close())

  const missing = await app.inject({
    method: 'POST', url: '/api/runs', payload: {
      authorizedPlan: {
        schemaVersion: 1,
        scenario: 'queue-test',
        providers: [{
          kind: 'server-probe', id: 'missing-probe', version: '1.0.0', instanceId: 'fixture-a',
          capabilities: ['jvm-observation'], authorizationId: 'approval-fixture-a',
          requiredScope: ['artifact-observe'], targetRoot: 'fixtures/paper-a', mutationClass: 'observe-only'
        }]
      }
    }
  })
  assert.equal(missing.statusCode, 409)
  assert.equal(missing.json().failure.code, 'INCONCLUSIVE_PROVIDER_UNAVAILABLE')
  assert.equal(missing.json().failure.boundedDetail, 'Required provider is unavailable or unauthorized')

  const malformed = await app.inject({
    method: 'POST', url: '/api/runs', payload: { scenario: 'queue-test' }
  })
  assert.equal(malformed.statusCode, 400)
  assert.equal(scenarioLoads, 0)
  assert.equal(runs, 0)
})

test('closing the API cancels queued and active runs and waits for idle', async () => {
  const activeGate = deferred()
  const cancelled: string[] = []
  const persisted: string[] = []
  let nextId = 0
  const app = createServer({
    logger: false,
    queueCapacity: 1,
    scenarioLoader: async () => scenario,
    runFactory: () => {
      const id = `shutdown-${++nextId}`
      return {
        id,
        status: 'queued' as RunStatus,
        async start() {
          this.status = 'running'
          await activeGate.promise
        },
        cancel() { cancelled.push(id); this.status = 'cancelled' },
        async persistCancelled() { persisted.push(id) },
        view() { return { runId: id, status: this.status } },
        report() { return { runId: id, status: this.status } }
      }
    }
  })

  await app.inject({ method: 'POST', url: '/api/runs', payload: { scenario: 'queue-test' } })
  await app.inject({ method: 'POST', url: '/api/runs', payload: { scenario: 'queue-test' } })
  const closing = app.close()
  let closed = false
  void closing.then(() => { closed = true })
  await new Promise(resolve => setImmediate(resolve))

  assert.deepEqual(cancelled, ['shutdown-2', 'shutdown-1'])
  assert.deepEqual(persisted, ['shutdown-2'])
  assert.equal(closed, false)

  activeGate.resolve()
  await closing
  assert.equal(closed, true)
})
