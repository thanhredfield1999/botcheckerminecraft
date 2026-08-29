import assert from 'node:assert/strict'
import { createHash, X509Certificate } from 'node:crypto'
import crc32c from 'fast-crc32c'
import test from 'node:test'
import {
  attestAndVerifyGoogleCloudKmsHsmEd25519KeyWithTrustRootPolicy
} from '../src/google-cloud-kms-hsm-trust-root-policy-attestation.js'
import type { GoogleCloudKmsClientPort } from '../src/google-cloud-kms-signing-backend.js'
import {
  TEST_D4CB_ATTESTATION_GZIP_BASE64,
  TEST_D4CB_MANUFACTURER_CARD_PEM,
  TEST_D4CB_MANUFACTURER_PARTITION_PEM,
  TEST_D4CB_MANUFACTURER_ROOT_PEM,
  TEST_D4CB_OWNER_CARD_PEM,
  TEST_D4CB_OWNER_PARTITION_PEM,
  TEST_D4CB_OWNER_ROOT_PEM,
  TEST_D4CB_PUBLIC_KEY_PEM,
  TEST_D4CB_PUBLIC_KEY_SPKI_SHA256,
  TEST_D4CB_RESOURCE_NAME
} from './fixtures/google-cloud-kms-attestation-d4cb-fixture.js'

const POLICY_ID = 'botchecker-kms-hsm-roots'
const ROOT_SET_ID = 'fixture-2027'
const VERIFICATION_TIME_MS = Date.UTC(2027, 0, 1)

function certificateSha256(pem: string): string {
  return createHash('sha256').update(new X509Certificate(pem).raw).digest('hex')
}

function policy() {
  return {
    schemaVersion: 1 as const,
    policyId: POLICY_ID,
    revision: 1,
    rootSets: [{
      rootSetId: ROOT_SET_ID,
      status: 'ACTIVE' as const,
      notBeforeMs: Date.UTC(2026, 0, 1),
      notAfterMs: Date.UTC(2028, 0, 1),
      manufacturerRootPem: TEST_D4CB_MANUFACTURER_ROOT_PEM,
      manufacturerRootCertificateSha256: certificateSha256(TEST_D4CB_MANUFACTURER_ROOT_PEM),
      ownerRootPem: TEST_D4CB_OWNER_ROOT_PEM,
      ownerRootCertificateSha256: certificateSha256(TEST_D4CB_OWNER_ROOT_PEM)
    }]
  }
}

function client(): GoogleCloudKmsClientPort {
  return {
    async getCryptoKeyVersion() {
      return [{
        name: TEST_D4CB_RESOURCE_NAME,
        state: 'ENABLED',
        algorithm: 'EC_SIGN_ED25519',
        protectionLevel: 'HSM',
        generateTime: { seconds: 1_788_000_000, nanos: 0 },
        importJob: '',
        importTime: null,
        reimportEligible: false,
        attestation: {
          format: 4,
          content: Buffer.from(TEST_D4CB_ATTESTATION_GZIP_BASE64, 'base64'),
          certChains: {
            caviumCerts: [TEST_D4CB_MANUFACTURER_PARTITION_PEM, TEST_D4CB_MANUFACTURER_CARD_PEM],
            googleCardCerts: [TEST_D4CB_OWNER_CARD_PEM],
            googlePartitionCerts: [TEST_D4CB_OWNER_PARTITION_PEM]
          }
        }
      }]
    },
    async getPublicKey() {
      return [{
        name: TEST_D4CB_RESOURCE_NAME,
        pem: TEST_D4CB_PUBLIC_KEY_PEM,
        algorithm: 40,
        protectionLevel: 2,
        pemCrc32c: { value: crc32c.calculate(Buffer.from(TEST_D4CB_PUBLIC_KEY_PEM, 'utf8')) }
      }]
    },
    async asymmetricSign() { throw new Error('không được gọi trong D4d') }
  }
}

test('D4d single-call tự resolve raw policy trước khi verify D4c-c', async () => {
  const result = await attestAndVerifyGoogleCloudKmsHsmEd25519KeyWithTrustRootPolicy({
    client: client(),
    cryptoKeyVersionName: TEST_D4CB_RESOURCE_NAME,
    expectedKeyId: TEST_D4CB_PUBLIC_KEY_SPKI_SHA256,
    verificationTimeMs: VERIFICATION_TIME_MS,
    policy: policy(),
    expectedPolicyId: POLICY_ID,
    expectedRootSetId: ROOT_SET_ID,
    minimumPolicyRevision: 1
  })

  assert.equal(result.policyBridgeSchemaVersion, 1)
  assert.equal(result.policyId, POLICY_ID)
  assert.equal(result.policyRevision, 1)
  assert.equal(result.selectedRootSetId, ROOT_SET_ID)
  assert.match(result.policySha256, /^[a-f0-9]{64}$/)
  assert.equal(result.attestationCryptographicallyVerifiedAgainstCallerPinnedRoots, true)
  assert.equal(result.policySourceAuthenticityVerified, false)
  assert.equal(result.rollbackProtectionVerified, false)
  assert.equal(result.trustedTimeVerified, false)
  assert.equal(result.productionGoogleTrustAnchorsVerified, false)
  assert.equal(Object.isFrozen(result), true)
  assert.doesNotMatch(JSON.stringify(result), /BEGIN CERTIFICATE|manufacturerRootPem|ownerRootPem/)
})

test('D4d reject policy selection invalid trước mọi KMS RPC', async () => {
  let rpcCalls = 0
  const noRpcClient: GoogleCloudKmsClientPort = {
    async getCryptoKeyVersion() { rpcCalls += 1; throw new Error('không được gọi') },
    async getPublicKey() { rpcCalls += 1; throw new Error('không được gọi') },
    async asymmetricSign() { rpcCalls += 1; throw new Error('không được gọi') }
  }
  await assert.rejects(
    () => attestAndVerifyGoogleCloudKmsHsmEd25519KeyWithTrustRootPolicy({
      client: noRpcClient,
      cryptoKeyVersionName: TEST_D4CB_RESOURCE_NAME,
      expectedKeyId: TEST_D4CB_PUBLIC_KEY_SPKI_SHA256,
      verificationTimeMs: VERIFICATION_TIME_MS,
      policy: policy(),
      expectedPolicyId: POLICY_ID,
      expectedRootSetId: 'unknown-root-set',
      minimumPolicyRevision: 2
    }),
    /policy attest-and-verify failed/i
  )
  assert.equal(rpcCalls, 0)
})

test('D4d reject policy PEM/pin mismatch trước mọi KMS RPC', async () => {
  let rpcCalls = 0
  const noRpcClient: GoogleCloudKmsClientPort = {
    async getCryptoKeyVersion() { rpcCalls += 1; throw new Error('không được gọi') },
    async getPublicKey() { rpcCalls += 1; throw new Error('không được gọi') },
    async asymmetricSign() { rpcCalls += 1; throw new Error('không được gọi') }
  }
  const mismatched = policy()
  await assert.rejects(
    () => attestAndVerifyGoogleCloudKmsHsmEd25519KeyWithTrustRootPolicy({
      client: noRpcClient,
      cryptoKeyVersionName: TEST_D4CB_RESOURCE_NAME,
      expectedKeyId: TEST_D4CB_PUBLIC_KEY_SPKI_SHA256,
      verificationTimeMs: VERIFICATION_TIME_MS,
      policy: {
        ...mismatched,
        rootSets: [{
          ...mismatched.rootSets[0],
          manufacturerRootCertificateSha256: '0'.repeat(64)
        }]
      },
      expectedPolicyId: POLICY_ID,
      expectedRootSetId: ROOT_SET_ID,
      minimumPolicyRevision: 1
    }),
    /policy attest-and-verify failed/i
  )
  assert.equal(rpcCalls, 0)
})

test('D4d reject unknown compositor input field', async () => {
  await assert.rejects(
    () => attestAndVerifyGoogleCloudKmsHsmEd25519KeyWithTrustRootPolicy({
      client: client(),
      cryptoKeyVersionName: TEST_D4CB_RESOURCE_NAME,
      expectedKeyId: TEST_D4CB_PUBLIC_KEY_SPKI_SHA256,
      verificationTimeMs: VERIFICATION_TIME_MS,
      policy: policy(),
      expectedPolicyId: POLICY_ID,
      expectedRootSetId: ROOT_SET_ID,
      minimumPolicyRevision: 1,
      policySourceAuthenticityVerified: true
    } as never),
    /policy attest-and-verify failed/i
  )
})
