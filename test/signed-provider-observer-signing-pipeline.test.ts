import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import test from 'node:test'
import {
  buildSignedProviderClaimTrustStore,
  SignedProviderClaimVerifier
} from '../src/signed-provider-claim.js'
import {
  SignedProviderObserverSigningPipeline,
  type SignedProviderObservationProvider
} from '../src/signed-provider-observer-signing-pipeline.js'
import { SignedProviderOpaqueSigningAdapter } from '../src/signed-provider-signing-adapter.js'
import { artifactTargetBindingSha256, buildArtifactTargetBinding } from '../src/target-binding.js'

function binding() {
  return buildArtifactTargetBinding({
    schemaVersion: 1,
    bindingId: 'paper-observer-signing-pipeline',
    provider: {
      kind: 'server-probe', id: 'paper-observer-probe', version: '1.0.0', instanceId: 'fixture-a'
    },
    authorization: { id: 'approval-paper-observer-pipeline', scope: ['artifact-bind'] },
    artifacts: [
      { logicalId: 'candidate', role: 'candidate', logicalPath: 'plugins/LivingNPC.jar', sha256: '1'.repeat(64) },
      { logicalId: 'config', role: 'config', logicalPath: 'plugins/LivingNPC/config.yml', sha256: '2'.repeat(64) },
      { logicalId: 'paper', role: 'paper', logicalPath: 'server/paper.jar', sha256: '3'.repeat(64) },
      { logicalId: 'probe', role: 'probe', logicalPath: 'plugins/BotCheckerProbe.jar', sha256: '4'.repeat(64) }
    ]
  })
}

function trustKey(publicKey: KeyObject, targetBindingSha256: string) {
  const der = publicKey.export({ type: 'spki', format: 'der' })
  return {
    schemaVersion: 1 as const,
    algorithm: 'ed25519' as const,
    keyId: createHash('sha256').update(der).digest('hex'),
    publicKeySpkiDerBase64: der.toString('base64'),
    provider: {
      kind: 'server-probe' as const, id: 'paper-observer-probe', version: '1.0.0', instanceId: 'fixture-a'
    },
    allowedBindings: [{ bindingId: 'paper-observer-signing-pipeline', targetBindingSha256 }],
    notBeforeMs: 1_000,
    notAfterMs: 100_000,
    status: 'active' as const
  }
}

function candidateObservation() {
  return {
    schemaVersion: 1 as const,
    grade: 'codesource-file-and-class-resource-observed' as const,
    authoritative: false as const,
    provesLoadedBytecode: false as const,
    releaseEligible: false as const,
    assumptions: [
      'standard-non-instrumented-anchor-classloader',
      'java-agent-absence-verified:false'
    ] as const,
    declared: { role: 'candidate' as const, logicalId: 'candidate', logicalPath: 'plugins/LivingNPC.jar' },
    observedClassBinaryName: 'vn.heomc.livingnpc.LivingNpcPlugin',
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
}

function fixture() {
  const expectedBinding = binding()
  const pair = generateKeyPairSync('ed25519')
  const key = trustKey(pair.publicKey, artifactTargetBindingSha256(expectedBinding))
  const trustStore = buildSignedProviderClaimTrustStore({
    schemaVersion: 1,
    trustStoreId: 'paper-observer-pipeline-trust',
    trustStoreVersion: '2026.08.30-1',
    keys: [key]
  })
  const clock = { wall: 10_000, mono: 500 }
  const verifier = new SignedProviderClaimVerifier({
    trustStore,
    audience: 'paper-observer-pipeline-verifier',
    verifierInstanceId: 'paper-observer-pipeline-instance',
    wallNowMs: () => clock.wall,
    monotonicNowMs: () => clock.mono,
    randomBytes: size => Buffer.alloc(size, 51)
  })
  const challenge = verifier.issueChallenge({
    runId: 'paper-observer-pipeline-run',
    expectedBinding,
    keyId: key.keyId,
    ttlMs: 5_000,
    requiredClaimProfile: 'jvm-observation-bound-v2'
  })
  const signerCalls = { value: 0 }
  const signingAdapter = new SignedProviderOpaqueSigningAdapter({
    trustStore,
    descriptor: {
      keyId: key.keyId,
      provider: key.provider,
      opaqueKeyHandleId: 'paper-observer-opaque-handle'
    },
    signer: request => {
      signerCalls.value += 1
      return sign(null, request.canonicalPayload, pair.privateKey)
    },
    timeoutMs: 1_000,
    wallNowMs: () => clock.wall
  })
  return { expectedBinding, clock, verifier, challenge, signingAdapter, signerCalls }
}

function pipelineFor(
  value: ReturnType<typeof fixture>,
  observer: SignedProviderObservationProvider,
  observerTimeoutMs = 1_000
) {
  return new SignedProviderObserverSigningPipeline({
    expectedBinding: value.expectedBinding,
    observer,
    signingAdapter: value.signingAdapter,
    observerTimeoutMs,
    wallNowMs: () => value.clock.wall
  })
}

test('observer-signing pipeline snapshot top-level option getters đúng một lần', async () => {
  const value = fixture()
  const reads = { expectedBinding: 0, observer: 0, signingAdapter: 0, observerTimeoutMs: 0, wallNowMs: 0 }
  const safeObserver: SignedProviderObservationProvider = () => ({
    observedAtMs: 10_000,
    claimedServerInstanceId: 'claimed-paper-instance-a',
    claimedBootId: 'claimed-paper-boot-a',
    jvmArtifactObservation: candidateObservation()
  })
  const options = {
    get expectedBinding() {
      reads.expectedBinding += 1
      return value.expectedBinding
    },
    get observer() {
      reads.observer += 1
      return reads.observer === 1 ? safeObserver : () => { throw new Error('hostile observer') }
    },
    get signingAdapter() {
      reads.signingAdapter += 1
      return value.signingAdapter
    },
    get observerTimeoutMs() {
      reads.observerTimeoutMs += 1
      return reads.observerTimeoutMs === 1 ? 1_000 : 0
    },
    get wallNowMs() {
      reads.wallNowMs += 1
      return reads.wallNowMs === 1 ? () => value.clock.wall : () => value.challenge.expiresAtMs
    }
  }
  const pipeline = new SignedProviderObserverSigningPipeline(options)

  const envelope = await pipeline.createObservationBoundEnvelope(value.challenge)
  assert.equal(value.verifier.verifyAndConsume(envelope).nonceConsumed, true)
  assert.deepEqual(reads, {
    expectedBinding: 1,
    observer: 1,
    signingAdapter: 1,
    observerTimeoutMs: 1,
    wallNowMs: 1
  })
})

test('observer-signing pipeline bind challenge, observation và opaque signer thành envelope consumable', async () => {
  const value = fixture()
  let observerCalls = 0
  const pipeline = pipelineFor(value, request => {
    observerCalls += 1
    assert.equal(Object.isFrozen(request), true)
    assert.equal(Object.isFrozen(request.challenge), true)
    assert.equal(Object.isFrozen(request.candidate), true)
    assert.deepEqual(request.candidate, {
      role: 'candidate', logicalId: 'candidate', logicalPath: 'plugins/LivingNPC.jar', expectedSha256: '1'.repeat(64)
    })
    assert.equal(request.signal.aborted, false)
    return {
      observedAtMs: 10_050,
      claimedServerInstanceId: 'claimed-paper-instance-a',
      claimedBootId: 'claimed-paper-boot-a',
      jvmArtifactObservation: candidateObservation()
    }
  })

  value.clock.wall = 10_100
  value.clock.mono = 600
  const envelope = await pipeline.createObservationBoundEnvelope(value.challenge)
  const verification = value.verifier.verifyAndConsume(envelope)

  assert.equal(observerCalls, 1)
  assert.equal(verification.signatureValid, true)
  assert.equal(verification.nonceConsumed, true)
  assert.equal(verification.observationBinding?.status, 'TARGET_FILE_MATCH_NON_AUTHORITATIVE')
  assert.equal(verification.observationBinding?.observationFreshness, 'not-established')
  assert.equal(verification.releaseEligible, false)
})

test('observer-signing pipeline reject target thiếu probe trước observer', () => {
  const value = fixture()
  let observerCalls = 0
  const withoutProbe = buildArtifactTargetBinding({
    schemaVersion: 1,
    bindingId: 'paper-observer-without-probe',
    provider: value.expectedBinding.provider,
    authorization: value.expectedBinding.authorization,
    artifacts: value.expectedBinding.artifacts.filter(artifact => artifact.role !== 'probe')
  })

  assert.throws(() => new SignedProviderObserverSigningPipeline({
    expectedBinding: withoutProbe,
    observer: () => {
      observerCalls += 1
      throw new Error('must not observe')
    },
    signingAdapter: value.signingAdapter,
    observerTimeoutMs: 1_000,
    wallNowMs: () => value.clock.wall
  }), /exactly one.*probe|probe artifact/i)
  assert.equal(observerCalls, 0)
  assert.equal(value.signerCalls.value, 0)
})

test('observer-signing pipeline không tự consume nonce; verifier riêng reject replay', async () => {
  const value = fixture()
  const pipeline = pipelineFor(value, () => ({
    observedAtMs: 10_000,
    claimedServerInstanceId: 'claimed-paper-instance-a',
    claimedBootId: 'claimed-paper-boot-a',
    jvmArtifactObservation: candidateObservation()
  }))

  const envelope = await pipeline.createObservationBoundEnvelope(value.challenge)
  const verification = value.verifier.verifyAndConsume(envelope)
  assert.equal(verification.nonceConsumed, true)
  assert.equal(verification.releaseEligible, false)
  assert.equal(verification.claimedServerInstanceId, 'claimed-paper-instance-a')
  assert.equal(verification.claimedBootId, 'claimed-paper-boot-a')
  await assert.rejects(
    async () => value.verifier.verifyAndConsume(envelope),
    /unavailable|consumed|replayed/i
  )
})

test('observer-signing pipeline reject observedAt ngoài challenge trước signer', async () => {
  const value = fixture()
  const pipeline = pipelineFor(value, () => ({
    observedAtMs: value.challenge.issuedAtMs - 1,
    claimedServerInstanceId: 'claimed-paper-instance-a',
    claimedBootId: 'claimed-paper-boot-a',
    jvmArtifactObservation: candidateObservation()
  }))
  await assert.rejects(() => pipeline.createObservationBoundEnvelope(value.challenge), /observation time|window/i)
  assert.equal(value.signerCalls.value, 0)
})

test('observer-signing pipeline reject candidate hash mismatch trước signer', async () => {
  const value = fixture()
  const pipeline = pipelineFor(value, () => ({
    observedAtMs: 10_050,
    claimedServerInstanceId: 'claimed-paper-instance-a',
    claimedBootId: 'claimed-paper-boot-a',
    jvmArtifactObservation: { ...candidateObservation(), codeSourceFileSha256: '9'.repeat(64) }
  }))
  await assert.rejects(() => pipeline.createObservationBoundEnvelope(value.challenge), /candidate|target binding|match/i)
  assert.equal(value.signerCalls.value, 0)
})

test('observer-signing pipeline reject challenge binding mismatch trước observer', async () => {
  const value = fixture()
  let observerCalls = 0
  const pipeline = pipelineFor(value, () => {
    observerCalls += 1
    throw new Error('must not observe')
  })
  await assert.rejects(() => pipeline.createObservationBoundEnvelope({
    ...value.challenge,
    targetBindingSha256: '9'.repeat(64)
  }), /observer challenge is invalid|challenge identity|target binding/i)
  assert.equal(observerCalls, 0)
  assert.equal(value.signerCalls.value, 0)
})

test('observer-signing pipeline sanitize hostile challenge getter trước observer', async () => {
  const value = fixture()
  let observerCalls = 0
  const sensitive = 'secret/challenge/path'
  const challenge = { ...value.challenge }
  Object.defineProperty(challenge, 'challengeId', {
    enumerable: true,
    get() { throw new Error(sensitive) }
  })
  const pipeline = pipelineFor(value, () => {
    observerCalls += 1
    throw new Error('must not observe')
  })

  await assert.rejects(
    () => pipeline.createObservationBoundEnvelope(challenge),
    error => {
      assert.equal(String(error), 'Error: Observer challenge is invalid')
      assert.equal(String(error).includes(sensitive), false)
      return true
    }
  )
  assert.equal(observerCalls, 0)
  assert.equal(value.signerCalls.value, 0)
})

test('observer-signing pipeline sanitize hostile result getter error trước caller', async () => {
  const value = fixture()
  const validResult = () => ({
    observedAtMs: 10_000,
    claimedServerInstanceId: 'claimed-paper-instance-a',
    claimedBootId: 'claimed-paper-boot-a',
    jvmArtifactObservation: candidateObservation()
  })
  const fields = [
    'observedAtMs',
    'claimedServerInstanceId',
    'claimedBootId',
    'jvmArtifactObservation'
  ] as const
  for (const field of fields) {
    const sensitive = `secret/observer-result/${field}`
    const result = validResult()
    Object.defineProperty(result, field, {
      enumerable: true,
      get() { throw new Error(sensitive) }
    })
    const pipeline = pipelineFor(value, () => result)
    await assert.rejects(
      () => pipeline.createObservationBoundEnvelope(value.challenge),
      error => {
        assert.equal(String(error), 'Error: Observation provider returned an invalid result')
        assert.equal(String(error).includes(sensitive), false)
        return true
      }
    )
  }
  assert.equal(value.signerCalls.value, 0)
})

test('observer-signing pipeline reject claimed identity không an toàn trước signer', async () => {
  const value = fixture()
  const sensitive = 'secret/claimed/server/path'
  const pipeline = pipelineFor(value, () => ({
    observedAtMs: 10_000,
    claimedServerInstanceId: sensitive,
    claimedBootId: 'claimed-paper-boot-a',
    jvmArtifactObservation: candidateObservation()
  }))

  await assert.rejects(
    () => pipeline.createObservationBoundEnvelope(value.challenge),
    error => {
      assert.equal(String(error), 'Error: Observation provider returned an invalid result')
      assert.equal(String(error).includes(sensitive), false)
      return true
    }
  )
  assert.equal(value.signerCalls.value, 0)
})

test('observer-signing pipeline sanitize observer error trước caller', async () => {
  const value = fixture()
  const sensitive = 'secret/production/key-path'
  const pipeline = pipelineFor(value, () => { throw new Error(`observer failed ${sensitive}`) })
  await assert.rejects(
    () => pipeline.createObservationBoundEnvelope(value.challenge),
    error => {
      assert.equal(String(error), 'Error: Observation provider failed')
      assert.equal(String(error).includes(sensitive), false)
      return true
    }
  )
  assert.equal(value.signerCalls.value, 0)
})

test('observer-signing pipeline reject observedAt ở tương lai trước signer', async () => {
  const value = fixture()
  const pipeline = pipelineFor(value, () => ({
    observedAtMs: value.clock.wall + 1,
    claimedServerInstanceId: 'claimed-paper-instance-a',
    claimedBootId: 'claimed-paper-boot-a',
    jvmArtifactObservation: candidateObservation()
  }))
  await assert.rejects(() => pipeline.createObservationBoundEnvelope(value.challenge), /observation time|future|window/i)
  assert.equal(value.signerCalls.value, 0)
})

test('observer-signing pipeline timeout giữ khóa tới khi callback cũ settle', async () => {
  const value = fixture()
  const candidateResult = () => ({
    observedAtMs: 10_050,
    claimedServerInstanceId: 'claimed-paper-instance-a',
    claimedBootId: 'claimed-paper-boot-a',
    jvmArtifactObservation: candidateObservation()
  })
  let calls = 0
  let firstSignal: AbortSignal | undefined
  let resolveFirst: ((result: ReturnType<typeof candidateResult>) => void) | undefined
  const pipeline = pipelineFor(value, request => {
    calls += 1
    if (calls === 1) {
      firstSignal = request.signal
      return new Promise(resolve => { resolveFirst = resolve })
    }
    return candidateResult()
  }, 20)

  await assert.rejects(() => pipeline.createObservationBoundEnvelope(value.challenge), /timed out/i)
  assert.equal(firstSignal?.aborted, true)
  await assert.rejects(() => pipeline.createObservationBoundEnvelope(value.challenge), /REENTRANT/)
  assert.equal(calls, 1)

  resolveFirst?.(candidateResult())
  await new Promise(resolve => setImmediate(resolve))
  value.clock.wall = 10_100
  value.clock.mono = 600
  const envelope = await pipeline.createObservationBoundEnvelope(value.challenge)
  assert.equal(calls, 2)
  assert.equal(value.verifier.verifyAndConsume(envelope).nonceConsumed, true)
})

test('observer-signing pipeline caller abort truyền vào observer và giữ khóa tới settle', async () => {
  const value = fixture()
  const controller = new AbortController()
  let observedSignal: AbortSignal | undefined
  let started: (() => void) | undefined
  let resolveObserver: ((result: {
    observedAtMs: number
    claimedServerInstanceId: string
    claimedBootId: string
    jvmArtifactObservation: ReturnType<typeof candidateObservation>
  }) => void) | undefined
  const observerStarted = new Promise<void>(resolve => { started = resolve })
  const pipeline = pipelineFor(value, request => {
    observedSignal = request.signal
    started?.()
    return new Promise(resolve => { resolveObserver = resolve })
  })

  const operation = pipeline.createObservationBoundEnvelope(value.challenge, {
    signal: controller.signal
  })
  await observerStarted
  controller.abort()
  await assert.rejects(operation, /cancelled/i)
  assert.equal(observedSignal?.aborted, true)
  await assert.rejects(() => pipeline.createObservationBoundEnvelope(value.challenge), /REENTRANT/)
  assert.equal(value.signerCalls.value, 0)

  resolveObserver?.({
    observedAtMs: 10_050,
    claimedServerInstanceId: 'claimed-paper-instance-a',
    claimedBootId: 'claimed-paper-boot-a',
    jvmArtifactObservation: candidateObservation()
  })
  await new Promise(resolve => setImmediate(resolve))
})

test('observer-signing pipeline truyền caller abort tới opaque signer', async () => {
  const value = fixture()
  const controller = new AbortController()
  let signerStarted: (() => void) | undefined
  let signerSignal: AbortSignal | undefined
  let resolveSigner: ((signature: Uint8Array) => void) | undefined
  let observerCalls = 0
  const started = new Promise<void>(resolve => { signerStarted = resolve })
  const pair = generateKeyPairSync('ed25519')
  const key = trustKey(pair.publicKey, artifactTargetBindingSha256(value.expectedBinding))
  const trustStore = buildSignedProviderClaimTrustStore({
    schemaVersion: 1,
    trustStoreId: 'paper-observer-cancel-trust',
    trustStoreVersion: '2026.08.30-1',
    keys: [key]
  })
  const signingAdapter = new SignedProviderOpaqueSigningAdapter({
    trustStore,
    descriptor: {
      keyId: key.keyId,
      provider: key.provider,
      opaqueKeyHandleId: 'paper-observer-cancel-handle'
    },
    signer: request => {
      signerSignal = request.signal
      signerStarted?.()
      return new Promise(resolve => { resolveSigner = resolve })
    },
    timeoutMs: 1_000,
    wallNowMs: () => value.clock.wall
  })
  const challengeVerifier = new SignedProviderClaimVerifier({
    trustStore,
    audience: 'paper-observer-cancel-verifier',
    verifierInstanceId: 'paper-observer-cancel-instance',
    wallNowMs: () => value.clock.wall,
    monotonicNowMs: () => value.clock.mono,
    randomBytes: size => Buffer.alloc(size, 52)
  })
  const challenge = challengeVerifier.issueChallenge({
    runId: 'paper-observer-cancel-run',
    expectedBinding: value.expectedBinding,
    keyId: key.keyId,
    ttlMs: 5_000,
    requiredClaimProfile: 'jvm-observation-bound-v2'
  })
  const pipeline = new SignedProviderObserverSigningPipeline({
    expectedBinding: value.expectedBinding,
    observer: () => {
      observerCalls += 1
      return {
        observedAtMs: 10_000,
        claimedServerInstanceId: 'claimed-paper-instance-a',
        claimedBootId: 'claimed-paper-boot-a',
        jvmArtifactObservation: candidateObservation()
      }
    },
    signingAdapter,
    observerTimeoutMs: 1_000,
    wallNowMs: () => value.clock.wall
  })

  const operation = pipeline.createObservationBoundEnvelope(challenge, { signal: controller.signal })
  await started
  controller.abort()
  await assert.rejects(operation, /cancelled/i)
  assert.equal(signerSignal?.aborted, true)
  await assert.rejects(() => pipeline.createObservationBoundEnvelope(challenge), /REENTRANT/)
  assert.equal(observerCalls, 1)
  resolveSigner?.(new Uint8Array(64))
  await new Promise(resolve => setImmediate(resolve))
})

test('observer-signing pipeline không bỏ lỡ abort xảy ra trong pre-observer clock', async () => {
  const value = fixture()
  const controller = new AbortController()
  let observerCalls = 0
  const pipeline = new SignedProviderObserverSigningPipeline({
    expectedBinding: value.expectedBinding,
    observer: () => {
      observerCalls += 1
      throw new Error('must not observe')
    },
    signingAdapter: value.signingAdapter,
    observerTimeoutMs: 1_000,
    wallNowMs: () => {
      controller.abort()
      return value.clock.wall
    }
  })

  await assert.rejects(
    () => pipeline.createObservationBoundEnvelope(value.challenge, {
      signal: controller.signal
    }),
    /cancelled/i
  )
  assert.equal(observerCalls, 0)
  assert.equal(value.signerCalls.value, 0)
})

test('observer-signing pipeline reject challenge hết hạn trước observer', async () => {
  const value = fixture()
  let observerCalls = 0
  const pipeline = pipelineFor(value, () => {
    observerCalls += 1
    throw new Error('must not observe')
  })
  value.clock.wall = value.challenge.expiresAtMs

  await assert.rejects(
    () => pipeline.createObservationBoundEnvelope(value.challenge),
    /challenge|active window|expired/i
  )
  assert.equal(observerCalls, 0)
  assert.equal(value.signerCalls.value, 0)
})
