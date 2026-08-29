import assert from 'node:assert/strict'
import { createHash, X509Certificate } from 'node:crypto'
import test from 'node:test'
import { gunzipSync, gzipSync } from 'node:zlib'
import { verifyGoogleCloudKmsHsmAttestationEnvelope } from '../src/google-cloud-kms-hsm-attestation-verifier.js'
import {
  TEST_ATTESTATION_GZIP_BASE64,
  TEST_MANUFACTURER_CARD_PEM,
  TEST_MANUFACTURER_PARTITION_PEM,
  TEST_MANUFACTURER_ROOT_PEM,
  TEST_OWNER_CARD_PEM,
  TEST_OWNER_PARTITION_PEM,
  TEST_OWNER_ROOT_PEM
} from './fixtures/google-cloud-kms-attestation-fixture.js'

function certificateSha256(pem: string): string {
  return createHash('sha256').update(new X509Certificate(pem).raw).digest('hex')
}

function validInput() {
  const attestationGzip = Buffer.from(TEST_ATTESTATION_GZIP_BASE64, 'base64')
  return {
    attestationFormat: 'CAVIUM_V2_COMPRESSED' as const,
    attestationGzip,
    expectedAttestationGzipSha256: createHash('sha256').update(attestationGzip).digest('hex'),
    verificationTimeMs: Date.UTC(2027, 0, 1),
    trustAnchors: {
      manufacturerRootPem: TEST_MANUFACTURER_ROOT_PEM,
      manufacturerRootCertificateSha256: certificateSha256(TEST_MANUFACTURER_ROOT_PEM),
      ownerRootPem: TEST_OWNER_ROOT_PEM,
      ownerRootCertificateSha256: certificateSha256(TEST_OWNER_ROOT_PEM)
    },
    certificateChains: {
      caviumCerts: [TEST_MANUFACTURER_PARTITION_PEM, TEST_MANUFACTURER_CARD_PEM],
      googleCardCerts: [TEST_OWNER_CARD_PEM],
      googlePartitionCerts: [TEST_OWNER_PARTITION_PEM]
    }
  }
}

test('D4a verify caller-pinned dual chains và cross-certified attestation signature không overclaim', () => {
  const result = verifyGoogleCloudKmsHsmAttestationEnvelope(validInput())

  assert.equal(result.schemaVersion, 1)
  assert.equal(result.attestationFormat, 'CAVIUM_V2_COMPRESSED')
  assert.equal(result.callerPinnedTrustAnchorFingerprintsMatched, true)
  assert.equal(result.certificateChainSignaturesVerified, true)
  assert.equal(result.cardPublicKeyCrossCertified, true)
  assert.equal(result.partitionPublicKeyCrossCertified, true)
  assert.equal(result.certificateValidityAtCallerTimeVerified, true)
  assert.equal(result.verificationTimeSource, 'CALLER_SUPPLIED')
  assert.equal(result.verificationTimeMs, Date.UTC(2027, 0, 1))
  assert.equal(result.trustedTimeVerified, false)
  assert.equal(result.certificateRevocationVerified, false)
  assert.equal(result.rfc5280PolicyVerified, false)
  assert.equal(result.attestationSignatureVerified, true)
  assert.equal(result.attestationStatementParsed, false)
  assert.equal(result.attestationEnvelopeCanonicalEncodingVerified, false)
  assert.match(result.attestationGzipSha256, /^[a-f0-9]{64}$/)
  assert.match(result.attestationStatementSha256, /^[a-f0-9]{64}$/)
  assert.match(result.manufacturerRootCertificateSha256, /^[a-f0-9]{64}$/)
  assert.match(result.ownerRootCertificateSha256, /^[a-f0-9]{64}$/)
  assert.equal(result.productionGoogleTrustAnchorsVerified, false)
  assert.equal(result.attestationAttributesVerified, false)
  assert.equal(result.keyCreatedInsideHsmVerified, false)
  assert.equal(result.keyNonExtractableVerified, false)
  assert.equal(result.resourceBindingVerified, false)
  assert.equal(result.publicKeyBindingVerified, false)
  assert.equal(result.custodyEstablished, false)
  assert.equal(Object.isFrozen(result), true)
  assert.doesNotMatch(JSON.stringify(result), /BEGIN CERTIFICATE|botchecker-d4-attestation-fixture/)
})

test('D4a manufacturer chain không phụ thuộc thứ tự cert từ protobuf array', () => {
  const input = validInput()
  const result = verifyGoogleCloudKmsHsmAttestationEnvelope({
    ...input,
    certificateChains: {
      ...input.certificateChains,
      caviumCerts: [TEST_MANUFACTURER_CARD_PEM, TEST_MANUFACTURER_PARTITION_PEM]
    }
  })
  assert.equal(result.certificateChainSignaturesVerified, true)
  assert.equal(result.partitionPublicKeyCrossCertified, true)
  assert.equal(result.attestationSignatureVerified, true)
})

function rejectsVerification(input: unknown): void {
  assert.throws(
    () => verifyGoogleCloudKmsHsmAttestationEnvelope(
      input as ReturnType<typeof validInput>
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(error.message, 'Google Cloud KMS HSM attestation envelope verification failed')
      assert.equal('cause' in error, false)
      assert.doesNotMatch(error.message, /getter-sensitive-marker|BEGIN CERTIFICATE/)
      return true
    }
  )
}

test('D4a reject tamper, wrong chain, extra cert và wrong root pin', () => {
  const tampered = validInput()
  tampered.attestationGzip[tampered.attestationGzip.byteLength - 1] ^= 1
  rejectsVerification(tampered)

  rejectsVerification({ ...validInput(), attestationFormat: 'CAVIUM_V1_COMPRESSED' })

  const hiddenExtraPem = validInput()
  rejectsVerification({
    ...hiddenExtraPem,
    trustAnchors: {
      ...hiddenExtraPem.trustAnchors,
      ownerRootPem: TEST_OWNER_ROOT_PEM + TEST_MANUFACTURER_ROOT_PEM
    }
  })

  const wrongRootPin = validInput()
  rejectsVerification({
    ...wrongRootPin,
    trustAnchors: {
      ...wrongRootPin.trustAnchors,
      manufacturerRootCertificateSha256: 'f'.repeat(64)
    }
  })

  const wrongPartition = validInput()
  rejectsVerification({
    ...wrongPartition,
    certificateChains: {
      ...wrongPartition.certificateChains,
      googlePartitionCerts: [TEST_OWNER_CARD_PEM]
    }
  })

  const extraCertificate = validInput()
  rejectsVerification({
    ...extraCertificate,
    certificateChains: {
      ...extraCertificate.certificateChains,
      googleCardCerts: [TEST_OWNER_CARD_PEM, TEST_OWNER_CARD_PEM]
    }
  })

  const collapsedRoots = validInput()
  rejectsVerification({
    ...collapsedRoots,
    trustAnchors: {
      manufacturerRootPem: TEST_MANUFACTURER_ROOT_PEM,
      manufacturerRootCertificateSha256: certificateSha256(TEST_MANUFACTURER_ROOT_PEM),
      ownerRootPem: TEST_MANUFACTURER_ROOT_PEM,
      ownerRootCertificateSha256: certificateSha256(TEST_MANUFACTURER_ROOT_PEM)
    },
    certificateChains: {
      caviumCerts: collapsedRoots.certificateChains.caviumCerts,
      googleCardCerts: [TEST_MANUFACTURER_CARD_PEM],
      googlePartitionCerts: [TEST_MANUFACTURER_PARTITION_PEM]
    }
  })

  rejectsVerification({ ...validInput(), verificationTimeMs: Date.UTC(2020, 0, 1) })
  rejectsVerification({ ...validInput(), verificationTimeMs: Date.UTC(2037, 0, 1) })
})

test('D4a reject statement và signature mutation sau khi gzip hash được recompute', () => {
  for (const offset of [0, -1]) {
    const input = validInput()
    const inflated = gunzipSync(input.attestationGzip)
    const index = offset < 0 ? inflated.byteLength + offset : offset
    inflated[index] ^= 1
    const attestationGzip = gzipSync(inflated)
    rejectsVerification({
      ...input,
      attestationGzip,
      expectedAttestationGzipSha256: createHash('sha256').update(attestationGzip).digest('hex')
    })
  }
})

test('D4a reject cross-domain certificate dù partition SPKI trùng', () => {
  const input = validInput()
  rejectsVerification({
    ...input,
    certificateChains: {
      ...input.certificateChains,
      caviumCerts: [TEST_MANUFACTURER_CARD_PEM, TEST_OWNER_PARTITION_PEM]
    }
  })
})

test('D4a reject certificate array Proxy đổi cardinality giữa validation và snapshot', () => {
  const input = validInput()
  let lengthReads = 0
  const changingLength = new Proxy(
    [TEST_OWNER_CARD_PEM, TEST_OWNER_CARD_PEM],
    {
      get(target, property, receiver) {
        if (property === 'length') return ++lengthReads === 1 ? 1 : 2
        return Reflect.get(target, property, receiver)
      }
    }
  )
  rejectsVerification({
    ...input,
    certificateChains: {
      ...input.certificateChains,
      googleCardCerts: changingLength
    }
  })
})

test('D4a reject shared attestation backing và sanitize hostile getters', () => {
  const source = validInput()
  const sharedBytes = new Uint8Array(new SharedArrayBuffer(source.attestationGzip.byteLength))
  sharedBytes.set(source.attestationGzip)
  rejectsVerification({
    ...source,
    attestationGzip: sharedBytes,
    expectedAttestationGzipSha256: createHash('sha256').update(sharedBytes).digest('hex')
  })

  const sensitive = () => { throw new Error('private_key=getter-sensitive-marker') }
  rejectsVerification({
    ...validInput(),
    get certificateChains() { return sensitive() }
  })
})

test('D4a sanitize mọi hostile getter ở top-level và nested trust boundaries', () => {
  const cases: Array<{
    readonly label: string
    readonly target: (input: ReturnType<typeof validInput>) => object
    readonly property: string
  }> = [
    { label: 'format', target: input => input, property: 'attestationFormat' },
    { label: 'gzip', target: input => input, property: 'attestationGzip' },
    { label: 'gzip hash', target: input => input, property: 'expectedAttestationGzipSha256' },
    { label: 'time', target: input => input, property: 'verificationTimeMs' },
    { label: 'trust object', target: input => input, property: 'trustAnchors' },
    { label: 'chain object', target: input => input, property: 'certificateChains' },
    { label: 'manufacturer root', target: input => input.trustAnchors, property: 'manufacturerRootPem' },
    { label: 'manufacturer pin', target: input => input.trustAnchors, property: 'manufacturerRootCertificateSha256' },
    { label: 'owner root', target: input => input.trustAnchors, property: 'ownerRootPem' },
    { label: 'owner pin', target: input => input.trustAnchors, property: 'ownerRootCertificateSha256' },
    { label: 'cavium chain', target: input => input.certificateChains, property: 'caviumCerts' },
    { label: 'owner card chain', target: input => input.certificateChains, property: 'googleCardCerts' },
    { label: 'owner partition chain', target: input => input.certificateChains, property: 'googlePartitionCerts' }
  ]

  for (const entry of cases) {
    const input = validInput()
    Object.defineProperty(entry.target(input), entry.property, {
      configurable: true,
      get() { throw new Error(`private_key=getter-sensitive-marker-${entry.label}`) }
    })
    rejectsVerification(input)
  }
})
