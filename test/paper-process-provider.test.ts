import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { createPaperProcessProvider } from '../src/paper-process-provider.js'
import { createProviderRegistry } from '../src/provider-registry.js'
import {
  artifactTargetBindingSha256,
  buildArtifactTargetBinding
} from '../src/target-binding.js'

const root = path.resolve('fixtures/paper-a')

function binding() {
  return buildArtifactTargetBinding({
    schemaVersion: 1,
    bindingId: 'paper-process-fixture-a',
    provider: {
      kind: 'paper-process',
      id: 'paper-process-fixture',
      version: '1.0.0',
      instanceId: 'fixture-a'
    },
    authorization: {
      id: 'approval-fixture-a',
      scope: ['isolated-fixture', 'process-preflight']
    },
    artifacts: [
      {
        logicalId: 'candidate', role: 'candidate',
        logicalPath: 'plugins/Plugin.jar', sha256: '1'.repeat(64)
      },
      {
        logicalId: 'paper', role: 'paper',
        logicalPath: 'server/paper.jar', sha256: '2'.repeat(64)
      },
      {
        logicalId: 'config-main', role: 'config',
        logicalPath: 'plugins/Plugin/config.yml', sha256: '3'.repeat(64)
      },
      {
        logicalId: 'probe', role: 'probe',
        logicalPath: 'plugins/BotCheckerProbe.jar', sha256: '4'.repeat(64)
      }
    ]
  })
}

function provider() {
  return createPaperProcessProvider({
    schemaVersion: 1,
    id: 'paper-process-fixture',
    version: '1.0.0',
    instanceId: 'fixture-a',
    approvedRoot: root,
    logicalRoot: 'fixtures/paper-a',
    port: 25580,
    sessionLockLogicalPath: 'world/session.lock',
    authorization: {
      id: 'approval-fixture-a',
      scope: ['isolated-fixture', 'process-preflight']
    },
    targetBinding: binding()
  })
}

function facts(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    root,
    paperSha256: '2'.repeat(64),
    candidateSha256: '1'.repeat(64),
    probeSha256: '4'.repeat(64),
    port: 25580,
    portListening: false,
    pid: null,
    sessionLockPresent: false,
    onlinePlayers: 0,
    authorizationId: 'approval-fixture-a',
    requiredScope: ['isolated-fixture', 'process-preflight'],
    ...overrides
  }
}

test('Paper process provider tạo immutable dry-run preview và compose registry admission', () => {
  const paper = provider()
  const preview = paper.preflight(facts())

  assert.deepEqual(preview, {
    schemaVersion: 1,
    providerId: 'paper-process-fixture',
    instanceId: 'fixture-a',
    approvedRoot: root,
    port: 25580,
    bootTokenRequired: true,
    factsAuthoritative: false,
    approvalAuthoritative: false,
    mutationAllowed: false,
    targetBindingSha256: artifactTargetBindingSha256(binding()),
    operations: [
      'backup-fixture',
      'start-paper',
      'wait-ready',
      'run-journey',
      'clean-stop',
      'verify-natural-exit',
      'restore-fixture'
    ],
    artifactSha256: {
      paper: '2'.repeat(64),
      candidate: '1'.repeat(64),
      probe: '4'.repeat(64)
    }
  })
  assert.equal(Object.isFrozen(preview), true)
  assert.equal(Object.isFrozen(preview.operations), true)
  assert.equal(Object.isFrozen(preview.artifactSha256), true)
  assert.equal(Object.isFrozen(paper.declaration), true)

  const registry = createProviderRegistry([{ declaration: paper.declaration, port: paper }])
  const resolved = registry.resolve({
    schemaVersion: 1,
    scenario: 'paper-preflight',
    providers: [{
      kind: 'paper-process',
      id: 'paper-process-fixture',
      version: '1.0.0',
      instanceId: 'fixture-a',
      capabilities: ['dry-run-preflight'],
      authorizationId: 'approval-fixture-a',
      requiredScope: ['isolated-fixture', 'process-preflight'],
      targetRoot: 'fixtures/paper-a',
      mutationClass: 'isolated-process-lifecycle'
    }]
  })
  assert.equal(resolved.providers[0]?.port, paper)
})

test('Paper process preflight fail closed với root/hash/port/PID/session/player/approval mismatch', () => {
  const paper = provider()
  const invalidFacts = [
    { root: path.resolve('fixtures/paper-b') },
    { paperSha256: '9'.repeat(64) },
    { candidateSha256: '9'.repeat(64) },
    { probeSha256: '9'.repeat(64) },
    { probeSha256: null },
    { port: 25581 },
    { portListening: true },
    { pid: 1234 },
    { sessionLockPresent: true },
    { onlinePlayers: 1 },
    { authorizationId: 'approval-other' },
    { requiredScope: ['isolated-fixture'] }
  ]

  for (const current of invalidFacts) {
    assert.throws(
      () => paper.preflight(facts(current)),
      error => {
        assert.equal(String(error), 'PaperProcessPreflightError: Paper process preflight rejected')
        assert.equal(String(error).includes(String(Object.values(current)[0])), false)
        return true
      }
    )
  }
})

test('Paper process provider reject Proxy scope containers fail closed', () => {
  const proxiedScope = new Proxy(['isolated-fixture', 'process-preflight'], {})
  assert.throws(
    () => createPaperProcessProvider({
      schemaVersion: 1,
      id: 'paper-process-fixture', version: '1.0.0', instanceId: 'fixture-a',
      approvedRoot: root, logicalRoot: 'fixtures/paper-a', port: 25580,
      sessionLockLogicalPath: 'world/session.lock',
      authorization: { id: 'approval-fixture-a', scope: proxiedScope },
      targetBinding: binding()
    }),
    /^Error: Paper process provider configuration is invalid$/
  )
  assert.throws(
    () => provider().preflight(facts({ requiredScope: proxiedScope })),
    /^PaperProcessPreflightError: Paper process preflight rejected$/
  )
})

test('Paper process provider không invoke caller callback và sanitize hostile nested config', () => {
  let calls = 0
  const callable = () => { calls += 1 }
  assert.throws(
    () => provider().preflight({ ...facts(), inspectPort: callable }),
    /^PaperProcessPreflightError: Paper process preflight rejected$/
  )
  assert.equal(calls, 0)

  assert.throws(
    () => createPaperProcessProvider({
      schemaVersion: 1,
      id: 'paper-process-fixture', version: '1.0.0', instanceId: 'fixture-a',
      approvedRoot: root, logicalRoot: 'fixtures/paper-a', port: 25580,
      sessionLockLogicalPath: 'world/session.lock',
      authorization: { id: 'approval-fixture-a', scope: ['isolated-fixture', 'process-preflight'] },
      targetBinding: Object.defineProperty({}, 'provider', {
        get() { throw new Error('secret/binding/path') }
      })
    }),
    error => {
      assert.equal(String(error), 'Error: Paper process provider configuration is invalid')
      assert.equal(String(error).includes('secret'), false)
      return true
    }
  )
})

test('Paper process provider reject production-like root, malformed config và hostile getters', () => {
  for (const approvedRoot of [
    path.parse(root).root,
    path.resolve('server'),
    path.resolve('production'),
    path.resolve('minecraftserver')
  ]) {
    assert.throws(
      () => createPaperProcessProvider({
        schemaVersion: 1,
        id: 'paper-process-fixture', version: '1.0.0', instanceId: 'fixture-a',
        approvedRoot, logicalRoot: 'fixtures/paper-a', port: 25580,
        sessionLockLogicalPath: 'world/session.lock',
        authorization: { id: 'approval-fixture-a', scope: ['isolated-fixture', 'process-preflight'] },
        targetBinding: binding()
      }),
      /^Error: Paper process provider configuration is invalid$/
    )
  }

  let rootReads = 0
  const hostile = {
    ...facts(),
    get root() {
      rootReads += 1
      if (rootReads > 1) throw new Error('secret/root/path')
      return root
    }
  }
  assert.doesNotThrow(() => provider().preflight(hostile))
  assert.equal(rootReads, 1)

  assert.throws(
    () => provider().preflight(Object.defineProperty({}, 'root', {
      get() { throw new Error('secret/root/path') }
    })),
    error => {
      assert.equal(String(error), 'PaperProcessPreflightError: Paper process preflight rejected')
      assert.equal(String(error).includes('secret'), false)
      return true
    }
  )
})
