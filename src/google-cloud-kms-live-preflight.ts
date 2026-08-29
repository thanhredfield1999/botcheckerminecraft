import { createHash, randomBytes } from 'node:crypto'
import {
  attestGoogleCloudKmsHsmEd25519Key,
  createGoogleCloudKmsAdcClient,
  createGoogleCloudKmsHsmEd25519SignerBinding
} from './google-cloud-kms-signing-backend.js'

const RESOURCE = /^projects\/[a-z][a-z0-9-]{4,62}\/locations\/[a-z0-9-]{1,63}\/keyRings\/[a-zA-Z0-9_-]{1,63}\/cryptoKeys\/[a-zA-Z0-9_-]{1,63}\/cryptoKeyVersions\/[1-9][0-9]{0,18}$/
const SHA256 = /^[a-f0-9]{64}$/
const EXPECTED_FLAGS = Object.freeze([
  '--expected-key-id',
  '--key-version',
  '--timeout-ms'
])

export interface GoogleCloudKmsLivePreflightInput {
  readonly cryptoKeyVersionName: string
  readonly expectedKeyId: string
  readonly rpcTimeoutMs: number
}

export interface GoogleCloudKmsLivePreflightReport {
  readonly schemaVersion: 2
  readonly status: 'NOT_VERIFIED' | 'OBSERVED'
  readonly keyProtectionMetadataVerified: boolean
  readonly signingOperationObserved: boolean
  readonly keyOriginMetadataVerified: boolean
  readonly attestationCryptographicallyVerified: false
  readonly custodyEstablished: false
  readonly iamLeastPrivilegeVerified: false
  readonly provisioningPolicyVerified: false
  readonly runtimeWiringVerified: false
  readonly keyVersionResourceSha256?: string
  readonly publicKeyId?: string
  readonly probeSha256?: string
  readonly probeBytes?: number
  readonly algorithm?: 'EC_SIGN_ED25519'
  readonly protectionLevel?: 'HSM'
  readonly state?: 'ENABLED'
  readonly keyOriginMetadata?: 'GENERATED_NOT_IMPORTED'
  readonly hsmAttestationFormat?: 'CAVIUM_V1_COMPRESSED' | 'CAVIUM_V2_COMPRESSED'
  readonly hsmAttestationSha256?: string
}

function invalidArguments(): never {
  throw new Error('Google Cloud KMS live preflight arguments are invalid')
}

export function parseGoogleCloudKmsLivePreflightArgs(
  args: readonly string[]
): Readonly<GoogleCloudKmsLivePreflightInput> {
  const values = new Map<string, string>()
  try {
    if (!Array.isArray(args) || args.length !== EXPECTED_FLAGS.length * 2) invalidArguments()
    for (let index = 0; index < args.length; index += 2) {
      const flag = args[index]
      const value = args[index + 1]
      if (!EXPECTED_FLAGS.includes(flag) || values.has(flag) || typeof value !== 'string') {
        invalidArguments()
      }
      values.set(flag, value)
    }
  } catch {
    invalidArguments()
  }
  const cryptoKeyVersionName = values.get('--key-version')
  const expectedKeyId = values.get('--expected-key-id')
  const timeoutRaw = values.get('--timeout-ms')
  if (!cryptoKeyVersionName || !RESOURCE.test(cryptoKeyVersionName)
    || !expectedKeyId || !SHA256.test(expectedKeyId)
    || !timeoutRaw || !/^[1-9][0-9]{2,4}$/.test(timeoutRaw)) {
    invalidArguments()
  }
  const rpcTimeoutMs = Number(timeoutRaw)
  if (!Number.isSafeInteger(rpcTimeoutMs) || rpcTimeoutMs < 100 || rpcTimeoutMs > 30_000) {
    invalidArguments()
  }
  return Object.freeze({ cryptoKeyVersionName, expectedKeyId, rpcTimeoutMs })
}

export function createGoogleCloudKmsLiveFailureReport(): Readonly<GoogleCloudKmsLivePreflightReport> {
  return Object.freeze({
    schemaVersion: 2,
    status: 'NOT_VERIFIED',
    keyProtectionMetadataVerified: false,
    signingOperationObserved: false,
    keyOriginMetadataVerified: false,
    attestationCryptographicallyVerified: false,
    custodyEstablished: false,
    iamLeastPrivilegeVerified: false,
    provisioningPolicyVerified: false,
    runtimeWiringVerified: false
  })
}

function createObservedReport(input: Readonly<{
  readonly keyVersionResourceSha256: string
  readonly publicKeyId: string
  readonly probeSha256: string
  readonly probeBytes: number
  readonly algorithm: 'EC_SIGN_ED25519'
  readonly protectionLevel: 'HSM'
  readonly state: 'ENABLED'
  readonly keyOriginMetadata: 'GENERATED_NOT_IMPORTED'
  readonly hsmAttestationFormat: 'CAVIUM_V1_COMPRESSED' | 'CAVIUM_V2_COMPRESSED'
  readonly hsmAttestationSha256: string
}>): Readonly<GoogleCloudKmsLivePreflightReport> {
  return Object.freeze({
    schemaVersion: 2,
    status: 'OBSERVED',
    keyProtectionMetadataVerified: true,
    signingOperationObserved: true,
    keyOriginMetadataVerified: true,
    attestationCryptographicallyVerified: false,
    custodyEstablished: false,
    iamLeastPrivilegeVerified: false,
    provisioningPolicyVerified: false,
    runtimeWiringVerified: false,
    ...input
  })
}

async function runGoogleCloudKmsLivePreflight(
  input: Readonly<GoogleCloudKmsLivePreflightInput>
): Promise<Readonly<GoogleCloudKmsLivePreflightReport>> {
  try {
    const client = createGoogleCloudKmsAdcClient({ rpcTimeoutMs: input.rpcTimeoutMs })
    try {
      const attestation = await attestGoogleCloudKmsHsmEd25519Key({
        client,
        cryptoKeyVersionName: input.cryptoKeyVersionName,
        expectedKeyId: input.expectedKeyId,
        requiredKeyOriginMetadata: 'GENERATED_NOT_IMPORTED'
      })
      if (attestation.keyOriginMetadata !== 'GENERATED_NOT_IMPORTED'
        || !attestation.hsmAttestationFormat || !attestation.hsmAttestationSha256
        || attestation.attestationCryptographicallyVerified !== false) {
        return createGoogleCloudKmsLiveFailureReport()
      }
      const binding = createGoogleCloudKmsHsmEd25519SignerBinding({ client, attestation })
      const probe = randomBytes(32)
      await binding.sign({
        canonicalPayload: probe,
        opaqueKeyHandleId: binding.opaqueKeyHandleId,
        signal: new AbortController().signal
      })
      return createObservedReport({
        keyVersionResourceSha256: createHash('sha256').update(input.cryptoKeyVersionName).digest('hex'),
        publicKeyId: attestation.keyId,
        probeSha256: createHash('sha256').update(probe).digest('hex'),
        probeBytes: probe.byteLength,
        algorithm: attestation.algorithm,
        protectionLevel: attestation.protectionLevel,
        state: attestation.state,
        keyOriginMetadata: attestation.keyOriginMetadata,
        hsmAttestationFormat: attestation.hsmAttestationFormat,
        hsmAttestationSha256: attestation.hsmAttestationSha256
      })
    } finally {
      await client.close?.()
    }
  } catch {
    return createGoogleCloudKmsLiveFailureReport()
  }
}

export async function executeGoogleCloudKmsLivePreflightArgs(
  args: readonly string[]
): Promise<Readonly<GoogleCloudKmsLivePreflightReport>> {
  try {
    return await runGoogleCloudKmsLivePreflight(parseGoogleCloudKmsLivePreflightArgs(args))
  } catch {
    return createGoogleCloudKmsLiveFailureReport()
  }
}
