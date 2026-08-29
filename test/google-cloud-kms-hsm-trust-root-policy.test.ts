import assert from 'node:assert/strict'
import { createHash, X509Certificate } from 'node:crypto'
import test from 'node:test'
import { resolveGoogleCloudKmsHsmTrustRootPolicy } from '../src/google-cloud-kms-hsm-trust-root-policy.js'
import {
  TEST_D4CB_MANUFACTURER_ROOT_PEM,
  TEST_D4CB_OWNER_ROOT_PEM
} from './fixtures/google-cloud-kms-attestation-d4cb-fixture.js'

const POLICY_ID = 'botchecker-kms-hsm-roots'
const VERIFICATION_TIME_MS = Date.UTC(2027, 0, 1)

function certificateSha256(pem: string): string {
  return createHash('sha256').update(new X509Certificate(pem).raw).digest('hex')
}

function validPolicy() {
  return {
    schemaVersion: 1 as const,
    policyId: POLICY_ID,
    revision: 1,
    rootSets: [{
      rootSetId: 'fixture-2027',
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

test('D4d resolve exact active caller-supplied root set nhưng không overclaim production', () => {
  const result = resolveGoogleCloudKmsHsmTrustRootPolicy({
    policy: validPolicy(),
    expectedPolicyId: POLICY_ID,
    expectedRootSetId: 'fixture-2027',
    minimumRevision: 1,
    verificationTimeMs: VERIFICATION_TIME_MS
  })

  assert.equal(result.schemaVersion, 1)
  assert.equal(result.policyId, POLICY_ID)
  assert.equal(result.policyRevision, 1)
  assert.equal(result.selectedRootSetId, 'fixture-2027')
  assert.equal(result.selectionTimeSource, 'CALLER_SUPPLIED')
  assert.equal(result.verificationTimeMs, VERIFICATION_TIME_MS)
  assert.match(result.policySha256, /^[a-f0-9]{64}$/)
  assert.deepEqual(result.trustAnchors, {
    manufacturerRootPem: TEST_D4CB_MANUFACTURER_ROOT_PEM,
    manufacturerRootCertificateSha256: certificateSha256(TEST_D4CB_MANUFACTURER_ROOT_PEM),
    ownerRootPem: TEST_D4CB_OWNER_ROOT_PEM,
    ownerRootCertificateSha256: certificateSha256(TEST_D4CB_OWNER_ROOT_PEM)
  })
  assert.equal(result.callerSuppliedPolicyResolved, true)
  assert.equal(result.activeWindowMatchedAtCallerTime, true)
  assert.equal(result.policySignatureVerified, false)
  assert.equal(result.policySourceAuthenticityVerified, false)
  assert.equal(result.rollbackProtectionVerified, false)
  assert.equal(result.trustedTimeVerified, false)
  assert.equal(result.productionGoogleTrustAnchorsVerified, false)
  assert.equal(Object.isFrozen(result), true)
  assert.equal(Object.isFrozen(result.trustAnchors), true)
})

function rejectsPolicy(policy: unknown): void {
  assert.throws(
    () => resolveGoogleCloudKmsHsmTrustRootPolicy({
      policy: policy as ReturnType<typeof validPolicy>,
      expectedPolicyId: POLICY_ID,
      expectedRootSetId: 'fixture-2027',
      minimumRevision: 1,
      verificationTimeMs: VERIFICATION_TIME_MS
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(error.message, 'Google Cloud KMS HSM trust-root policy resolution failed')
      assert.equal('cause' in error, false)
      return true
    }
  )
}

test('D4d reject unknown top-level và root-set fields thay vì silently ignore', () => {
  rejectsPolicy({ ...validPolicy(), futureSchemaField: true })
  const policy = validPolicy()
  rejectsPolicy({
    ...policy,
    rootSets: [{ ...policy.rootSets[0], misspelledRetirement: true }]
  })
})

test('D4d snapshot policy rootSets getter đúng một lần', () => {
  const base = validPolicy()
  let reads = 0
  const policy = {
    schemaVersion: base.schemaVersion,
    policyId: base.policyId,
    revision: base.revision,
    get rootSets(): typeof base.rootSets {
      reads += 1
      if (reads > 1) throw new Error('private_key=policy-root-sets-getter')
      return base.rootSets
    }
  }

  const result = resolveGoogleCloudKmsHsmTrustRootPolicy({
    policy,
    expectedPolicyId: POLICY_ID,
    expectedRootSetId: 'fixture-2027',
    minimumRevision: 1,
    verificationTimeMs: VERIFICATION_TIME_MS
  })
  assert.equal(result.selectedRootSetId, 'fixture-2027')
  assert.equal(reads, 1)
})

test('D4d snapshot nested root PEM getter đúng một lần', () => {
  const base = validPolicy()
  const root = base.rootSets[0]
  let reads = 0
  const policy = {
    ...base,
    rootSets: [{
      ...root,
      get manufacturerRootPem(): string {
        reads += 1
        if (reads > 1) throw new Error('private_key=nested-root-pem-getter')
        return root.manufacturerRootPem
      }
    }]
  }

  const result = resolveGoogleCloudKmsHsmTrustRootPolicy({
    policy,
    expectedPolicyId: POLICY_ID,
    expectedRootSetId: 'fixture-2027',
    minimumRevision: 1,
    verificationTimeMs: VERIFICATION_TIME_MS
  })
  assert.equal(result.selectedRootSetId, 'fixture-2027')
  assert.equal(reads, 1)
})

test('D4d reject rootSets Proxy đổi cardinality giữa validation và snapshot', () => {
  const base = validPolicy()
  let lengthReads = 0
  const retired = {
    ...base.rootSets[0],
    rootSetId: 'hidden-retired-2027',
    status: 'RETIRED' as const
  }
  const rootSets = new Proxy([...base.rootSets, retired], {
    get(target, property, receiver) {
      if (property === 'length') {
        lengthReads += 1
        return lengthReads === 1 ? 1 : Reflect.get(target, property, receiver)
      }
      return Reflect.get(target, property, receiver)
    }
  })
  rejectsPolicy({ ...base, rootSets })
})

test('D4d rotation overlap resolve exact caller-pinned active root-set ID', () => {
  const policy = validPolicy()
  const next = {
    ...policy.rootSets[0],
    rootSetId: 'fixture-2027-next'
  }
  const result = resolveGoogleCloudKmsHsmTrustRootPolicy({
    policy: { ...policy, rootSets: [...policy.rootSets, next] },
    expectedPolicyId: POLICY_ID,
    expectedRootSetId: 'fixture-2027-next',
    minimumRevision: 1,
    verificationTimeMs: VERIFICATION_TIME_MS
  })
  assert.equal(result.selectedRootSetId, 'fixture-2027-next')
})

test('D4d reject unknown resolver-input field thay vì silently ignore', () => {
  assert.throws(
    () => resolveGoogleCloudKmsHsmTrustRootPolicy({
      policy: validPolicy(),
      expectedPolicyId: POLICY_ID,
      expectedRootSetId: 'fixture-2027',
      minimumRevision: 1,
      verificationTimeMs: VERIFICATION_TIME_MS,
      policySignatureVerified: true
    } as never),
    /trust-root policy resolution failed/i
  )
})

test('D4d policy hash không phụ thuộc ambient localeCompare', () => {
  const original = String.prototype.localeCompare
  String.prototype.localeCompare = function localeSensitiveFailure(): number {
    throw new Error('ambient-locale-must-not-affect-policy-hash')
  }
  try {
    const base = validPolicy()
    const retired = {
      ...base.rootSets[0],
      rootSetId: 'aaa-retired-2026',
      status: 'RETIRED' as const
    }
    const result = resolveGoogleCloudKmsHsmTrustRootPolicy({
      policy: { ...base, rootSets: [...base.rootSets, retired] },
      expectedPolicyId: POLICY_ID,
      expectedRootSetId: 'fixture-2027',
      minimumRevision: 1,
      verificationTimeMs: VERIFICATION_TIME_MS
    })
    assert.match(result.policySha256, /^[a-f0-9]{64}$/)
  } finally {
    String.prototype.localeCompare = original
  }
})

test('D4d fail closed với rollback, retired, gap, duplicate ID và malformed pin', () => {
  const base = validPolicy()
  const root = base.rootSets[0]
  rejectsPolicy({ ...base, revision: 0 })
  rejectsPolicy({ ...base, rootSets: [{ ...root, status: 'RETIRED' }] })
  rejectsPolicy({ ...base, rootSets: [{ ...root, notAfterMs: VERIFICATION_TIME_MS }] })
  rejectsPolicy({ ...base, rootSets: [root, { ...root }] })
  rejectsPolicy({
    ...base,
    rootSets: [{ ...root, manufacturerRootCertificateSha256: 'f'.repeat(63) }]
  })
})

test('D4d reject PEM và certificate SHA-256 pin không khớp', () => {
  const base = validPolicy()
  rejectsPolicy({
    ...base,
    rootSets: [{
      ...base.rootSets[0],
      manufacturerRootCertificateSha256: '0'.repeat(64)
    }]
  })
})

test('D4d canonical policy hash không phụ thuộc thứ tự root sets', () => {
  const base = validPolicy()
  const retired = {
    ...base.rootSets[0],
    rootSetId: 'aaa-retired-2026',
    status: 'RETIRED' as const
  }
  const common = {
    expectedPolicyId: POLICY_ID,
    expectedRootSetId: 'fixture-2027',
    minimumRevision: 1,
    verificationTimeMs: VERIFICATION_TIME_MS
  }
  const first = resolveGoogleCloudKmsHsmTrustRootPolicy({
    ...common,
    policy: { ...base, rootSets: [base.rootSets[0], retired] }
  })
  const second = resolveGoogleCloudKmsHsmTrustRootPolicy({
    ...common,
    policy: { ...base, rootSets: [retired, base.rootSets[0]] }
  })
  assert.equal(first.policySha256, second.policySha256)
})
