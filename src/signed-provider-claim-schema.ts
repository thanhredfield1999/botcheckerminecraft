import path from 'node:path'
import { z } from 'zod'

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

const signedProviderEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  claims: signedProviderClaimsSchema,
  signatureBase64Url: canonicalBase64Url(64)
})

export type SignedProviderClaims = z.infer<typeof signedProviderClaimsSchema>
export type SignedProviderClaimEnvelope = z.infer<typeof signedProviderEnvelopeSchema>

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function canonicalClaimsObject(input: unknown): SignedProviderClaims {
  const claims = signedProviderClaimsSchema.parse(input)
  return {
    schemaVersion: 1,
    domain: CLAIM_DOMAIN,
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

export function canonicalSignedProviderClaimV1(input: unknown): Buffer {
  return Buffer.from(JSON.stringify(canonicalClaimsObject(input)), 'utf8')
}

export function parseSignedProviderClaimEnvelope(input: unknown): SignedProviderClaimEnvelope {
  return signedProviderEnvelopeSchema.parse(input)
}
