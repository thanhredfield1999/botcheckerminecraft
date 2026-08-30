import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { writeEvidenceBundle } from '../src/evidence-bundle.js'
import {
  verifySignedProviderObservationBoundBundle
} from '../src/signed-provider-evidence-bundle.js'
import {
  buildSignedProviderClaimTrustStore,
  canonicalSignedProviderObservationBoundClaimV2
} from '../src/signed-provider-claim.js'
import {
  canonicalSignedProviderChallengeIdentityV1
} from '../src/signed-provider-claim-schema.js'
import {
  artifactTargetBindingSha256,
  buildArtifactTargetBinding,
  evidenceBinding
} from '../src/target-binding.js'

const RUN_ID = 'provider-bundle-run'
const VERIFICATION_TIME_MS = 6_000
const SCENARIO_SHA256 = '9'.repeat(64)
const CAPABILITY_SOURCE_FINGERPRINT = '8'.repeat(64)

function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

function spkiDer(publicKey: KeyObject): Buffer {
  return publicKey.export({ type: 'spki', format: 'der' })
}

function fixture() {
  const targetBinding = buildArtifactTargetBinding({
    schemaVersion: 1,
    bindingId: 'provider-bundle-binding',
    provider: { kind: 'server-probe', id: 'provider-bundle-probe', version: '1.0.0', instanceId: 'slot-a' },
    authorization: { id: 'approval-provider-bundle', scope: ['artifact-bind'] },
    artifacts: [
      { logicalId: 'candidate', role: 'candidate', logicalPath: 'plugins/Example.jar', sha256: '1'.repeat(64) },
      { logicalId: 'config', role: 'config', logicalPath: 'plugins/Example/config.yml', sha256: '2'.repeat(64) },
      { logicalId: 'paper', role: 'paper', logicalPath: 'server/paper.jar', sha256: '3'.repeat(64) },
      { logicalId: 'probe', role: 'probe', logicalPath: 'plugins/Probe.jar', sha256: '4'.repeat(64) }
    ]
  })
  const targetBindingSha256 = artifactTargetBindingSha256(targetBinding)
  const pair = generateKeyPairSync('ed25519')
  const der = spkiDer(pair.publicKey)
  const keyId = sha256(der)
  const provider = {
    kind: 'server-probe' as const,
    id: 'provider-bundle-probe',
    version: '1.0.0',
    instanceId: 'slot-a'
  }
  const trustStore = buildSignedProviderClaimTrustStore({
    schemaVersion: 1,
    trustStoreId: 'provider-bundle-trust',
    trustStoreVersion: 'v1',
    keys: [{
      schemaVersion: 1,
      algorithm: 'ed25519',
      keyId,
      publicKeySpkiDerBase64: der.toString('base64'),
      provider,
      allowedBindings: [{ bindingId: targetBinding.bindingId, targetBindingSha256 }],
      notBeforeMs: 1_000,
      notAfterMs: 20_000,
      status: 'active'
    }]
  })
  const challengeWithoutId = {
    schemaVersion: 1 as const,
    domain: 'botcheckerminecraft.signed-provider-claim.v1' as const,
    requiredClaimProfile: 'jvm-observation-bound-v2' as const,
    audience: 'provider-bundle-verifier',
    verifierInstanceId: 'provider-bundle-instance',
    sequence: 1,
    nonceBase64Url: Buffer.alloc(32, 7).toString('base64url'),
    runId: RUN_ID,
    keyId,
    bindingId: targetBinding.bindingId,
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
    challengeId: sha256(canonicalSignedProviderChallengeIdentityV1(challengeWithoutId)),
    observedAtMs: 5_100,
    claimedServerInstanceId: 'claimed-server-instance',
    claimedBootId: 'claimed-boot',
    loadedArtifacts: [...targetBinding.artifacts]
  }
  const jvmArtifactObservation = {
    schemaVersion: 1 as const,
    grade: 'codesource-file-and-class-resource-observed' as const,
    authoritative: false as const,
    provesLoadedBytecode: false as const,
    releaseEligible: false as const,
    assumptions: ['standard-non-instrumented-anchor-classloader' as const, 'java-agent-absence-verified:false' as const],
    declared: { role: 'candidate' as const, logicalId: 'candidate', logicalPath: 'plugins/Example.jar' },
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
  const signatureBase64Url = sign(null, canonicalSignedProviderObservationBoundClaimV2({
    claims,
    jvmArtifactObservation
  }), pair.privateKey).toString('base64url')
  return {
    pair,
    targetBinding,
    targetBindingSha256,
    trustStore,
    envelope: { schemaVersion: 2 as const, profile: 'jvm-observation-bound-v2' as const, claims, jvmArtifactObservation, signatureBase64Url }
  }
}

async function writeFixtureBundle(
  directory: string,
  value: ReturnType<typeof fixture>,
  envelope: unknown = value.envelope,
  options: {
    readonly reportScenarioName?: string
    readonly manifestScenarioName?: string
    readonly reportScenarioSha256?: string
    readonly sealScenarioSha256?: string
    readonly reportCapabilitySourceFingerprint?: string
    readonly sealCapabilitySourceFingerprint?: string
  } = {}
): Promise<string> {
  const providerFileName = `${RUN_ID}-signed-provider-envelope.json`
  const providerContent = JSON.stringify(envelope)
  const providerEvidenceSha256 = sha256(providerContent)
  const report = {
    runId: RUN_ID,
    scenario: options.reportScenarioName ?? 'provider-bundle-scenario',
    verdict: 'PASS',
    manifest: {
      schemaVersion: 1,
      scenario: {
        name: options.manifestScenarioName ?? 'provider-bundle-scenario',
        sha256: options.reportScenarioSha256 ?? SCENARIO_SHA256
      },
      capability: {
        sourceFingerprint: options.reportCapabilitySourceFingerprint
          ?? CAPABILITY_SOURCE_FINGERPRINT
      },
      evidence: evidenceBinding(value.targetBinding),
      signedProviderEvidence: {
        schemaVersion: 1,
        kind: 'signed-provider-observation-bound-envelope',
        artifactFileName: providerFileName,
        artifactSha256: providerEvidenceSha256,
        verificationScope: 'SIGNATURE_ONLY_NON_RELEASE',
        freshnessEstablished: false,
        replayChecked: false,
        nonceConsumed: false,
        releaseEligible: false
      }
    }
  }
  await writeEvidenceBundle(directory, `${RUN_ID}.bundle.json`, {
    runId: RUN_ID,
    scenarioSha256: options.sealScenarioSha256 ?? SCENARIO_SHA256,
    capabilitySourceFingerprint: options.sealCapabilitySourceFingerprint
      ?? CAPABILITY_SOURCE_FINGERPRINT,
    targetBindingSha256: value.targetBindingSha256,
    artifacts: [
      { role: 'report', fileName: `${RUN_ID}.json`, content: JSON.stringify(report) },
      { role: 'provider-evidence', fileName: providerFileName, content: providerContent }
    ]
  })
  return providerEvidenceSha256
}

test('P0.4 sealed bundle tự verify signed provider envelope nhưng không overclaim runtime', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-provider-bundle-'))
  const value = fixture()
  try {
    const providerEvidenceSha256 = await writeFixtureBundle(directory, value)

    const result = await verifySignedProviderObservationBoundBundle({
      directory,
      sealFileName: `${RUN_ID}.bundle.json`,
      expectedRunId: RUN_ID,
      expectedBinding: value.targetBinding,
      trustStore: value.trustStore,
      verificationTimeMs: VERIFICATION_TIME_MS
    })

    assert.equal(result.bundleIntegrityVerified, true)
    assert.equal(result.bundleAuthenticityVerified, false)
    assert.equal(result.reportAuthenticityVerified, false)
    assert.equal(result.providerSignatureValid, true)
    assert.equal(result.providerEvidenceReferenceMatched, true)
    assert.equal(result.candidateObservationMatchedNonAuthoritatively, true)
    assert.equal(result.freshnessEstablished, false)
    assert.equal(result.replayChecked, false)
    assert.equal(result.nonceConsumed, false)
    assert.equal(result.challengeIssuanceVerified, false)
    assert.equal(result.verificationTimeTrusted, false)
    assert.equal(result.trustStoreSourceAuthenticityVerified, false)
    assert.equal(result.trustStoreRollbackProtectionVerified, false)
    assert.equal(result.providerKeyCustodyVerified, false)
    assert.equal(result.provesLoadedBytecode, false)
    assert.equal(result.runtimeWired, false)
    assert.equal(result.productionReady, false)
    assert.equal(result.releaseEligible, false)
    assert.equal(result.reportedFunctionalVerdict, 'PASS')
    assert.equal(result.functionalVerdictAuthenticated, false)
    assert.equal('integrity' in result, false)
    assert.equal('signatureValid' in result, false)
    assert.equal('functionalVerdict' in result, false)
    assert.equal(result.providerEvidenceSha256, providerEvidenceSha256)
    assert.equal(result.targetBindingSha256, value.targetBindingSha256)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('P0.4 snapshot verification time trước filesystem await', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-provider-bundle-time-'))
  const value = fixture()
  let verificationTimeMs = VERIFICATION_TIME_MS
  try {
    await writeFixtureBundle(directory, value)
    const verifying = verifySignedProviderObservationBoundBundle({
      directory,
      sealFileName: `${RUN_ID}.bundle.json`,
      expectedRunId: RUN_ID,
      expectedBinding: value.targetBinding,
      trustStore: value.trustStore,
      get verificationTimeMs() { return verificationTimeMs }
    })
    verificationTimeMs = 25_000
    assert.equal((await verifying).providerSignatureValid, true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('P0.4 reject caller-materialized verification field', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-provider-bundle-forged-'))
  const value = fixture()
  try {
    await writeFixtureBundle(directory, value)
    await assert.rejects(
      () => verifySignedProviderObservationBoundBundle({
        directory,
        sealFileName: `${RUN_ID}.bundle.json`,
        expectedRunId: RUN_ID,
        expectedBinding: value.targetBinding,
        trustStore: value.trustStore,
        verificationTimeMs: VERIFICATION_TIME_MS,
        verificationResult: { signatureValid: true, nonceConsumed: true }
      } as unknown as Parameters<typeof verifySignedProviderObservationBoundBundle>[0]),
      /bundle verification failed/i
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('P0.4 reject signed envelope có challengeId không khớp canonical challenge', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-provider-bundle-challenge-'))
  const value = fixture()
  try {
    const claims = { ...value.envelope.claims, challengeId: '0'.repeat(64) }
    const envelope = {
      ...value.envelope,
      claims,
      signatureBase64Url: sign(null, canonicalSignedProviderObservationBoundClaimV2({
        claims,
        jvmArtifactObservation: value.envelope.jvmArtifactObservation
      }), value.pair.privateKey).toString('base64url')
    }
    await writeFixtureBundle(directory, value, envelope)
    await assert.rejects(() => verifySignedProviderObservationBoundBundle({
      directory,
      sealFileName: `${RUN_ID}.bundle.json`,
      expectedRunId: RUN_ID,
      expectedBinding: value.targetBinding,
      trustStore: value.trustStore,
      verificationTimeMs: VERIFICATION_TIME_MS
    }), /bundle verification failed/i)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('P0.4 reject seal/report scenario hash mismatch', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-provider-bundle-scenario-'))
  const value = fixture()
  try {
    await writeFixtureBundle(directory, value, value.envelope, {
      reportScenarioSha256: '7'.repeat(64)
    })
    await assert.rejects(() => verifySignedProviderObservationBoundBundle({
      directory,
      sealFileName: `${RUN_ID}.bundle.json`,
      expectedRunId: RUN_ID,
      expectedBinding: value.targetBinding,
      trustStore: value.trustStore,
      verificationTimeMs: VERIFICATION_TIME_MS
    }), /bundle verification failed/i)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('P0.4 reject seal/report capability fingerprint mismatch', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-provider-bundle-capability-'))
  const value = fixture()
  try {
    await writeFixtureBundle(directory, value, value.envelope, {
      reportCapabilitySourceFingerprint: '6'.repeat(64)
    })
    await assert.rejects(() => verifySignedProviderObservationBoundBundle({
      directory,
      sealFileName: `${RUN_ID}.bundle.json`,
      expectedRunId: RUN_ID,
      expectedBinding: value.targetBinding,
      trustStore: value.trustStore,
      verificationTimeMs: VERIFICATION_TIME_MS
    }), /bundle verification failed/i)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('P0.4 reject top-level report scenario khác manifest scenario', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-provider-bundle-scenario-name-'))
  const value = fixture()
  try {
    await writeFixtureBundle(directory, value, value.envelope, {
      reportScenarioName: 'other-scenario'
    })
    await assert.rejects(() => verifySignedProviderObservationBoundBundle({
      directory,
      sealFileName: `${RUN_ID}.bundle.json`,
      expectedRunId: RUN_ID,
      expectedBinding: value.targetBinding,
      trustStore: value.trustStore,
      verificationTimeMs: VERIFICATION_TIME_MS
    }), /bundle verification failed/i)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('P0.4 reject signed observation ngoài signed challenge window', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-provider-bundle-window-'))
  const value = fixture()
  try {
    const claims = { ...value.envelope.claims, observedAtMs: 10_001 }
    const envelope = {
      ...value.envelope,
      claims,
      signatureBase64Url: sign(null, canonicalSignedProviderObservationBoundClaimV2({
        claims,
        jvmArtifactObservation: value.envelope.jvmArtifactObservation
      }), value.pair.privateKey).toString('base64url')
    }
    await writeFixtureBundle(directory, value, envelope)
    await assert.rejects(() => verifySignedProviderObservationBoundBundle({
      directory,
      sealFileName: `${RUN_ID}.bundle.json`,
      expectedRunId: RUN_ID,
      expectedBinding: value.targetBinding,
      trustStore: value.trustStore,
      verificationTimeMs: VERIFICATION_TIME_MS
    }), /bundle verification failed/i)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
