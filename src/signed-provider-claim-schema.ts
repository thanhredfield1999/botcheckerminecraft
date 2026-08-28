import path from 'node:path'
import { z } from 'zod'
import {
  canonicalJvmArtifactObservationV1,
  parseJvmArtifactObservationV1,
  type JvmArtifactObservationV1
} from './jvm-artifact-observation.js'

const CLAIM_DOMAIN = 'botcheckerminecraft.signed-provider-claim.v1'
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/
const SAFE_VERSION = /^[a-zA-Z0-9][a-zA-Z0-9._:+-]{0,127}$/
const SAFE_PATH_PART = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/
const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key|bearer)/i

const safeIdentifier = (label: string) => z.string().min(1).max(128).regex(SAFE_ID)
  .refine(value => value === value.normalize('NFC'), `${label} must be NFC normalized`)
  .refine(value => !CREDENTIAL_PATTERN.test(value), `Credential-like ${label} rejected`)

const safeVersion = z.string().min(1).max(128).regex(SAFE_VERSION)
  .refine(value => value === value.normalize('NFC'), 'Version must be NFC normalized')
  .refine(value => !CREDENTIAL_PATTERN.test(value), 'Credential-like version rejected')

const canonicalBase64Url = (bytes: number) => z.string()
  .regex(/^[A-Za-z0-9_-]+$/)
  .refine(value => {
    const decoded = Buffer.from(value, 'base64url')
    return decoded.byteLength === bytes && decoded.toString('base64url') === value
  }, `Value must be canonical base64url for exactly ${bytes} bytes`)

const providerSchema = z.strictObject({
  kind: z.literal('server-probe'),
  id: safeIdentifier('provider ID'),
  version: safeVersion,
  instanceId: safeIdentifier('provider instance ID').optional()
})

const claimedArtifactSchema = z.strictObject({
  logicalId: safeIdentifier('artifact logical ID'),
  role: z.enum(['paper', 'candidate', 'probe', 'config']),
  logicalPath: z.string().min(1).max(240).superRefine((value, context) => {
    if (value !== value.normalize('NFC')) {
      context.addIssue({ code: 'custom', message: 'Logical path must be NFC normalized' })
    }
    if (
      value.startsWith('/')
      || /^[a-zA-Z]:/.test(value)
      || value.includes('\\')
      || path.posix.normalize(value) !== value
      || value.split('/').some(part => !SAFE_PATH_PART.test(part) || part === '.' || part === '..')
    ) context.addIssue({ code: 'custom', message: 'Invalid logical path or traversal' })
    if (CREDENTIAL_PATTERN.test(value)) {
      context.addIssue({ code: 'custom', message: 'Credential-like logical path rejected' })
    }
  }),
  sha256: z.string().regex(SHA256_PATTERN)
})

const signedProviderClaimsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  domain: z.literal(CLAIM_DOMAIN),
  requiredClaimProfile: z.literal('jvm-observation-bound-v2').optional(),
  audience: safeIdentifier('audience'),
  verifierInstanceId: safeIdentifier('verifier instance ID'),
  sequence: z.number().int().safe().positive(),
  challengeId: z.string().regex(SHA256_PATTERN),
  nonceBase64Url: canonicalBase64Url(32),
  runId: safeIdentifier('run ID'),
  keyId: z.string().regex(SHA256_PATTERN),
  bindingId: safeIdentifier('binding ID'),
  targetBindingSha256: z.string().regex(SHA256_PATTERN),
  provider: providerSchema,
  trustStoreId: safeIdentifier('trust store ID'),
  trustStoreVersion: safeVersion,
  trustStoreSha256: z.string().regex(SHA256_PATTERN),
  issuedAtMs: z.number().int().safe().nonnegative(),
  expiresAtMs: z.number().int().safe().positive(),
  observedAtMs: z.number().int().safe().nonnegative(),
  claimedServerInstanceId: safeIdentifier('claimed server instance ID'),
  claimedBootId: safeIdentifier('claimed boot ID'),
  loadedArtifacts: z.array(claimedArtifactSchema).min(1).max(128)
})

const signedProviderChallengeIdentitySchema = signedProviderClaimsSchema.omit({
  challengeId: true,
  observedAtMs: true,
  claimedServerInstanceId: true,
  claimedBootId: true,
  loadedArtifacts: true
})

const signedProviderEnvelopeV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  claims: signedProviderClaimsSchema,
  signatureBase64Url: canonicalBase64Url(64)
})

const signedProviderCanonicalContentV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  claims: signedProviderClaimsSchema
}).superRefine((value, context) => {
  if (value.claims.requiredClaimProfile !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['claims', 'requiredClaimProfile'],
      message: 'Observation-bound claims require canonical signed-provider content v2'
    })
  }
})

const signedProviderEnvelopeV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  profile: z.literal('jvm-observation-bound-v2'),
  claims: signedProviderClaimsSchema,
  jvmArtifactObservation: z.unknown(),
  signatureBase64Url: canonicalBase64Url(64)
}).superRefine((value, context) => {
  if (value.claims.requiredClaimProfile !== 'jvm-observation-bound-v2') {
    context.addIssue({
      code: 'custom',
      path: ['claims', 'requiredClaimProfile'],
      message: 'Observation-bound envelope must be required by its challenge'
    })
  }
})

const signedProviderCanonicalContentV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  profile: z.literal('jvm-observation-bound-v2'),
  claims: signedProviderClaimsSchema,
  jvmArtifactObservation: z.unknown()
}).superRefine((value, context) => {
  if (value.claims.requiredClaimProfile !== 'jvm-observation-bound-v2') {
    context.addIssue({
      code: 'custom',
      path: ['claims', 'requiredClaimProfile'],
      message: 'Observation-bound content must be required by its challenge'
    })
  }
})

const observationBoundCanonicalInputSchema = z.strictObject({
  claims: signedProviderClaimsSchema,
  jvmArtifactObservation: z.unknown()
}).superRefine((value, context) => {
  if (value.claims.requiredClaimProfile !== 'jvm-observation-bound-v2') {
    context.addIssue({
      code: 'custom',
      path: ['claims', 'requiredClaimProfile'],
      message: 'Observation-bound canonical payload requires profile pin'
    })
  }
})

export type SignedProviderClaims = z.infer<typeof signedProviderClaimsSchema>
export type SignedProviderCanonicalClaims = Readonly<
  Omit<SignedProviderClaims, 'provider' | 'loadedArtifacts'> & {
    readonly provider: Readonly<SignedProviderClaims['provider']>
    readonly loadedArtifacts: ReadonlyArray<Readonly<SignedProviderClaims['loadedArtifacts'][number]>>
  }
>
export type SignedProviderClaimEnvelopeV1 = z.infer<typeof signedProviderEnvelopeV1Schema>
export interface SignedProviderClaimEnvelopeV2 {
  readonly schemaVersion: 2
  readonly profile: 'jvm-observation-bound-v2'
  readonly claims: SignedProviderCanonicalClaims
  readonly jvmArtifactObservation: JvmArtifactObservationV1
  readonly signatureBase64Url: string
}
export type SignedProviderClaimEnvelope = SignedProviderClaimEnvelopeV1 | SignedProviderClaimEnvelopeV2
export type SignedProviderCanonicalContent =
  | Readonly<{ schemaVersion: 1; claims: SignedProviderCanonicalClaims }>
  | Readonly<{
      schemaVersion: 2
      profile: 'jvm-observation-bound-v2'
      claims: SignedProviderCanonicalClaims
      jvmArtifactObservation: JvmArtifactObservationV1
    }>

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function canonicalClaimsObject(input: unknown): SignedProviderClaims {
  const claims = signedProviderClaimsSchema.parse(input)
  return {
    schemaVersion: 1,
    domain: CLAIM_DOMAIN,
    ...(claims.requiredClaimProfile === 'jvm-observation-bound-v2'
      ? { requiredClaimProfile: claims.requiredClaimProfile }
      : {}),
    audience: claims.audience,
    verifierInstanceId: claims.verifierInstanceId,
    sequence: claims.sequence,
    challengeId: claims.challengeId,
    nonceBase64Url: claims.nonceBase64Url,
    runId: claims.runId,
    keyId: claims.keyId,
    bindingId: claims.bindingId,
    targetBindingSha256: claims.targetBindingSha256,
    provider: { ...claims.provider },
    trustStoreId: claims.trustStoreId,
    trustStoreVersion: claims.trustStoreVersion,
    trustStoreSha256: claims.trustStoreSha256,
    issuedAtMs: claims.issuedAtMs,
    expiresAtMs: claims.expiresAtMs,
    observedAtMs: claims.observedAtMs,
    claimedServerInstanceId: claims.claimedServerInstanceId,
    claimedBootId: claims.claimedBootId,
    loadedArtifacts: [...claims.loadedArtifacts]
      .map(artifact => ({ ...artifact }))
      .sort((left, right) => compareText(left.logicalId, right.logicalId)
        || compareText(left.role, right.role)
        || compareText(left.logicalPath, right.logicalPath)
        || compareText(left.sha256, right.sha256))
  }
}

function freezeCanonicalClaims(input: unknown): SignedProviderCanonicalClaims {
  const claims = canonicalClaimsObject(input)
  return Object.freeze({
    ...claims,
    provider: Object.freeze({ ...claims.provider }),
    loadedArtifacts: Object.freeze(
      claims.loadedArtifacts.map(artifact => Object.freeze({ ...artifact }))
    )
  })
}

export function canonicalSignedProviderChallengeIdentityV1(input: unknown): Buffer {
  const challenge = signedProviderChallengeIdentitySchema.parse(input)
  return Buffer.from(JSON.stringify({
    schemaVersion: 1,
    domain: CLAIM_DOMAIN,
    ...(challenge.requiredClaimProfile
      ? { requiredClaimProfile: challenge.requiredClaimProfile }
      : {}),
    audience: challenge.audience,
    verifierInstanceId: challenge.verifierInstanceId,
    sequence: challenge.sequence,
    nonceBase64Url: challenge.nonceBase64Url,
    runId: challenge.runId,
    keyId: challenge.keyId,
    bindingId: challenge.bindingId,
    targetBindingSha256: challenge.targetBindingSha256,
    provider: { ...challenge.provider },
    trustStoreId: challenge.trustStoreId,
    trustStoreVersion: challenge.trustStoreVersion,
    trustStoreSha256: challenge.trustStoreSha256,
    issuedAtMs: challenge.issuedAtMs,
    expiresAtMs: challenge.expiresAtMs
  }), 'utf8')
}

export function canonicalSignedProviderClaimV1(input: unknown): Buffer {
  const claims = signedProviderClaimsSchema.parse(input)
  if (claims.requiredClaimProfile !== undefined) {
    throw new Error('Observation-bound claims require canonical signed-provider payload v2')
  }
  return Buffer.from(JSON.stringify(canonicalClaimsObject(claims)), 'utf8')
}

export function canonicalSignedProviderObservationBoundClaimV2(input: unknown): Buffer {
  const value = observationBoundCanonicalInputSchema.parse(input)
  const claims = JSON.stringify(canonicalClaimsObject(value.claims))
  const observation = canonicalJvmArtifactObservationV1(value.jvmArtifactObservation).toString('utf8')
  return Buffer.from(
    `{"schemaVersion":2,"profile":"jvm-observation-bound-v2","claims":${claims},`
      + `"jvmArtifactObservation":${observation}}`,
    'utf8'
  )
}

export function parseSignedProviderCanonicalContent(input: unknown): SignedProviderCanonicalContent {
  const content = z.union([
    signedProviderCanonicalContentV1Schema,
    signedProviderCanonicalContentV2Schema
  ]).parse(input)
  if (content.schemaVersion === 1) {
    return Object.freeze({
      schemaVersion: 1,
      claims: freezeCanonicalClaims(content.claims)
    })
  }
  return Object.freeze({
    schemaVersion: 2,
    profile: 'jvm-observation-bound-v2',
    claims: freezeCanonicalClaims(content.claims),
    jvmArtifactObservation: parseJvmArtifactObservationV1(content.jvmArtifactObservation)
  })
}

export function parseSignedProviderClaimEnvelope(input: unknown): SignedProviderClaimEnvelope {
  const envelope = z.union([signedProviderEnvelopeV1Schema, signedProviderEnvelopeV2Schema]).parse(input)
  if (envelope.schemaVersion === 1) return envelope
  return {
    ...envelope,
    jvmArtifactObservation: parseJvmArtifactObservationV1(envelope.jvmArtifactObservation)
  }
}
