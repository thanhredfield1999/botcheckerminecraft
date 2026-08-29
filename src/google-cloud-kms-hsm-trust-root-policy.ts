import { createHash, X509Certificate } from 'node:crypto'

const POLICY_ID = /^[a-z][a-z0-9-]{0,62}[a-z0-9]$/
const ROOT_SET_ID = /^[a-z][a-z0-9-]{0,62}[a-z0-9]$/
const SHA256 = /^[a-f0-9]{64}$/
const SINGLE_CERTIFICATE_PEM = /^-----BEGIN CERTIFICATE-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END CERTIFICATE-----\r?\n?$/
const POLICY_KEYS = new Set(['schemaVersion', 'policyId', 'revision', 'rootSets'])
const ROOT_SET_KEYS = new Set([
  'rootSetId', 'status', 'notBeforeMs', 'notAfterMs',
  'manufacturerRootPem', 'manufacturerRootCertificateSha256',
  'ownerRootPem', 'ownerRootCertificateSha256'
])
const RESOLUTION_INPUT_KEYS = new Set([
  'policy', 'expectedPolicyId', 'expectedRootSetId', 'minimumRevision', 'verificationTimeMs'
])

function hasExactKeys(input: object, keys: ReadonlySet<string>): boolean {
  const ownKeys = Reflect.ownKeys(input)
  return ownKeys.length === keys.size
    && ownKeys.every(key => typeof key === 'string' && keys.has(key))
}

function certificateSha256(pem: string): string {
  if (!SINGLE_CERTIFICATE_PEM.test(pem)) throw new Error()
  const certificate = new X509Certificate(pem)
  return createHash('sha256').update(certificate.raw).digest('hex')
}

export interface GoogleCloudKmsHsmTrustRootPolicy {
  readonly schemaVersion: 1
  readonly policyId: string
  readonly revision: number
  readonly rootSets: readonly Readonly<{
    readonly rootSetId: string
    readonly status: 'ACTIVE' | 'RETIRED'
    readonly notBeforeMs: number
    readonly notAfterMs: number
    readonly manufacturerRootPem: string
    readonly manufacturerRootCertificateSha256: string
    readonly ownerRootPem: string
    readonly ownerRootCertificateSha256: string
  }>[]
}

export interface GoogleCloudKmsHsmTrustRootPolicyResolutionInput {
  readonly policy: GoogleCloudKmsHsmTrustRootPolicy
  readonly expectedPolicyId: string
  readonly expectedRootSetId: string
  readonly minimumRevision: number
  readonly verificationTimeMs: number
}

export interface GoogleCloudKmsHsmTrustRootPolicyResolution {
  readonly schemaVersion: 1
  readonly policyId: string
  readonly policyRevision: number
  readonly selectedRootSetId: string
  readonly selectionTimeSource: 'CALLER_SUPPLIED'
  readonly verificationTimeMs: number
  readonly policySha256: string
  readonly trustAnchors: Readonly<{
    readonly manufacturerRootPem: string
    readonly manufacturerRootCertificateSha256: string
    readonly ownerRootPem: string
    readonly ownerRootCertificateSha256: string
  }>
  readonly callerSuppliedPolicyResolved: true
  readonly activeWindowMatchedAtCallerTime: true
  readonly policySignatureVerified: false
  readonly policySourceAuthenticityVerified: false
  readonly rollbackProtectionVerified: false
  readonly trustedTimeVerified: false
  readonly productionGoogleTrustAnchorsVerified: false
}

function canonicalPolicy(policy: GoogleCloudKmsHsmTrustRootPolicy): string {
  const rootSets = [...policy.rootSets]
    .sort((left, right) => left.rootSetId < right.rootSetId
      ? -1
      : left.rootSetId > right.rootSetId ? 1 : 0)
    .map(rootSet => ({
      rootSetId: rootSet.rootSetId,
      status: rootSet.status,
      notBeforeMs: rootSet.notBeforeMs,
      notAfterMs: rootSet.notAfterMs,
      manufacturerRootPem: rootSet.manufacturerRootPem,
      manufacturerRootCertificateSha256: rootSet.manufacturerRootCertificateSha256,
      ownerRootPem: rootSet.ownerRootPem,
      ownerRootCertificateSha256: rootSet.ownerRootCertificateSha256
    }))
  return JSON.stringify({
    schemaVersion: policy.schemaVersion,
    policyId: policy.policyId,
    revision: policy.revision,
    rootSets
  })
}

export function resolveGoogleCloudKmsHsmTrustRootPolicy(
  input: GoogleCloudKmsHsmTrustRootPolicyResolutionInput
): Readonly<GoogleCloudKmsHsmTrustRootPolicyResolution> {
  try {
    if (!input || typeof input !== 'object' || !hasExactKeys(input, RESOLUTION_INPUT_KEYS)) {
      throw new Error()
    }
    const policy = input.policy
    const expectedPolicyId = input.expectedPolicyId
    const expectedRootSetId = input.expectedRootSetId
    const minimumRevision = input.minimumRevision
    const verificationTimeMs = input.verificationTimeMs
    if (!policy || typeof policy !== 'object' || !hasExactKeys(policy, POLICY_KEYS)) throw new Error()
    const policySnapshot = {
      schemaVersion: policy.schemaVersion,
      policyId: policy.policyId,
      revision: policy.revision,
      rootSets: policy.rootSets
    }
    const rootSetCount = Array.isArray(policySnapshot.rootSets)
      ? policySnapshot.rootSets.length
      : 0
    if (policySnapshot.schemaVersion !== 1
      || typeof policySnapshot.policyId !== 'string' || !POLICY_ID.test(policySnapshot.policyId)
      || policySnapshot.policyId !== expectedPolicyId
      || typeof expectedRootSetId !== 'string' || !ROOT_SET_ID.test(expectedRootSetId)
      || !Number.isSafeInteger(policySnapshot.revision) || policySnapshot.revision < 1
      || !Number.isSafeInteger(minimumRevision) || minimumRevision < 1
      || policySnapshot.revision < minimumRevision
      || !Number.isSafeInteger(verificationTimeMs) || verificationTimeMs <= 0
      || !Array.isArray(policySnapshot.rootSets) || rootSetCount < 1
      || rootSetCount > 16) throw new Error()
    const rootSets = []
    for (let index = 0; index < rootSetCount; index += 1) {
      const rootSet = policySnapshot.rootSets[index]
      if (!rootSet || typeof rootSet !== 'object' || !hasExactKeys(rootSet, ROOT_SET_KEYS)) {
        throw new Error()
      }
      const rootSetSnapshot = {
        rootSetId: rootSet.rootSetId,
        status: rootSet.status,
        notBeforeMs: rootSet.notBeforeMs,
        notAfterMs: rootSet.notAfterMs,
        manufacturerRootPem: rootSet.manufacturerRootPem,
        manufacturerRootCertificateSha256: rootSet.manufacturerRootCertificateSha256,
        ownerRootPem: rootSet.ownerRootPem,
        ownerRootCertificateSha256: rootSet.ownerRootCertificateSha256
      }
      if (typeof rootSetSnapshot.rootSetId !== 'string'
        || !ROOT_SET_ID.test(rootSetSnapshot.rootSetId)
        || (rootSetSnapshot.status !== 'ACTIVE' && rootSetSnapshot.status !== 'RETIRED')
        || !Number.isSafeInteger(rootSetSnapshot.notBeforeMs) || rootSetSnapshot.notBeforeMs <= 0
        || !Number.isSafeInteger(rootSetSnapshot.notAfterMs)
        || rootSetSnapshot.notAfterMs <= rootSetSnapshot.notBeforeMs
        || typeof rootSetSnapshot.manufacturerRootPem !== 'string'
        || rootSetSnapshot.manufacturerRootPem.length < 1
        || rootSetSnapshot.manufacturerRootPem.length > 16 * 1024
        || !SHA256.test(rootSetSnapshot.manufacturerRootCertificateSha256)
        || typeof rootSetSnapshot.ownerRootPem !== 'string'
        || rootSetSnapshot.ownerRootPem.length < 1
        || rootSetSnapshot.ownerRootPem.length > 16 * 1024
        || !SHA256.test(rootSetSnapshot.ownerRootCertificateSha256)
        || certificateSha256(rootSetSnapshot.manufacturerRootPem)
          !== rootSetSnapshot.manufacturerRootCertificateSha256
        || certificateSha256(rootSetSnapshot.ownerRootPem)
          !== rootSetSnapshot.ownerRootCertificateSha256) throw new Error()
      rootSets.push(Object.freeze(rootSetSnapshot))
    }
    if (policySnapshot.rootSets.length !== rootSetCount) throw new Error()
    if (new Set(rootSets.map(rootSet => rootSet.rootSetId)).size !== rootSets.length) throw new Error()
    const selected = rootSets.filter(rootSet => rootSet.rootSetId === expectedRootSetId
      && rootSet.status === 'ACTIVE'
      && rootSet.notBeforeMs <= verificationTimeMs
      && verificationTimeMs < rootSet.notAfterMs)
    if (selected.length !== 1) throw new Error()
    const [rootSet] = selected
    if (!rootSet) throw new Error()
    const snapshot = Object.freeze({
      schemaVersion: 1 as const,
      policyId: policySnapshot.policyId,
      revision: policySnapshot.revision,
      rootSets: Object.freeze(rootSets)
    })
    return Object.freeze({
      schemaVersion: 1,
      policyId: snapshot.policyId,
      policyRevision: snapshot.revision,
      selectedRootSetId: rootSet.rootSetId,
      selectionTimeSource: 'CALLER_SUPPLIED',
      verificationTimeMs,
      policySha256: createHash('sha256').update(canonicalPolicy(snapshot)).digest('hex'),
      trustAnchors: Object.freeze({
        manufacturerRootPem: rootSet.manufacturerRootPem,
        manufacturerRootCertificateSha256: rootSet.manufacturerRootCertificateSha256,
        ownerRootPem: rootSet.ownerRootPem,
        ownerRootCertificateSha256: rootSet.ownerRootCertificateSha256
      }),
      callerSuppliedPolicyResolved: true,
      activeWindowMatchedAtCallerTime: true,
      policySignatureVerified: false,
      policySourceAuthenticityVerified: false,
      rollbackProtectionVerified: false,
      trustedTimeVerified: false,
      productionGoogleTrustAnchorsVerified: false
    })
  } catch {
    throw new Error('Google Cloud KMS HSM trust-root policy resolution failed')
  }
}
