import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildSignedProviderClaimTrustStore,
  canonicalSignedProviderClaimV1,
  canonicalSignedProviderObservationBoundClaimV2,
  verifyCanonicalSignedProviderClaimSignature,
  type SignedProviderClaimTrustKeyInput
} from '../src/signed-provider-claim.js'
import { parseSignedProviderCanonicalContent } from '../src/signed-provider-claim-schema.js'

function spkiDer(publicKey: KeyObject): Buffer {
  return publicKey.export({ type: 'spki', format: 'der' })
}

function trustKey(publicKey: KeyObject): SignedProviderClaimTrustKeyInput {
  const der = spkiDer(publicKey)
  return {
    schemaVersion: 1,
    algorithm: 'ed25519',
    keyId: createHash('sha256').update(der).digest('hex'),
    publicKeySpkiDerBase64: der.toString('base64'),
    provider: {
      kind: 'server-probe',
      id: 'canonical-probe',
      version: '1.0.0',
      instanceId: 'slot-a'
    },
    allowedBindings: [{
      bindingId: 'canonical-binding',
      targetBindingSha256: 'a'.repeat(64)
    }],
    notBeforeMs: 1_000,
    notAfterMs: 20_000,
    status: 'active'
  }
}

const claims = {
  schemaVersion: 1 as const,
  domain: 'botcheckerminecraft.signed-provider-claim.v1' as const,
  requiredClaimProfile: 'jvm-observation-bound-v2' as const,
  audience: 'canonical-audience',
  verifierInstanceId: 'canonical-verifier',
  sequence: 1,
  challengeId: 'b'.repeat(64),
  nonceBase64Url: Buffer.alloc(32, 7).toString('base64url'),
  runId: 'canonical-run',
  keyId: '',
  bindingId: 'canonical-binding',
  targetBindingSha256: 'a'.repeat(64),
  provider: {
    kind: 'server-probe' as const,
    id: 'canonical-probe',
    version: '1.0.0',
    instanceId: 'slot-a'
  },
  trustStoreId: 'canonical-trust',
  trustStoreVersion: 'v1',
  trustStoreSha256: '',
  issuedAtMs: 5_000,
  expiresAtMs: 10_000,
  observedAtMs: 5_100,
  claimedServerInstanceId: 'claimed-server',
  claimedBootId: 'claimed-boot',
  loadedArtifacts: [
    { logicalId: 'candidate', role: 'candidate' as const, logicalPath: 'plugins/Example.jar', sha256: '1'.repeat(64) },
    { logicalId: 'config', role: 'config' as const, logicalPath: 'plugins/Example/config.yml', sha256: '2'.repeat(64) },
    { logicalId: 'paper', role: 'paper' as const, logicalPath: 'server/paper.jar', sha256: '3'.repeat(64) },
    { logicalId: 'probe', role: 'probe' as const, logicalPath: 'plugins/Probe.jar', sha256: '4'.repeat(64) }
  ]
}

const observation = {
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
    logicalPath: 'plugins/Example.jar'
  },
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

function canonicalFixture() {
  const pair = generateKeyPairSync('ed25519')
  const key = trustKey(pair.publicKey)
  const store = buildSignedProviderClaimTrustStore({
    schemaVersion: 1,
    trustStoreId: 'canonical-trust',
    trustStoreVersion: 'v1',
    keys: [key]
  })
  const signedContent = {
    schemaVersion: 2 as const,
    profile: 'jvm-observation-bound-v2' as const,
    claims: {
      ...claims,
      keyId: key.keyId,
      trustStoreSha256: store.trustStoreSha256
    },
    jvmArtifactObservation: observation
  }
  const canonicalPayload = canonicalSignedProviderObservationBoundClaimV2({
    claims: signedContent.claims,
    jvmArtifactObservation: signedContent.jvmArtifactObservation
  })
  const signature = sign(null, canonicalPayload, pair.privateKey)
  const input = {
    trustStore: store,
    verificationTimeMs: 6_000,
    signedContent,
    signature
  }
  return { pair, key, store, signedContent, canonicalPayload, signature, input }
}

test('canonical signature primitive verify exact pinned Ed25519 và chỉ trả metadata', () => {
  const fixture = canonicalFixture()
  const result = verifyCanonicalSignedProviderClaimSignature(fixture.input)

  assert.deepEqual(result, {
    signatureValid: true,
    freshnessEstablished: false,
    replayChecked: false,
    nonceConsumed: false,
    keyId: fixture.key.keyId,
    trustStoreId: fixture.store.trustStoreId,
    trustStoreVersion: fixture.store.trustStoreVersion,
    trustStoreSha256: fixture.store.trustStoreSha256,
    provider: fixture.key.provider,
    bindingId: 'canonical-binding',
    targetBindingSha256: 'a'.repeat(64)
  })
  assert.equal(Object.isFrozen(result), true)
  assert.equal(Object.isFrozen(result.provider), true)
  assert.equal('signature' in result, false)
  assert.equal('signedContent' in result, false)
  assert.equal('publicKey' in result, false)
  assert.equal('spki' in result, false)
})

test('canonical signature primitive verify v1 và reject cross-version profile confusion', () => {
  const fixture = canonicalFixture()
  const { requiredClaimProfile: _profile, ...legacyClaims } = fixture.signedContent.claims
  const canonicalPayload = canonicalSignedProviderClaimV1(legacyClaims)
  const signature = sign(null, canonicalPayload, fixture.pair.privateKey)
  const result = verifyCanonicalSignedProviderClaimSignature({
    trustStore: fixture.store,
    verificationTimeMs: 6_000,
    signedContent: { schemaVersion: 1, claims: legacyClaims },
    signature
  })
  assert.equal(result.signatureValid, true)
  assert.equal(result.freshnessEstablished, false)
  assert.equal(result.replayChecked, false)
  assert.equal(result.nonceConsumed, false)

  assert.throws(() => verifyCanonicalSignedProviderClaimSignature({
    trustStore: fixture.store,
    verificationTimeMs: 6_000,
    signedContent: { schemaVersion: 1, claims: fixture.signedContent.claims },
    signature
  }))
  assert.throws(() => verifyCanonicalSignedProviderClaimSignature({
    trustStore: fixture.store,
    verificationTimeMs: 6_000,
    signedContent: { ...fixture.signedContent, claims: legacyClaims },
    signature
  } as unknown as Parameters<typeof verifyCanonicalSignedProviderClaimSignature>[0]))
})

test('canonical signed content parser deep-freeze nested policy và artifacts', () => {
  const fixture = canonicalFixture()
  const parsed = parseSignedProviderCanonicalContent(fixture.signedContent)
  const canonicalBeforeMutation = canonicalSignedProviderObservationBoundClaimV2({
    claims: parsed.claims,
    jvmArtifactObservation: parsed.schemaVersion === 2
      ? parsed.jvmArtifactObservation
      : observation
  })
  assert.equal(Object.isFrozen(parsed), true)
  assert.equal(Object.isFrozen(parsed.claims), true)
  assert.equal(Object.isFrozen(parsed.claims.provider), true)
  assert.equal(Object.isFrozen(parsed.claims.loadedArtifacts), true)
  assert.equal(parsed.claims.loadedArtifacts.every(Object.isFrozen), true)
  if (parsed.schemaVersion === 2) {
    assert.equal(Object.isFrozen(parsed.jvmArtifactObservation), true)
    assert.equal(Object.isFrozen(parsed.jvmArtifactObservation.assumptions), true)
    assert.equal(Object.isFrozen(parsed.jvmArtifactObservation.declared), true)
  }
  fixture.signedContent.claims.loadedArtifacts[0]!.sha256 = '0'.repeat(64)
  assert.equal(canonicalSignedProviderObservationBoundClaimV2({
    claims: parsed.claims,
    jvmArtifactObservation: parsed.schemaVersion === 2
      ? parsed.jvmArtifactObservation
      : observation
  }).equals(canonicalBeforeMutation), true)
})

test('canonical signature primitive fail closed với key/provider/binding/time/trust/signature mismatch', () => {
  const fixture = canonicalFixture()
  const otherPair = generateKeyPairSync('ed25519')
  const otherKey = trustKey(otherPair.publicKey)
  const claimMutations: ReadonlyArray<Readonly<Record<string, unknown>>> = [
    { keyId: otherKey.keyId },
    { provider: { ...fixture.key.provider, id: 'other-probe' } },
    { bindingId: 'other-binding' },
    { targetBindingSha256: 'f'.repeat(64) },
    { trustStoreId: 'other-trust' },
    { trustStoreVersion: 'v2' },
    { trustStoreSha256: 'f'.repeat(64) }
  ]
  for (const mutation of claimMutations) {
    assert.throws(() => verifyCanonicalSignedProviderClaimSignature({
      ...fixture.input,
      signedContent: {
        ...fixture.signedContent,
        claims: { ...fixture.signedContent.claims, ...mutation }
      }
    } as unknown as Parameters<typeof verifyCanonicalSignedProviderClaimSignature>[0]))
  }
  for (const mutation of [
    { verificationTimeMs: 999 },
    { verificationTimeMs: 20_001 },
    { signature: Buffer.alloc(64) },
    { trustStore: { ...fixture.store } }
  ]) {
    assert.throws(() => verifyCanonicalSignedProviderClaimSignature({
      ...fixture.input,
      ...mutation
    } as unknown as Parameters<typeof verifyCanonicalSignedProviderClaimSignature>[0]))
  }
})

test('canonical signature primitive không nhận arbitrary bytes hoặc metadata policy rời', () => {
  const fixture = canonicalFixture()
  const arbitraryPayload = Buffer.from('not-a-canonical-signed-provider-claim', 'utf8')
  const arbitrarySignature = sign(null, arbitraryPayload, fixture.pair.privateKey)
  for (const signedContent of [
    arbitraryPayload,
    'not-a-canonical-signed-provider-claim',
    null,
    { ...fixture.signedContent, untrustedBindingId: 'other-binding' }
  ]) {
    assert.throws(() => verifyCanonicalSignedProviderClaimSignature({
      trustStore: fixture.store,
      verificationTimeMs: 6_000,
      signedContent,
      signature: arbitrarySignature
    } as unknown as Parameters<typeof verifyCanonicalSignedProviderClaimSignature>[0]))
  }
})

test('canonical signature primitive reject observation mutation sau khi ký', () => {
  const fixture = canonicalFixture()
  assert.throws(() => verifyCanonicalSignedProviderClaimSignature({
    ...fixture.input,
    signedContent: {
      ...fixture.signedContent,
      jvmArtifactObservation: {
        ...fixture.signedContent.jvmArtifactObservation,
        codeSourceUriFingerprint: 'f'.repeat(64)
      }
    }
  }))
})

test('canonical signature primitive reject signature bounds và unsafe verification time', () => {
  const fixture = canonicalFixture()
  const signatures: unknown[] = [
    new Uint8Array(63),
    new Uint8Array(65),
    'not-bytes',
    null
  ]
  for (const signature of signatures) {
    assert.throws(() => verifyCanonicalSignedProviderClaimSignature({
      ...fixture.input,
      signature
    } as unknown as Parameters<typeof verifyCanonicalSignedProviderClaimSignature>[0]))
  }
  for (const verificationTimeMs of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => verifyCanonicalSignedProviderClaimSignature({
      ...fixture.input,
      verificationTimeMs
    }))
  }
})

test('canonical signature primitive không giữ alias signed content/signature hoặc trả raw evidence', () => {
  const fixture = canonicalFixture()
  const signature = new Uint8Array(fixture.signature)
  const mutableArtifacts = fixture.signedContent.claims.loadedArtifacts.map(artifact => ({ ...artifact }))
  const mutableContent = {
    ...fixture.signedContent,
    claims: { ...fixture.signedContent.claims, loadedArtifacts: mutableArtifacts }
  }
  const result = verifyCanonicalSignedProviderClaimSignature({
    ...fixture.input,
    signedContent: mutableContent,
    signature
  })
  mutableArtifacts[0]!.sha256 = '0'.repeat(64)
  signature.fill(0)
  assert.equal(result.signatureValid, true)
  assert.equal(Object.isFrozen(mutableContent), false)
  assert.equal('signedContent' in result, false)
  assert.equal('signature' in result, false)
  assert.equal(JSON.stringify(result).includes(fixture.signature.toString('base64url')), false)
})

test('canonical signature primitive snapshot mỗi input field đúng một lần trước crypto', () => {
  const fixture = canonicalFixture()
  const reads = new Map<string, number>()
  const source = fixture.input as unknown as Record<string, unknown>
  const input = Object.create(null) as Record<string, unknown>
  for (const key of Object.keys(source)) {
    Object.defineProperty(input, key, {
      enumerable: true,
      get() {
        reads.set(key, (reads.get(key) ?? 0) + 1)
        return source[key]
      }
    })
  }
  assert.equal(verifyCanonicalSignedProviderClaimSignature(
    input as unknown as Parameters<typeof verifyCanonicalSignedProviderClaimSignature>[0]
  ).signatureValid, true)
  assert.deepEqual(Object.fromEntries(reads), Object.fromEntries(
    Object.keys(source).map(key => [key, 1])
  ))
})

test('verifier dùng duy nhất canonical signature primitive cho Ed25519 crypto', () => {
  const source = readFileSync('src/signed-provider-claim.ts', 'utf8')
  assert.equal(source.match(/cryptoVerify\(/g)?.length, 1)
  assert.match(source, /verifyAndConsume[\s\S]*verifyCanonicalSignedProviderClaimSignature\(/)
})
