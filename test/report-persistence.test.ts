import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { verifyEvidenceBundle } from '../src/evidence-bundle.js'
import { TestRun, type SignedProviderEvidenceFactory } from '../src/runner.js'
import { scenarioSchema } from '../src/scenario.js'
import {
  buildSignedProviderClaimTrustStore,
  canonicalSignedProviderObservationBoundClaimV2
} from '../src/signed-provider-claim.js'
import { canonicalSignedProviderChallengeIdentityV1 } from '../src/signed-provider-claim-schema.js'
import { verifySignedProviderObservationBoundBundle } from '../src/signed-provider-evidence-bundle.js'
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

const signedProviderTargetBinding = buildArtifactTargetBinding({
  schemaVersion: 1,
  bindingId: 'runner-provider-target',
  provider: { kind: 'server-probe', id: 'runner-probe', version: '1.0.0', instanceId: 'fixture-a' },
  authorization: { id: 'approval-runner-provider', scope: ['artifact-bind'] },
  artifacts: [
    { logicalId: 'candidate', role: 'candidate', logicalPath: 'plugins/Plugin.jar', sha256: '1'.repeat(64) },
    { logicalId: 'paper', role: 'paper', logicalPath: 'server/paper.jar', sha256: '2'.repeat(64) },
    { logicalId: 'config', role: 'config', logicalPath: 'plugins/Plugin/config.yml', sha256: '3'.repeat(64) },
    { logicalId: 'probe', role: 'probe', logicalPath: 'plugins/Probe.jar', sha256: '4'.repeat(64) }
  ]
})

function structurallyValidProviderEnvelope(
  request: Parameters<SignedProviderEvidenceFactory>[0]
): unknown {
  const challengeWithoutId = {
    schemaVersion: 1 as const,
    domain: 'botcheckerminecraft.signed-provider-claim.v1' as const,
    requiredClaimProfile: 'jvm-observation-bound-v2' as const,
    audience: 'runner-persistence-fixture',
    verifierInstanceId: 'runner-persistence-instance',
    sequence: 1,
    nonceBase64Url: Buffer.alloc(32, 8).toString('base64url'),
    runId: request.runId,
    keyId: '7'.repeat(64),
    bindingId: request.bindingId,
    targetBindingSha256: request.targetBindingSha256,
    provider: request.provider,
    trustStoreId: 'runner-persistence-trust',
    trustStoreVersion: 'v1',
    trustStoreSha256: '8'.repeat(64),
    issuedAtMs: 5_000,
    expiresAtMs: 10_000
  }
  const claims = {
    ...challengeWithoutId,
    challengeId: createHash('sha256')
      .update(canonicalSignedProviderChallengeIdentityV1(challengeWithoutId)).digest('hex'),
    observedAtMs: 5_100,
    claimedServerInstanceId: 'claimed-persistence-server',
    claimedBootId: 'claimed-persistence-boot',
    loadedArtifacts: request.loadedArtifacts
  }
  return {
    schemaVersion: 2,
    profile: 'jvm-observation-bound-v2',
    claims,
    jvmArtifactObservation: {
      schemaVersion: 1,
      grade: 'codesource-file-and-class-resource-observed',
      authoritative: false,
      provesLoadedBytecode: false,
      releaseEligible: false,
      assumptions: [
        'standard-non-instrumented-anchor-classloader',
        'java-agent-absence-verified:false'
      ],
      declared: { role: 'candidate', logicalId: 'candidate', logicalPath: 'plugins/Plugin.jar' },
      observedClassBinaryName: 'com.example.Plugin',
      codeSourceUriFingerprint: '5'.repeat(64),
      codeSourceFileSha256: '1'.repeat(64),
      codeSourceFileBytes: 65_536,
      classResourceSha256: '6'.repeat(64),
      classResourceBytes: 4_096,
      classResourceOrigin: 'anchor-class-getResourceAsStream;loader-mediated;parent-delegation-possible;runtime-version-selection-unknown;may-differ-from-defined-bytecode;origin-not-proven',
      classResourceInformational: true,
      sameLoaderMediated: true,
      mayDifferFromDefinedBytecode: true,
      internalEntryConsistency: 'MATCH',
      atomicSnapshot: false
    },
    signatureBase64Url: Buffer.alloc(64).toString('base64url')
  }
}

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

test('TestRun tạo, tham chiếu và seal signed-provider evidence để verifier độc lập kiểm lại', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-report-signed-provider-'))
  const bot = new ReportBot()
  const pair = generateKeyPairSync('ed25519')
  const publicDer = pair.publicKey.export({ type: 'spki', format: 'der' })
  const keyId = createHash('sha256').update(publicDer).digest('hex')
  const targetBindingSha256 = artifactTargetBindingSha256(signedProviderTargetBinding)
  const provider = signedProviderTargetBinding.provider as {
    kind: 'server-probe'; id: string; version: string; instanceId?: string
  }
  const trustStore = buildSignedProviderClaimTrustStore({
    schemaVersion: 1,
    trustStoreId: 'runner-provider-trust',
    trustStoreVersion: 'v1',
    keys: [{
      schemaVersion: 1,
      algorithm: 'ed25519',
      keyId,
      publicKeySpkiDerBase64: publicDer.toString('base64'),
      provider,
      allowedBindings: [{ bindingId: signedProviderTargetBinding.bindingId, targetBindingSha256 }],
      notBeforeMs: 1_000,
      notAfterMs: 20_000,
      status: 'active'
    }]
  })
  const scenario = scenarioSchema.parse({
    name: 'signed provider persistence', maxDurationMs: 1_000,
    steps: [{ id: 'done', action: 'wait', durationMs: 0 }]
  })
  let factoryCalls = 0
  let factoryReads = 0
  let run!: TestRun
  const signedProviderEvidenceFactory: SignedProviderEvidenceFactory = request => {
      factoryCalls++
      assert.equal(request.runId, run.id)
      assert.equal(request.scenarioName, scenario.name)
      assert.equal(request.targetBindingSha256, targetBindingSha256)
      assert.equal(Object.isFrozen(request), true)
      assert.equal(Object.isFrozen(request.loadedArtifacts), true)
      const challengeWithoutId = {
        schemaVersion: 1 as const,
        domain: 'botcheckerminecraft.signed-provider-claim.v1' as const,
        requiredClaimProfile: 'jvm-observation-bound-v2' as const,
        audience: 'runner-provider-verifier',
        verifierInstanceId: 'runner-provider-instance',
        sequence: 1,
        nonceBase64Url: Buffer.alloc(32, 9).toString('base64url'),
        runId: request.runId,
        keyId,
        bindingId: signedProviderTargetBinding.bindingId,
        targetBindingSha256,
        provider,
        trustStoreId: trustStore.trustStoreId,
        trustStoreVersion: trustStore.trustStoreVersion,
        trustStoreSha256: trustStore.trustStoreSha256,
        issuedAtMs: 5_000,
        expiresAtMs: 10_000
      }
      const claims = {
        ...challengeWithoutId,
        challengeId: createHash('sha256')
          .update(canonicalSignedProviderChallengeIdentityV1(challengeWithoutId)).digest('hex'),
        observedAtMs: 5_100,
        claimedServerInstanceId: 'claimed-runner-server',
        claimedBootId: 'claimed-runner-boot',
        loadedArtifacts: request.loadedArtifacts
      }
      const jvmArtifactObservation = {
        schemaVersion: 1 as const,
        grade: 'codesource-file-and-class-resource-observed' as const,
        authoritative: false as const,
        provesLoadedBytecode: false as const,
        releaseEligible: false as const,
        assumptions: [
          'standard-non-instrumented-anchor-classloader' as const,
          'java-agent-absence-verified:false' as const
        ],
        declared: { role: 'candidate' as const, logicalId: 'candidate', logicalPath: 'plugins/Plugin.jar' },
        observedClassBinaryName: 'com.example.Plugin',
        codeSourceUriFingerprint: '5'.repeat(64),
        codeSourceFileSha256: '1'.repeat(64),
        codeSourceFileBytes: 65_536,
        classResourceSha256: '6'.repeat(64),
        classResourceBytes: 4_096,
        classResourceOrigin: 'anchor-class-getResourceAsStream;loader-mediated;parent-delegation-possible;runtime-version-selection-unknown;may-differ-from-defined-bytecode;origin-not-proven' as const,
        classResourceInformational: true as const,
        sameLoaderMediated: true as const,
        mayDifferFromDefinedBytecode: true as const,
        internalEntryConsistency: 'MATCH' as const,
        atomicSnapshot: false as const
      }
      return {
        schemaVersion: 2 as const,
        profile: 'jvm-observation-bound-v2' as const,
        claims,
        jvmArtifactObservation,
        signatureBase64Url: sign(null, canonicalSignedProviderObservationBoundClaimV2({
          claims,
          jvmArtifactObservation
        }), pair.privateKey).toString('base64url')
      }
  }
  run = new TestRun(scenario, minecraft, reportDir, {
    createBot: () => bot as never,
    prepareNavigation: () => {},
    connectTimeoutMs: 100,
    disconnectTimeoutMs: 100,
    targetBinding: signedProviderTargetBinding,
    get signedProviderEvidenceFactory() {
      factoryReads++
      return signedProviderEvidenceFactory
    }
  })
  try {
    await startRun(run, bot)
    assert.equal(factoryCalls, 1)
    assert.equal(factoryReads, 1)
    const providerFileName = `${run.id}-signed-provider-envelope.json`
    assert.deepEqual(new Set(await readdir(reportDir)), new Set([
      `${run.id}.json`, `${run.id}.bundle.json`, providerFileName
    ]))
    const report = JSON.parse(await readFile(path.join(reportDir, `${run.id}.json`), 'utf8'))
    const providerBytes = await readFile(path.join(reportDir, providerFileName))
    assert.deepEqual(report.manifest.signedProviderEvidence, {
      schemaVersion: 1,
      kind: 'signed-provider-observation-bound-envelope',
      artifactFileName: providerFileName,
      artifactSha256: createHash('sha256').update(providerBytes).digest('hex'),
      verificationScope: 'SIGNATURE_ONLY_NON_RELEASE',
      signatureVerified: false,
      freshnessEstablished: false,
      replayChecked: false,
      nonceConsumed: false,
      releaseEligible: false
    })
    const result = await verifySignedProviderObservationBoundBundle({
      directory: reportDir,
      sealFileName: `${run.id}.bundle.json`,
      expectedRunId: run.id,
      expectedBinding: signedProviderTargetBinding,
      trustStore,
      verificationTimeMs: 6_000
    })
    assert.equal(result.providerSignatureValid, true)
    assert.equal(result.runtimeWired, false)
    assert.equal(result.releaseEligible, false)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('TestRun không cho provider callback sửa target binding nội bộ qua report', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-provider-binding-toctou-'))
  const bot = new ReportBot()
  let run: TestRun
  let mutationRejected = false
  const factory: SignedProviderEvidenceFactory = request => {
    const evidence = run.report().manifest.evidence
    assert.equal(evidence.evidenceGrade, 'artifact-bound')
    if (evidence.evidenceGrade === 'artifact-bound') {
      try {
        evidence.targetBinding.artifacts[0]!.sha256 = '9'.repeat(64)
      } catch {
        mutationRejected = true
      }
    }
    return structurallyValidProviderEnvelope(request)
  }
  run = new TestRun(
    scenarioSchema.parse({
      name: 'signed provider binding TOCTOU', maxDurationMs: 1_000,
      steps: [{ id: 'done', action: 'wait', durationMs: 0 }]
    }),
    minecraft,
    reportDir,
    {
      createBot: () => bot as never,
      prepareNavigation: () => {},
      connectTimeoutMs: 100,
      disconnectTimeoutMs: 100,
      targetBinding: signedProviderTargetBinding,
      signedProviderEvidenceFactory: factory
    }
  )
  try {
    await startRun(run, bot)
    assert.equal(mutationRejected, true)
    const report = JSON.parse(await readFile(path.join(reportDir, `${run.id}.json`), 'utf8'))
    assert.deepEqual(report.manifest.evidence.targetBinding, signedProviderTargetBinding)
    assert.equal(
      report.manifest.evidence.targetBindingSha256,
      artifactTargetBindingSha256(signedProviderTargetBinding)
    )
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

test('TestRun không giữ provider reference nếu bundle persistence thất bại trước artifact', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-provider-persist-collision-'))
  const bot = new ReportBot()
  const scenario = scenarioSchema.parse({
    name: 'signed provider collision', maxDurationMs: 1_000,
    steps: [{ id: 'done', action: 'wait', durationMs: 0 }]
  })
  const run = new TestRun(scenario, minecraft, reportDir, {
    createBot: () => bot as never,
    prepareNavigation: () => {},
    connectTimeoutMs: 100,
    disconnectTimeoutMs: 100,
    targetBinding: signedProviderTargetBinding,
    signedProviderEvidenceFactory: structurallyValidProviderEnvelope
  })
  const reportPath = path.join(reportDir, `${run.id}.json`)
  try {
    await writeFile(reportPath, 'pre-existing', { encoding: 'utf8', flag: 'wx' })
    await assert.rejects(startRun(run, bot), /already exists/i)
    assert.equal(run.report().manifest.signedProviderEvidence, undefined)
    assert.deepEqual(await readdir(reportDir), [`${run.id}.json`])
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('TestRun ghi provider trước report để collision race không để report tham chiếu artifact thiếu', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-provider-write-race-'))
  const bot = new ReportBot()
  const run = new TestRun(
    scenarioSchema.parse({
      name: 'signed provider write race', maxDurationMs: 1_000,
      steps: [{ id: 'done', action: 'wait', durationMs: 0 }]
    }),
    minecraft,
    reportDir,
    {
      createBot: () => bot as never,
      prepareNavigation: () => {},
      connectTimeoutMs: 100,
      disconnectTimeoutMs: 100,
      targetBinding: signedProviderTargetBinding,
      signedProviderEvidenceFactory: structurallyValidProviderEnvelope
    }
  )
  run.events.push({
    at: new Date().toISOString(),
    elapsedMs: 0,
    type: 'race-padding',
    summary: 'Bounded write-race fixture',
    data: { padding: 'x'.repeat(8 * 1024 * 1024) }
  })
  const reportPath = path.join(reportDir, `${run.id}.json`)
  const providerPath = path.join(reportDir, `${run.id}-signed-provider-envelope.json`)
  const raceProviderCreation = async (): Promise<boolean> => {
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      try {
        await access(reportPath)
        try {
          await writeFile(providerPath, 'racing-collision', { flag: 'wx' })
          return true
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
          throw error
        }
      } catch {
        await new Promise(resolve => setTimeout(resolve, 1))
      }
    }
    throw new Error('Timed out waiting for report write-race boundary')
  }
  try {
    const [startResult, raceResult] = await Promise.allSettled([
      startRun(run, bot),
      raceProviderCreation()
    ])
    assert.equal(startResult.status, 'fulfilled')
    assert.deepEqual(raceResult, { status: 'fulfilled', value: false })
    await verifyEvidenceBundle(reportDir, `${run.id}.bundle.json`)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})

test('TestRun không gọi signed-provider factory cho run bị hủy khi còn queued', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-provider-queued-cancel-'))
  const run = new TestRun(
    scenarioSchema.parse({
      name: 'queued signed provider cancellation', maxDurationMs: 1_000,
      steps: [{ id: 'done', action: 'wait', durationMs: 0 }]
    }),
    minecraft,
    reportDir,
    {
      targetBinding: signedProviderTargetBinding,
      signedProviderEvidenceFactory: () => {
        throw new Error('queued cancellation must not call provider')
      }
    }
  )
  try {
    run.cancel()
    await run.persistCancelled()
    assert.equal(run.report().manifest.signedProviderEvidence, undefined)
    const seal = await verifyEvidenceBundle(reportDir, `${run.id}.bundle.json`)
    assert.deepEqual(seal.artifacts.map(artifact => artifact.role), ['report'])
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
