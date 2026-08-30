import assert from 'node:assert/strict'
import test from 'node:test'
import {
  InvalidAuthorizedPlanError,
  ProviderAdmissionError,
  createProviderRegistry
} from '../src/provider-registry.js'
import { TestRun } from '../src/runner.js'
import { scenarioSchema } from '../src/scenario.js'

function declaration(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1 as const,
    kind: 'server-probe' as const,
    id: 'paper-probe',
    version: '1.0.0',
    instanceId: 'fixture-a',
    capabilities: ['jvm-observation'],
    authorization: { id: 'approval-fixture-a', scope: ['artifact-observe'] },
    targetRoot: 'fixtures/paper-a',
    mutationClass: 'observe-only' as const,
    ...overrides
  }
}

function plan(overrides: Record<string, unknown> = {}) {
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
    }],
    ...overrides
  }
}

test('provider registry resolve exact authorized plan thành immutable provider snapshot', () => {
  const port = Object.freeze({ name: 'probe-port' })
  const registry = createProviderRegistry([{ declaration: declaration(), port }])

  const resolved = registry.resolve(plan())

  assert.equal(resolved.scenario, 'queue-test')
  assert.equal(resolved.providers.length, 1)
  assert.equal(resolved.providers[0].port, port)
  assert.equal(Object.isFrozen(resolved), true)
  assert.equal(Object.isFrozen(resolved.providers), true)
  assert.equal(Object.isFrozen(resolved.providers[0]), true)
  assert.equal(Object.isFrozen(resolved.providers[0].declaration), true)
  assert.equal(Object.isFrozen(resolved.providers[0].declaration.capabilities), true)
  assert.equal(Object.isFrozen(resolved.providers[0].declaration.authorization), true)
  assert.equal(Object.isFrozen(resolved.providers[0].declaration.authorization.scope), true)
})

test('provider registry fail closed khi provider thiếu hoặc metadata/authorization mismatch', () => {
  const registry = createProviderRegistry([{ declaration: declaration(), port: {} }])
  const mismatches = [
    { id: 'missing-probe' },
    { version: '2.0.0' },
    { instanceId: 'fixture-b' },
    { capabilities: ['jvm-observation', 'tick-events'] },
    { authorizationId: 'approval-other' },
    { requiredScope: ['artifact-observe', 'tick-observe'] },
    { targetRoot: 'fixtures/paper-b' },
    { mutationClass: 'isolated-process-lifecycle' }
  ]

  for (const mismatch of mismatches) {
    const input = plan({ providers: [{ ...plan().providers[0], ...mismatch }] })
    assert.throws(
      () => registry.resolve(input),
      error => {
        assert.equal(error instanceof ProviderAdmissionError, true)
        const failure = (error as ProviderAdmissionError).failure
        assert.equal(failure.code, 'INCONCLUSIVE_PROVIDER_UNAVAILABLE')
        assert.equal(failure.provider, 'provider-registry')
        assert.equal(failure.trustBoundary, 'external-provider')
        assert.equal(failure.boundedDetail, 'Required provider is unavailable or unauthorized')
        assert.equal(failure.boundedDetail.includes(String(Object.values(mismatch)[0])), false)
        assert.equal(Object.isFrozen(failure), true)
        assert.equal(Object.isFrozen(failure.artifactRefs), true)
        return true
      }
    )
  }
})

test('provider registry reject Proxy array thay đổi cardinality giữa guard và snapshot', () => {
  const registrations = Array.from({ length: 33 }, (_, index) => ({
    declaration: declaration({ id: `paper-probe-${index}` }),
    port: {}
  }))
  let lengthReads = 0
  const hostile = new Proxy(registrations, {
    get(target, property, receiver) {
      if (property === 'length') {
        lengthReads += 1
        return lengthReads <= 2 ? 32 : 33
      }
      return Reflect.get(target, property, receiver)
    }
  })

  assert.throws(() => createProviderRegistry(hostile), /^Error: Provider registry is invalid$/)
})

test('provider registry reject duplicate identity, duplicate requirement và malformed/credential-like plan', () => {
  assert.throws(
    () => createProviderRegistry([
      { declaration: declaration(), port: {} },
      { declaration: declaration(), port: {} }
    ]),
    /registry is invalid/
  )

  const registry = createProviderRegistry([{ declaration: declaration(), port: {} }])
  assert.throws(
    () => registry.resolve(plan({ providers: [plan().providers[0], plan().providers[0]] })),
    (error: unknown) => error instanceof InvalidAuthorizedPlanError
  )
  assert.throws(
    () => registry.resolve(plan({ scenario: 'token-plan' })),
    (error: unknown) => error instanceof InvalidAuthorizedPlanError
  )
  assert.throws(
    () => registry.resolve({ ...plan(), extra: true }),
    (error: unknown) => error instanceof InvalidAuthorizedPlanError
  )
})

test('TestRun manifest bind authorized provider metadata nhưng không persist provider port', () => {
  const declarationInput = declaration()
  const port = Object.freeze({ invoke: () => 'must-not-serialize' })
  const registry = createProviderRegistry([{ declaration: declarationInput, port }])
  const resolved = registry.resolve(plan())
  const run = new TestRun(
    scenarioSchema.parse({ name: 'queue-test', steps: [{ id: 'wait', action: 'wait', durationMs: 1 }] }),
    { host: 'localhost', port: 25565, username: 'tester', auth: 'offline' },
    'reports',
    { authorizedPlan: resolved }
  )
  ;(declarationInput.capabilities as string[])[0] = 'mutated-capability'

  const manifest = run.report().manifest
  assert.equal(manifest.authorizedPlan?.scenario, 'queue-test')
  assert.deepEqual(manifest.authorizedPlan?.providers[0], {
    schemaVersion: 1,
    kind: 'server-probe',
    id: 'paper-probe',
    version: '1.0.0',
    instanceId: 'fixture-a',
    capabilities: ['jvm-observation'],
    authorization: { id: 'approval-fixture-a', scope: ['artifact-observe'] },
    targetRoot: 'fixtures/paper-a',
    mutationClass: 'observe-only'
  })
  assert.equal(JSON.stringify(manifest).includes('must-not-serialize'), false)
  assert.equal(Object.isFrozen(manifest.authorizedPlan), true)
  assert.equal(Object.isFrozen(manifest.authorizedPlan?.providers), true)
})

test('TestRun reject explicit null authorized plan thay vì coi như absent', () => {
  assert.throws(
    () => new TestRun(
      scenarioSchema.parse({ name: 'queue-test', steps: [{ id: 'wait', action: 'wait', durationMs: 1 }] }),
      { host: 'localhost', port: 25565, username: 'tester', auth: 'offline' },
      'reports',
      { authorizedPlan: null } as never
    ),
    /^InvalidAuthorizedPlanError: Authorized plan is invalid$/
  )
})

test('ProviderAdmissionError không cho tráo structured failure payload', () => {
  const error = new ProviderAdmissionError()
  assert.throws(
    () => { (error as { failure: unknown }).failure = { boundedDetail: 'secret/path' } },
    TypeError
  )
  assert.equal(error.failure.boundedDetail, 'Required provider is unavailable or unauthorized')
  assert.equal(Object.isFrozen(error), true)
})

test('TestRun reject forged resolved plan chưa qua provider registry', () => {
  const forged = {
    schemaVersion: 1,
    scenario: 'queue-test',
    providers: [{ declaration: declaration(), port: {} }]
  }
  assert.throws(
    () => new TestRun(
      scenarioSchema.parse({ name: 'queue-test', steps: [{ id: 'wait', action: 'wait', durationMs: 1 }] }),
      { host: 'localhost', port: 25565, username: 'tester', auth: 'offline' },
      'reports',
      { authorizedPlan: forged as never }
    ),
    /^InvalidAuthorizedPlanError: Authorized plan is invalid$/
  )
})

test('TestRun snapshot authorized plan dependency một lần và sanitize hostile getter', () => {
  const registry = createProviderRegistry([{ declaration: declaration(), port: {} }])
  const resolved = registry.resolve(plan())
  let reads = 0
  const dependencies = {
    get authorizedPlan() {
      reads += 1
      if (reads > 1) throw new Error('secret/dependency/path')
      return resolved
    }
  }
  const run = new TestRun(
    scenarioSchema.parse({ name: 'queue-test', steps: [{ id: 'wait', action: 'wait', durationMs: 1 }] }),
    { host: 'localhost', port: 25565, username: 'tester', auth: 'offline' },
    'reports',
    dependencies
  )
  assert.equal(run.report().manifest.authorizedPlan?.scenario, 'queue-test')
  assert.equal(reads, 1)

  assert.throws(
    () => new TestRun(
      scenarioSchema.parse({ name: 'queue-test', steps: [{ id: 'wait', action: 'wait', durationMs: 1 }] }),
      { host: 'localhost', port: 25565, username: 'tester', auth: 'offline' },
      'reports',
      Object.defineProperty({}, 'authorizedPlan', {
        get() { throw new Error('secret/dependency/path') }
      }) as never
    ),
    error => {
      assert.equal(String(error), 'InvalidAuthorizedPlanError: Authorized plan is invalid')
      assert.equal(String(error).includes('secret'), false)
      return true
    }
  )
})

test('TestRun reject authorized plan của scenario khác', () => {
  const registry = createProviderRegistry([{ declaration: declaration(), port: {} }])
  const resolved = registry.resolve(plan())
  assert.throws(
    () => new TestRun(
      scenarioSchema.parse({ name: 'different-scenario', steps: [{ id: 'wait', action: 'wait', durationMs: 1 }] }),
      { host: 'localhost', port: 25565, username: 'tester', auth: 'offline' },
      'reports',
      { authorizedPlan: resolved }
    ),
    /^Error: Authorized plan does not match scenario$/
  )
})

test('provider registry snapshot hostile getters đúng một lần và sanitize getter errors', () => {
  const reads = { declaration: 0, port: 0 }
  const registration = {
    get declaration() {
      reads.declaration += 1
      if (reads.declaration > 1) throw new Error('secret/declaration/path')
      return declaration()
    },
    get port() {
      reads.port += 1
      if (reads.port > 1) throw new Error('secret/port/path')
      return Object.freeze({ name: 'port' })
    }
  }
  const registry = createProviderRegistry([registration])
  assert.equal(registry.resolve(plan()).providers.length, 1)
  assert.deepEqual(reads, { declaration: 1, port: 1 })

  assert.throws(
    () => createProviderRegistry([Object.defineProperty({}, 'declaration', {
      enumerable: true,
      get() { throw new Error('secret/hostile/path') }
    }) as never]),
    error => {
      assert.equal(String(error), 'Error: Provider registry is invalid')
      assert.equal(String(error).includes('secret'), false)
      return true
    }
  )
})
