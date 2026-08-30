import { createHash } from 'node:crypto'
import { z } from 'zod'
import { verifyEvidenceBundleSnapshot } from './evidence-bundle.js'
import {
  verifyCanonicalSignedProviderClaimSignature,
  type SignedProviderClaimTrustStore
} from './signed-provider-claim.js'
import {
  canonicalSignedProviderChallengeIdentityV1,
  parseSignedProviderClaimEnvelope
} from './signed-provider-claim-schema.js'
import { assessJvmArtifactObservationAgainstBinding } from './jvm-artifact-observation.js'
import {
  artifactTargetBindingSha256,
  exactArtifactTargetBindingMatch,
  validateArtifactTargetBinding,
  type ArtifactTargetBinding
} from './target-binding.js'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const SAFE_RUN_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/
const INPUT_KEYS = new Set([
  'directory', 'sealFileName', 'expectedRunId', 'expectedBinding',
  'trustStore', 'verificationTimeMs'
])

function hasExactKeys(input: object, expected: ReadonlySet<string>): boolean {
  const keys = Reflect.ownKeys(input)
  return keys.length === expected.size
    && keys.every(key => typeof key === 'string' && expected.has(key))
}

const reportReferenceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('signed-provider-observation-bound-envelope'),
  artifactFileName: z.string().min(1).max(200),
  artifactSha256: z.string().regex(SHA256_PATTERN),
  verificationScope: z.literal('SIGNATURE_ONLY_NON_RELEASE'),
  signatureVerified: z.literal(false).optional(),
  freshnessEstablished: z.literal(false),
  replayChecked: z.literal(false),
  nonceConsumed: z.literal(false),
  releaseEligible: z.literal(false)
})

const reportSchema = z.object({
  runId: z.string().regex(SAFE_RUN_ID),
  scenario: z.string().min(1).max(128),
  verdict: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']),
  manifest: z.object({
    schemaVersion: z.literal(1),
    scenario: z.object({
      name: z.string().min(1).max(128),
      sha256: z.string().regex(SHA256_PATTERN)
    }),
    capability: z.object({
      sourceFingerprint: z.string().regex(SHA256_PATTERN)
    }).optional(),
    evidence: z.strictObject({
      evidenceGrade: z.literal('artifact-bound'),
      releaseEligible: z.literal(false),
      targetBinding: z.unknown(),
      targetBindingSha256: z.string().regex(SHA256_PATTERN)
    }),
    signedProviderEvidence: reportReferenceSchema
  })
})

export interface SignedProviderObservationBoundBundleVerification {
  readonly bundleIntegrityVerified: true
  readonly bundleAuthenticityVerified: false
  readonly reportAuthenticityVerified: false
  readonly providerSignatureValid: true
  readonly providerEvidenceReferenceMatched: true
  readonly candidateObservationMatchedNonAuthoritatively: true
  readonly freshnessEstablished: false
  readonly replayChecked: false
  readonly nonceConsumed: false
  readonly challengeIssuanceVerified: false
  readonly verificationTimeTrusted: false
  readonly trustStoreSourceAuthenticityVerified: false
  readonly trustStoreRollbackProtectionVerified: false
  readonly providerKeyCustodyVerified: false
  readonly provesLoadedBytecode: false
  readonly runtimeWired: false
  readonly productionReady: false
  readonly releaseEligible: false
  readonly reportedFunctionalVerdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'
  readonly functionalVerdictAuthenticated: false
  readonly providerEvidenceSha256: string
  readonly targetBindingSha256: string
  readonly trustStoreSha256: string
  readonly keyId: string
  readonly claimedServerInstanceId: string
  readonly claimedBootId: string
}

export interface SignedProviderObservationBoundBundleVerificationInput {
  readonly directory: string
  readonly sealFileName: string
  readonly expectedRunId: string
  readonly expectedBinding: ArtifactTargetBinding
  readonly trustStore: SignedProviderClaimTrustStore
  readonly verificationTimeMs: number
}

export async function verifySignedProviderObservationBoundBundle(
  input: SignedProviderObservationBoundBundleVerificationInput
): Promise<Readonly<SignedProviderObservationBoundBundleVerification>> {
  try {
    if (!input || typeof input !== 'object' || !hasExactKeys(input, INPUT_KEYS)) throw new Error()
    const directory = input.directory
    const sealFileName = input.sealFileName
    const expectedRunIdInput = input.expectedRunId
    const expectedBindingInput = input.expectedBinding
    const trustStore = input.trustStore
    const verificationTimeMs = input.verificationTimeMs
    const expectedRunId = z.string().regex(SAFE_RUN_ID).parse(expectedRunIdInput)
    const expectedBinding = validateArtifactTargetBinding(expectedBindingInput)
    z.number().int().safe().nonnegative().parse(verificationTimeMs)
    const expectedBindingSha256 = artifactTargetBindingSha256(expectedBinding)
    const snapshot = await verifyEvidenceBundleSnapshot(directory, sealFileName)
    if (snapshot.manifest.runId !== expectedRunId
      || snapshot.manifest.targetBindingSha256 !== expectedBindingSha256) throw new Error()

    const reports = snapshot.artifacts.filter(artifact => artifact.descriptor.role === 'report')
    const providerArtifacts = snapshot.artifacts.filter(
      artifact => artifact.descriptor.role === 'provider-evidence'
    )
    if (reports.length !== 1 || providerArtifacts.length !== 1) throw new Error()
    const reportArtifact = reports[0]
    const providerArtifact = providerArtifacts[0]
    if (!reportArtifact || !providerArtifact) throw new Error()

    const reportBytes = Buffer.from(reportArtifact.contentBase64, 'base64')
    const providerBytes = Buffer.from(providerArtifact.contentBase64, 'base64')
    const report = reportSchema.parse(JSON.parse(reportBytes.toString('utf8')))
    const reference = report.manifest.signedProviderEvidence
    if (report.runId !== expectedRunId
      || report.scenario !== report.manifest.scenario.name
      || report.manifest.scenario.sha256 !== snapshot.manifest.scenarioSha256
      || report.manifest.capability?.sourceFingerprint
        !== snapshot.manifest.capabilitySourceFingerprint
      || reference.artifactFileName !== providerArtifact.descriptor.fileName
      || reference.artifactSha256 !== providerArtifact.descriptor.sha256) throw new Error()
    const reportBinding = validateArtifactTargetBinding(report.manifest.evidence.targetBinding)
    if (report.manifest.evidence.targetBindingSha256 !== expectedBindingSha256
      || !exactArtifactTargetBindingMatch(reportBinding, expectedBinding)) throw new Error()

    const envelope = parseSignedProviderClaimEnvelope(
      JSON.parse(providerBytes.toString('utf8'))
    )
    if (envelope.schemaVersion !== 2) throw new Error()
    const claims = envelope.claims
    const {
      challengeId: _challengeId,
      observedAtMs: _observedAtMs,
      claimedServerInstanceId: _claimedServerInstanceId,
      claimedBootId: _claimedBootId,
      loadedArtifacts: _loadedArtifacts,
      ...challengeIdentity
    } = claims
    const expectedChallengeId = createHash('sha256')
      .update(canonicalSignedProviderChallengeIdentityV1(challengeIdentity)).digest('hex')
    if (claims.runId !== expectedRunId
      || claims.challengeId !== expectedChallengeId
      || claims.issuedAtMs >= claims.expiresAtMs
      || claims.observedAtMs < claims.issuedAtMs
      || claims.observedAtMs > claims.expiresAtMs
      || claims.bindingId !== expectedBinding.bindingId
      || claims.targetBindingSha256 !== expectedBindingSha256
      || JSON.stringify(claims.provider) !== JSON.stringify(expectedBinding.provider)
      || JSON.stringify(claims.loadedArtifacts) !== JSON.stringify(expectedBinding.artifacts)) {
      throw new Error()
    }

    const signatureVerification = verifyCanonicalSignedProviderClaimSignature({
      trustStore,
      verificationTimeMs,
      signedContent: {
        schemaVersion: 2,
        profile: envelope.profile,
        claims,
        jvmArtifactObservation: envelope.jvmArtifactObservation
      },
      signature: Buffer.from(envelope.signatureBase64Url, 'base64url')
    })
    const observation = assessJvmArtifactObservationAgainstBinding(
      envelope.jvmArtifactObservation,
      expectedBinding
    )
    if (observation.status !== 'TARGET_FILE_MATCH_NON_AUTHORITATIVE'
      || observation.artifact.role !== 'candidate') throw new Error()

    return Object.freeze({
      bundleIntegrityVerified: true,
      bundleAuthenticityVerified: false,
      reportAuthenticityVerified: false,
      providerSignatureValid: true,
      providerEvidenceReferenceMatched: true,
      candidateObservationMatchedNonAuthoritatively: true,
      freshnessEstablished: false,
      replayChecked: false,
      nonceConsumed: false,
      challengeIssuanceVerified: false,
      verificationTimeTrusted: false,
      trustStoreSourceAuthenticityVerified: false,
      trustStoreRollbackProtectionVerified: false,
      providerKeyCustodyVerified: false,
      provesLoadedBytecode: false,
      runtimeWired: false,
      productionReady: false,
      releaseEligible: false,
      reportedFunctionalVerdict: report.verdict,
      functionalVerdictAuthenticated: false,
      providerEvidenceSha256: providerArtifact.descriptor.sha256,
      targetBindingSha256: expectedBindingSha256,
      trustStoreSha256: signatureVerification.trustStoreSha256,
      keyId: signatureVerification.keyId,
      claimedServerInstanceId: claims.claimedServerInstanceId,
      claimedBootId: claims.claimedBootId
    })
  } catch {
    throw new Error('Signed provider observation-bound evidence bundle verification failed')
  }
}
