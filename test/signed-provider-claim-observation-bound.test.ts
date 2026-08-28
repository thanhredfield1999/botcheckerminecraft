import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import test from 'node:test'
import {
  buildSignedProviderClaimTrustStore,
  canonicalSignedProviderClaimV1,
  canonicalSignedProviderObservationBoundClaimV2,
  SignedProviderClaimVerifier
} from '../src/signed-provider-claim.js'
import { artifactTargetBindingSha256, buildArtifactTargetBinding } from '../src/target-binding.js'

function binding() {
  return buildArtifactTargetBinding({
    schemaVersion: 1,
    bindingId: 'observation-bound-fixture',
    provider: { kind: 'filesystem-snapshot', id: 'fixture-resolver', version: '1.0.0' },
    authorization: { id: 'approval-observation-bound', scope: ['artifact-bind'] },
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
      id: 'observation-bound-probe',
      version: '1.0.0',
      instanceId: 'observation-bound-key-slot'
    },
    allowedBindings: [{ bindingId: 'observation-bound-fixture', targetBindingSha256 }],
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
      'standard-non-instrumented-anchor-classloader' as const,
      'java-agent-absence-verified:false' as const
    ],
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

test('signed provider observation-bound v2 bind exact candidate observation nhưng vẫn non-release', () => {
  const expectedBinding = binding()
  const targetBindingSha256 = artifactTargetBindingSha256(expectedBinding)
  const pair = generateKeyPairSync('ed25519')
  const key = trustKey(pair.publicKey, targetBindingSha256)
  const trustStore = buildSignedProviderClaimTrustStore({
    schemaVersion: 1,
    trustStoreId: 'observation-bound-trust',
    trustStoreVersion: '2026.08.28-1',
    keys: [key]
  })
  const clock = { wall: 10_000, mono: 500 }
  const verifier = new SignedProviderClaimVerifier({
    trustStore,
    audience: 'observation-bound-verifier',
    verifierInstanceId: 'observation-bound-instance',
    wallNowMs: () => clock.wall,
    monotonicNowMs: () => clock.mono,
    randomBytes: size => Buffer.alloc(size, 31)
  })
  const challenge = verifier.issueChallenge({
    runId: 'observation-bound-run', expectedBinding, keyId: key.keyId, ttlMs: 5_000,
    requiredClaimProfile: 'jvm-observation-bound-v2'
  })
  clock.wall = 10_100
  clock.mono = 600
  const claims = {
    ...challenge,
    observedAtMs: 10_050,
    claimedServerInstanceId: 'claimed-paper-observation-bound',
    claimedBootId: 'claimed-boot-observation-bound',
    loadedArtifacts: [...expectedBinding.artifacts]
  }
  const jvmArtifactObservation = candidateObservation()
  const signatureBase64Url = sign(null, canonicalSignedProviderObservationBoundClaimV2({
    claims,
    jvmArtifactObservation
  }), pair.privateKey).toString('base64url')

  const result = verifier.verifyAndConsume({
    schemaVersion: 2,
    profile: 'jvm-observation-bound-v2',
    claims,
    jvmArtifactObservation,
    signatureBase64Url
  })

  assert.equal(result.signatureValid, true)
  assert.equal(result.nonceConsumed, true)
  assert.equal(result.evidenceGrade, 'artifact-bound')
  assert.equal(result.releaseEligible, false)
  assert.deepEqual(result.observationBinding, {
    status: 'TARGET_FILE_MATCH_NON_AUTHORITATIVE',
    authoritative: false,
    provesLoadedBytecode: false,
    releaseEligible: false,
    role: 'candidate',
    logicalId: 'candidate',
    logicalPath: 'plugins/LivingNPC.jar',
    observationSha256: result.observationBinding?.observationSha256,
    codeSourceUriFingerprint: '5'.repeat(64),
    codeSourceFileSha256: '1'.repeat(64),
    internalEntryConsistency: 'MATCH',
    observedAtMs: 10_050,
    observationTimeAttested: 'self-asserted-by-signer',
    observationFreshness: 'not-established',
    limitations: [
      'declared-identity-is-caller-supplied',
      'codesource-file-is-not-loaded-bytecode-proof',
      'class-resource-is-loader-mediated-informational-evidence',
      'snapshot-is-best-effort-non-atomic'
    ]
  })
})

test('signed provider observation-bound v2 reject observation chỉ khớp probe thay vì candidate', () => {
  const expectedBinding = binding()
  const targetBindingSha256 = artifactTargetBindingSha256(expectedBinding)
  const pair = generateKeyPairSync('ed25519')
  const key = trustKey(pair.publicKey, targetBindingSha256)
  const trustStore = buildSignedProviderClaimTrustStore({
    schemaVersion: 1,
    trustStoreId: 'observation-bound-trust',
    trustStoreVersion: '2026.08.28-1',
    keys: [key]
  })
  const clock = { wall: 10_000, mono: 500 }
  const verifier = new SignedProviderClaimVerifier({
    trustStore,
    audience: 'observation-bound-verifier',
    verifierInstanceId: 'observation-bound-probe-reject',
    wallNowMs: () => clock.wall,
    monotonicNowMs: () => clock.mono,
    randomBytes: size => Buffer.alloc(size, 32),
    maxInvalidAttempts: 1
  })
  const challenge = verifier.issueChallenge({
    runId: 'observation-bound-probe-reject-run', expectedBinding, keyId: key.keyId, ttlMs: 5_000,
    requiredClaimProfile: 'jvm-observation-bound-v2'
  })
  clock.wall = 10_100
  clock.mono = 600
  const claims = {
    ...challenge,
    observedAtMs: 10_050,
    claimedServerInstanceId: 'claimed-paper-observation-bound',
    claimedBootId: 'claimed-boot-observation-bound',
    loadedArtifacts: [...expectedBinding.artifacts]
  }
  const probeObservation = {
    ...candidateObservation(),
    declared: {
      role: 'probe' as const,
      logicalId: 'probe',
      logicalPath: 'plugins/BotCheckerProbe.jar'
    },
    codeSourceFileSha256: '4'.repeat(64)
  }
  const envelope = (jvmArtifactObservation: ReturnType<typeof candidateObservation> | typeof probeObservation) => ({
    schemaVersion: 2 as const,
    profile: 'jvm-observation-bound-v2' as const,
    claims,
    jvmArtifactObservation,
    signatureBase64Url: sign(null, canonicalSignedProviderObservationBoundClaimV2({
      claims,
      jvmArtifactObservation
    }), pair.privateKey).toString('base64url')
  })

  assert.throws(() => verifier.verifyAndConsume({
    schemaVersion: 1,
    claims,
    signatureBase64Url: sign(null, canonicalSignedProviderClaimV1(claims), pair.privateKey)
      .toString('base64url')
  }), /profile|observation|challenge/i)

  assert.throws(
    () => verifier.verifyAndConsume(envelope(probeObservation)),
    /candidate|observation|target/i
  )
  assert.throws(() => verifier.verifyAndConsume({
    ...envelope(probeObservation),
    signatureBase64Url: Buffer.alloc(64).toString('base64url')
  }), /signature/i)
  assert.throws(
    () => verifier.verifyAndConsume(envelope(candidateObservation())),
    /challenge|consumed|unavailable/i
  )
})

test('signed provider canonical profiles không có legacy alias hoặc v2 payload thiếu pin', () => {
  const expectedBinding = binding()
  const pair = generateKeyPairSync('ed25519')
  const key = trustKey(pair.publicKey, artifactTargetBindingSha256(expectedBinding))
  const verifier = new SignedProviderClaimVerifier({
    trustStore: buildSignedProviderClaimTrustStore({
      schemaVersion: 1,
      trustStoreId: 'observation-bound-trust',
      trustStoreVersion: '2026.08.28-1',
      keys: [key]
    }),
    audience: 'observation-bound-verifier',
    verifierInstanceId: 'observation-bound-canonical-profile',
    wallNowMs: () => 10_000,
    monotonicNowMs: () => 500,
    randomBytes: size => Buffer.alloc(size, 33)
  })
  const challenge = verifier.issueChallenge({
    runId: 'observation-bound-canonical-profile-run',
    expectedBinding,
    keyId: key.keyId,
    ttlMs: 5_000
  })
  const legacyClaims = {
    ...challenge,
    observedAtMs: 10_000,
    claimedServerInstanceId: 'claimed-paper-observation-bound',
    claimedBootId: 'claimed-boot-observation-bound',
    loadedArtifacts: [...expectedBinding.artifacts]
  }

  assert.throws(
    () => canonicalSignedProviderClaimV1({ ...legacyClaims, requiredClaimProfile: 'legacy-v1' }),
    /profile|literal|invalid/i
  )
  const observationBoundChallenge = verifier.issueChallenge({
    runId: 'observation-bound-v1-footgun-run',
    expectedBinding,
    keyId: key.keyId,
    ttlMs: 5_000,
    requiredClaimProfile: 'jvm-observation-bound-v2'
  })
  assert.throws(
    () => canonicalSignedProviderClaimV1({
      ...observationBoundChallenge,
      observedAtMs: 10_000,
      claimedServerInstanceId: 'claimed-paper-observation-bound',
      claimedBootId: 'claimed-boot-observation-bound',
      loadedArtifacts: [...expectedBinding.artifacts]
    }),
    /profile|observation-bound|version/i
  )
  assert.throws(
    () => canonicalSignedProviderObservationBoundClaimV2({
      claims: legacyClaims,
      jvmArtifactObservation: candidateObservation()
    }),
    /profile|observation-bound/i
  )
})
