import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import test from 'node:test'
import {
  buildSignedProviderClaimTrustStore,
  SignedProviderClaimVerifier
} from '../src/signed-provider-claim.js'
import { SignedProviderOpaqueSigningAdapter } from '../src/signed-provider-signing-adapter.js'
import { artifactTargetBindingSha256, buildArtifactTargetBinding } from '../src/target-binding.js'

function binding() {
  return buildArtifactTargetBinding({
    schemaVersion: 1,
    bindingId: 'opaque-adapter-binding',
    provider: { kind: 'filesystem-snapshot', id: 'fixture-resolver', version: '1.0.0' },
    authorization: { id: 'approval-opaque-adapter', scope: ['artifact-bind'] },
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
      kind: 'server-probe' as const,
      id: 'opaque-adapter-probe',
      version: '1.0.0',
      instanceId: 'opaque-slot-a'
    },
    allowedBindings: [{ bindingId: 'opaque-adapter-binding', targetBindingSha256 }],
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
    declared: {
      role: 'candidate' as const,
      logicalId: 'candidate',
      logicalPath: 'plugins/LivingNPC.jar'
    },
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
  const targetBindingSha256 = artifactTargetBindingSha256(expectedBinding)
  const pair = generateKeyPairSync('ed25519')
  const key = trustKey(pair.publicKey, targetBindingSha256)
  const trustStore = buildSignedProviderClaimTrustStore({
    schemaVersion: 1,
    trustStoreId: 'opaque-adapter-trust',
    trustStoreVersion: '2026.08.28-1',
    keys: [key]
  })
  const clock = { wall: 10_000, mono: 500 }
  const verifier = new SignedProviderClaimVerifier({
    trustStore,
    audience: 'opaque-adapter-verifier',
    verifierInstanceId: 'opaque-adapter-instance',
    wallNowMs: () => clock.wall,
    monotonicNowMs: () => clock.mono,
    randomBytes: size => Buffer.alloc(size, 41)
  })
  const challenge = verifier.issueChallenge({
    runId: 'opaque-adapter-run',
    expectedBinding,
    keyId: key.keyId,
    ttlMs: 5_000,
    requiredClaimProfile: 'jvm-observation-bound-v2'
  })
  clock.wall = 10_100
  clock.mono = 600
  const claims = {
    ...challenge,
    observedAtMs: 10_050,
    claimedServerInstanceId: 'claimed-paper-opaque-adapter',
    claimedBootId: 'claimed-boot-opaque-adapter',
    loadedArtifacts: [...expectedBinding.artifacts]
  }
  return { pair, key, trustStore, clock, verifier, claims, jvmArtifactObservation: candidateObservation() }
}

function adapterFor(
  value: ReturnType<typeof fixture>,
  signer: ConstructorParameters<typeof SignedProviderOpaqueSigningAdapter>[0]['signer'],
  overrides: Partial<ConstructorParameters<typeof SignedProviderOpaqueSigningAdapter>[0]> = {}
) {
  return new SignedProviderOpaqueSigningAdapter({
    trustStore: value.trustStore,
    descriptor: {
      keyId: value.key.keyId,
      provider: value.key.provider,
      opaqueKeyHandleId: 'opaque-handle-helper'
    },
    signer,
    timeoutMs: 1_000,
    wallNowMs: () => value.clock.wall,
    ...overrides
  })
}

test('opaque signing adapter ký sync callback rồi verifier riêng consume envelope v2', async () => {
  const value = fixture()
  let callbackCalls = 0
  const adapter = new SignedProviderOpaqueSigningAdapter({
    trustStore: value.trustStore,
    descriptor: {
      keyId: value.key.keyId,
      provider: value.key.provider,
      opaqueKeyHandleId: 'opaque-handle-slot-a'
    },
    signer: request => {
      callbackCalls += 1
      assert.equal(request.opaqueKeyHandleId, 'opaque-handle-slot-a')
      assert.equal(request.signal.aborted, false)
      assert.equal(Object.isFrozen(request), true)
      return sign(null, request.canonicalPayload, value.pair.privateKey)
    },
    timeoutMs: 1_000,
    wallNowMs: () => value.clock.wall
  })

  const envelope = await adapter.createObservationBoundEnvelope({
    claims: value.claims,
    jvmArtifactObservation: value.jvmArtifactObservation
  })

  assert.equal(callbackCalls, 1)
  assert.equal(Object.isFrozen(envelope), true)
  assert.equal(Object.isFrozen(envelope.claims), true)
  assert.equal(Object.isFrozen(envelope.jvmArtifactObservation), true)
  assert.equal(envelope.schemaVersion, 2)
  assert.equal(envelope.profile, 'jvm-observation-bound-v2')
  const result = value.verifier.verifyAndConsume(envelope)
  assert.equal(result.signatureValid, true)
  assert.equal(result.nonceConsumed, true)
  assert.equal(result.releaseEligible, false)
})

test('opaque signing adapter chấp nhận async callback với cùng canonical envelope', async () => {
  const value = fixture()
  const adapter = new SignedProviderOpaqueSigningAdapter({
    trustStore: value.trustStore,
    descriptor: {
      keyId: value.key.keyId,
      provider: value.key.provider,
      opaqueKeyHandleId: 'opaque-handle-slot-async'
    },
    signer: async request => sign(null, request.canonicalPayload, value.pair.privateKey),
    timeoutMs: 1_000,
    wallNowMs: () => value.clock.wall
  })

  const envelope = await adapter.createObservationBoundEnvelope({
    claims: value.claims,
    jvmArtifactObservation: value.jvmArtifactObservation
  })

  assert.equal(value.verifier.verifyAndConsume(envelope).nonceConsumed, true)
})

test('opaque signing adapter snapshot input trước callback mutation', async () => {
  const value = fixture()
  const descriptor = {
    keyId: value.key.keyId,
    provider: { ...value.key.provider },
    opaqueKeyHandleId: 'opaque-handle-snapshot'
  }
  const input = {
    claims: {
      ...value.claims,
      provider: { ...value.claims.provider },
      loadedArtifacts: value.claims.loadedArtifacts.map(artifact => ({ ...artifact }))
    },
    jvmArtifactObservation: {
      ...value.jvmArtifactObservation,
      declared: { ...value.jvmArtifactObservation.declared }
    }
  }
  const adapter = new SignedProviderOpaqueSigningAdapter({
    trustStore: value.trustStore,
    descriptor,
    signer: request => {
      const signature = sign(null, Buffer.from(request.canonicalPayload), value.pair.privateKey)
      request.canonicalPayload.fill(0)
      descriptor.opaqueKeyHandleId = 'mutated-handle'
      input.claims.loadedArtifacts[0]!.sha256 = '0'.repeat(64)
      input.jvmArtifactObservation.codeSourceFileSha256 = '0'.repeat(64)
      return signature
    },
    timeoutMs: 1_000,
    wallNowMs: () => value.clock.wall
  })

  const envelope = await adapter.createObservationBoundEnvelope(input)

  assert.equal(envelope.claims.loadedArtifacts[0]!.sha256, '1'.repeat(64))
  assert.equal(envelope.jvmArtifactObservation.codeSourceFileSha256, '1'.repeat(64))
  assert.equal(value.verifier.verifyAndConsume(envelope).nonceConsumed, true)
})

test('opaque signing adapter reject policy mismatch trước callback', async () => {
  const value = fixture()
  let calls = 0
  const signer = () => {
    calls += 1
    return new Uint8Array(64)
  }
  const wrongProvider = adapterFor(value, signer, {
    descriptor: {
      keyId: value.key.keyId,
      provider: { ...value.key.provider, id: 'other-probe' },
      opaqueKeyHandleId: 'opaque-policy-provider'
    }
  })
  await assert.rejects(() => wrongProvider.createObservationBoundEnvelope({
    claims: value.claims,
    jvmArtifactObservation: value.jvmArtifactObservation
  }), /descriptor|provider/i)

  const wrongBinding = adapterFor(value, signer)
  await assert.rejects(() => wrongBinding.createObservationBoundEnvelope({
    claims: { ...value.claims, bindingId: 'other-binding' },
    jvmArtifactObservation: value.jvmArtifactObservation
  }), /binding/i)

  const inactiveKey = adapterFor(value, signer, { wallNowMs: () => 100_000 })
  await assert.rejects(() => inactiveKey.createObservationBoundEnvelope({
    claims: value.claims,
    jvmArtifactObservation: value.jvmArtifactObservation
  }), /window|active/i)
  assert.equal(calls, 0)
})

test('opaque signing adapter reject descriptor không strict hoặc handle nhạy cảm', () => {
  const value = fixture()
  const invalidDescriptors: unknown[] = [
    {
      keyId: value.key.keyId,
      provider: { ...value.key.provider, unexpected: 'field' },
      opaqueKeyHandleId: 'opaque-strict-field'
    },
    {
      keyId: value.key.keyId,
      provider: value.key.provider,
      opaqueKeyHandleId: 'secret/key'
    },
    {
      keyId: value.key.keyId,
      provider: value.key.provider,
      opaqueKeyHandleId: 'x'.repeat(129)
    }
  ]
  for (const descriptor of invalidDescriptors) {
    assert.throws(() => adapterFor(value, () => new Uint8Array(64), {
      descriptor: descriptor as ConstructorParameters<typeof SignedProviderOpaqueSigningAdapter>[0]['descriptor']
    }), /descriptor|provider|handle/i)
  }
})

test('opaque signing adapter snapshot hostile descriptor getter đúng một lần', async () => {
  const value = fixture()
  let handleReads = 0
  const providerReads = { kind: 0, id: 0, version: 0, instanceId: 0 }
  let observedHandle = ''
  const descriptor = {
    keyId: value.key.keyId,
    provider: {
      get kind() { providerReads.kind += 1; return value.key.provider.kind },
      get id() { providerReads.id += 1; return value.key.provider.id },
      get version() { providerReads.version += 1; return value.key.provider.version },
      get instanceId() { providerReads.instanceId += 1; return value.key.provider.instanceId }
    },
    get opaqueKeyHandleId() {
      handleReads += 1
      return handleReads === 1 ? 'opaque-hostile-safe' : 'secret/hostile-path'
    }
  }
  const adapter = adapterFor(value, request => {
    observedHandle = request.opaqueKeyHandleId
    return sign(null, request.canonicalPayload, value.pair.privateKey)
  }, { descriptor })

  await adapter.createObservationBoundEnvelope({
    claims: value.claims,
    jvmArtifactObservation: value.jvmArtifactObservation
  })
  assert.equal(handleReads, 1)
  assert.deepEqual(providerReads, { kind: 1, id: 1, version: 1, instanceId: 1 })
  assert.equal(observedHandle, 'opaque-hostile-safe')
})

test('opaque signing adapter reject forged trust-store snapshot trước callback', () => {
  const value = fixture()
  let calls = 0
  assert.throws(() => adapterFor(value, () => {
    calls += 1
    return new Uint8Array(64)
  }, {
    trustStore: { ...value.trustStore }
  }), /trust store|snapshot/i)
  assert.equal(calls, 0)
})

test('opaque signing adapter recheck key window sau callback', async () => {
  const value = fixture()
  let clockReads = 0
  const adapter = adapterFor(value, request =>
    sign(null, request.canonicalPayload, value.pair.privateKey), {
    wallNowMs: () => ++clockReads === 1 ? value.clock.wall : 100_000
  })

  await assert.rejects(() => adapter.createObservationBoundEnvelope({
    claims: value.claims,
    jvmArtifactObservation: value.jvmArtifactObservation
  }), /window|active/i)
  assert.equal(clockReads, 2)
})

test('opaque signing adapter reject chữ ký đúng độ dài từ sai key', async () => {
  const value = fixture()
  const wrongPair = generateKeyPairSync('ed25519')
  const adapter = adapterFor(value, request =>
    sign(null, request.canonicalPayload, wrongPair.privateKey))

  await assert.rejects(() => adapter.createObservationBoundEnvelope({
    claims: value.claims,
    jvmArtifactObservation: value.jvmArtifactObservation
  }), /signature/i)
})

test('opaque signing adapter không làm rò handle hoặc payload qua callback error', async () => {
  const value = fixture()
  const handle = 'opaque-handle-no-leak'
  let leakedPayload = ''
  const adapter = adapterFor(value, request => {
    leakedPayload = Buffer.from(request.canonicalPayload).toString('base64url')
    throw new Error(`signer failed ${handle} ${leakedPayload}`)
  }, {
    descriptor: {
      keyId: value.key.keyId,
      provider: value.key.provider,
      opaqueKeyHandleId: handle
    }
  })

  await assert.rejects(
    () => adapter.createObservationBoundEnvelope({
      claims: value.claims,
      jvmArtifactObservation: value.jvmArtifactObservation
    }),
    error => {
      const rendered = String(error)
      assert.doesNotMatch(rendered, new RegExp(handle))
      assert.equal(rendered.includes(leakedPayload), false)
      assert.match(rendered, /callback failed/i)
      return true
    }
  )
})

test('opaque signing adapter normalize typed-array proxy error', async () => {
  const value = fixture()
  const proxy = new Proxy(new Uint8Array(64), {})
  const adapter = adapterFor(value, () => proxy)

  await assert.rejects(
    () => adapter.createObservationBoundEnvelope({
      claims: value.claims,
      jvmArtifactObservation: value.jvmArtifactObservation
    }),
    error => {
      assert.equal(String(error), 'Error: Opaque signer returned an invalid signature')
      return true
    }
  )
})

test('opaque signing adapter reject return type và length không đúng 64 byte', async () => {
  const value = fixture()
  const invalid: unknown[] = [
    new Uint8Array(63), new Uint8Array(65), new Uint8Array(1024 * 1024),
    'signature', null, { length: 64 }
  ]
  for (const returned of invalid) {
    const adapter = adapterFor(value, () => returned as Uint8Array)
    await assert.rejects(() => adapter.createObservationBoundEnvelope({
      claims: value.claims,
      jvmArtifactObservation: value.jvmArtifactObservation
    }), /signature/i)
  }
})

test('opaque signing adapter timeout abort, bỏ late result và dùng lại được', async () => {
  const value = fixture()
  let calls = 0
  let resolveLate: ((signature: Uint8Array) => void) | undefined
  let firstSignal: AbortSignal | undefined
  const adapter = adapterFor(value, request => {
    calls += 1
    if (calls === 1) {
      firstSignal = request.signal
      return new Promise<Uint8Array>(resolve => { resolveLate = resolve })
    }
    return sign(null, request.canonicalPayload, value.pair.privateKey)
  }, { timeoutMs: 20 })
  const input = {
    claims: value.claims,
    jvmArtifactObservation: value.jvmArtifactObservation
  }

  await assert.rejects(() => adapter.createObservationBoundEnvelope(input), /timed out/i)
  assert.equal(firstSignal?.aborted, true)
  await assert.rejects(
    () => adapter.createObservationBoundEnvelope(input),
    /REENTRANT/
  )
  assert.equal(calls, 1)
  resolveLate?.(new Uint8Array(64))
  await new Promise(resolve => setTimeout(resolve, 5))

  const envelope = await adapter.createObservationBoundEnvelope(input)
  assert.equal(calls, 2)
  assert.equal(value.verifier.verifyAndConsume(envelope).nonceConsumed, true)
})

test('opaque signing adapter reject reentrancy nhưng outer call vẫn hoàn tất', async () => {
  const value = fixture()
  const input = {
    claims: value.claims,
    jvmArtifactObservation: value.jvmArtifactObservation
  }
  let calls = 0
  let adapter: SignedProviderOpaqueSigningAdapter
  adapter = adapterFor(value, async request => {
    calls += 1
    if (calls === 1) {
      await assert.rejects(
        () => adapter.createObservationBoundEnvelope(input),
        /REENTRANT/
      )
    }
    return sign(null, request.canonicalPayload, value.pair.privateKey)
  })

  const envelope = await adapter.createObservationBoundEnvelope(input)
  assert.equal(calls, 1)
  assert.equal(value.verifier.verifyAndConsume(envelope).nonceConsumed, true)
})
