import {
  attestAndVerifyGoogleCloudKmsHsmEd25519KeyBinding,
  type GoogleCloudKmsClientPort,
  type GoogleCloudKmsHsmEd25519KeyAttestationBindingVerification
} from './google-cloud-kms-signing-backend.js'
import {
  resolveGoogleCloudKmsHsmTrustRootPolicy,
  type GoogleCloudKmsHsmTrustRootPolicy
} from './google-cloud-kms-hsm-trust-root-policy.js'

const INPUT_KEYS = new Set([
  'client', 'cryptoKeyVersionName', 'expectedKeyId', 'verificationTimeMs',
  'policy', 'expectedPolicyId', 'expectedRootSetId', 'minimumPolicyRevision'
])

export interface GoogleCloudKmsHsmPolicyAttestAndVerifyInput {
  readonly client: GoogleCloudKmsClientPort
  readonly cryptoKeyVersionName: string
  readonly expectedKeyId: string
  readonly verificationTimeMs: number
  readonly policy: GoogleCloudKmsHsmTrustRootPolicy
  readonly expectedPolicyId: string
  readonly expectedRootSetId: string
  readonly minimumPolicyRevision: number
}

export type GoogleCloudKmsHsmPolicyAttestationVerification = Readonly<
  GoogleCloudKmsHsmEd25519KeyAttestationBindingVerification & {
    readonly policyBridgeSchemaVersion: 1
    readonly policyId: string
    readonly policyRevision: number
    readonly selectedRootSetId: string
    readonly policySha256: string
    readonly callerSuppliedPolicyResolved: true
    readonly activeWindowMatchedAtCallerTime: true
    readonly policySignatureVerified: false
    readonly policySourceAuthenticityVerified: false
    readonly rollbackProtectionVerified: false
  }
>

export async function attestAndVerifyGoogleCloudKmsHsmEd25519KeyWithTrustRootPolicy(
  input: GoogleCloudKmsHsmPolicyAttestAndVerifyInput
): Promise<GoogleCloudKmsHsmPolicyAttestationVerification> {
  try {
    if (!input || typeof input !== 'object') throw new Error()
    const ownKeys = Reflect.ownKeys(input)
    if (ownKeys.length !== INPUT_KEYS.size
      || !ownKeys.every(key => typeof key === 'string' && INPUT_KEYS.has(key))) throw new Error()
    const snapshot = {
      client: input.client,
      cryptoKeyVersionName: input.cryptoKeyVersionName,
      expectedKeyId: input.expectedKeyId,
      verificationTimeMs: input.verificationTimeMs,
      policy: input.policy,
      expectedPolicyId: input.expectedPolicyId,
      expectedRootSetId: input.expectedRootSetId,
      minimumPolicyRevision: input.minimumPolicyRevision
    }
    const resolution = resolveGoogleCloudKmsHsmTrustRootPolicy({
      policy: snapshot.policy,
      expectedPolicyId: snapshot.expectedPolicyId,
      expectedRootSetId: snapshot.expectedRootSetId,
      minimumRevision: snapshot.minimumPolicyRevision,
      verificationTimeMs: snapshot.verificationTimeMs
    })
    const verification = await attestAndVerifyGoogleCloudKmsHsmEd25519KeyBinding({
      client: snapshot.client,
      cryptoKeyVersionName: snapshot.cryptoKeyVersionName,
      expectedKeyId: snapshot.expectedKeyId,
      verificationTimeMs: snapshot.verificationTimeMs,
      trustAnchors: resolution.trustAnchors
    })
    return Object.freeze({
      ...verification,
      policyBridgeSchemaVersion: 1,
      policyId: resolution.policyId,
      policyRevision: resolution.policyRevision,
      selectedRootSetId: resolution.selectedRootSetId,
      policySha256: resolution.policySha256,
      callerSuppliedPolicyResolved: true,
      activeWindowMatchedAtCallerTime: true,
      policySignatureVerified: false,
      policySourceAuthenticityVerified: false,
      rollbackProtectionVerified: false
    })
  } catch {
    throw new Error('Google Cloud KMS HSM policy attest-and-verify failed')
  }
}
