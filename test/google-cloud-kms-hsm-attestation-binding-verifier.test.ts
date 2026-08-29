import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, X509Certificate } from 'node:crypto'
import test from 'node:test'
import { verifyGoogleCloudKmsHsmAttestationBinding } from '../src/google-cloud-kms-hsm-attestation-binding-verifier.js'
import {
  TEST_D4CB_ATTESTATION_GZIP_BASE64,
  TEST_D4CB_INVALID_PROJECT_ATTESTATION_GZIP_BASE64,
  TEST_D4CB_INVALID_PROJECT_RESOURCE_NAME,
  TEST_D4CB_MANUFACTURER_CARD_PEM,
  TEST_D4CB_MANUFACTURER_PARTITION_PEM,
  TEST_D4CB_MANUFACTURER_ROOT_PEM,
  TEST_D4CB_OWNER_CARD_PEM,
  TEST_D4CB_OWNER_PARTITION_PEM,
  TEST_D4CB_OWNER_ROOT_PEM,
  TEST_D4CB_OVERFLOW_NUMERIC_PROJECT_ATTESTATION_GZIP_BASE64,
  TEST_D4CB_OVERFLOW_NUMERIC_PROJECT_RESOURCE_NAME,
  TEST_D4CB_PUBLIC_KEY_PEM,
  TEST_D4CB_PUBLIC_KEY_SPKI_SHA256,
  TEST_D4CB_RESOURCE_NAME,
  TEST_D4CB_SHORT_NUMERIC_PROJECT_ATTESTATION_GZIP_BASE64,
  TEST_D4CB_SHORT_NUMERIC_PROJECT_RESOURCE_NAME
} from './fixtures/google-cloud-kms-attestation-d4cb-fixture.js'

function certificateSha256(pem: string): string {
  return createHash('sha256').update(new X509Certificate(pem).raw).digest('hex')
}

function validInput() {
  const attestationGzip = Buffer.from(TEST_D4CB_ATTESTATION_GZIP_BASE64, 'base64')
  return {
    cryptoKeyVersionName: TEST_D4CB_RESOURCE_NAME,
    expectedPublicKeyPem: TEST_D4CB_PUBLIC_KEY_PEM,
    expectedPublicKeySpkiSha256: TEST_D4CB_PUBLIC_KEY_SPKI_SHA256,
    envelope: {
      attestationFormat: 'CAVIUM_V2_COMPRESSED' as const,
      attestationGzip,
      expectedAttestationGzipSha256: createHash('sha256').update(attestationGzip).digest('hex'),
      verificationTimeMs: Date.UTC(2027, 0, 1),
      trustAnchors: {
        manufacturerRootPem: TEST_D4CB_MANUFACTURER_ROOT_PEM,
        manufacturerRootCertificateSha256: certificateSha256(TEST_D4CB_MANUFACTURER_ROOT_PEM),
        ownerRootPem: TEST_D4CB_OWNER_ROOT_PEM,
        ownerRootCertificateSha256: certificateSha256(TEST_D4CB_OWNER_ROOT_PEM)
      },
      certificateChains: {
        caviumCerts: [TEST_D4CB_MANUFACTURER_PARTITION_PEM, TEST_D4CB_MANUFACTURER_CARD_PEM],
        googleCardCerts: [TEST_D4CB_OWNER_CARD_PEM],
        googlePartitionCerts: [TEST_D4CB_OWNER_PARTITION_PEM]
      }
    }
  }
}

function rejects(input: unknown): void {
  assert.throws(
    () => verifyGoogleCloudKmsHsmAttestationBinding(input as ReturnType<typeof validInput>),
    (error: unknown) => error instanceof Error
      && error.message === 'Google Cloud KMS HSM attestation binding verification failed'
      && !('cause' in error)
      && !/PRIVATE KEY|getter-sensitive-marker/.test(error.message)
  )
}

test('D4c-b compose signature, parser, resource và caller-pinned Ed25519 SPKI binding', () => {
  const result = verifyGoogleCloudKmsHsmAttestationBinding(validInput())

  assert.equal(result.schemaVersion, 1)
  assert.equal(result.envelopeSchemaVersion, 2)
  assert.equal(result.attestationFormat, 'CAVIUM_V2_COMPRESSED')
  assert.equal(result.attestationSignatureVerified, true)
  assert.equal(result.attestationStatementParsed, true)
  assert.equal(result.selectedAttestationAttributesVerified, true)
  assert.equal('attestationAttributesVerified' in result, false)
  assert.equal(result.selectedAttestationAttributesCryptographicallyBoundToCallerPinnedRoots, true)
  assert.equal('attestationAttributesCryptographicallyBoundToCallerPinnedRoots' in result, false)
  assert.equal(result.bindingScope, 'CALLER_PINNED_TRUST_ANCHORS')
  assert.equal(result.resourceBindingVerified, true)
  assert.equal(result.publicKeyBindingVerified, true)
  assert.equal(result.cryptoKeyVersionName, TEST_D4CB_RESOURCE_NAME)
  assert.equal(
    result.cryptoKeyVersionResourceSha256,
    createHash('sha256').update(TEST_D4CB_RESOURCE_NAME, 'utf8').digest('hex')
  )
  assert.equal(result.publicKeySpkiSha256, TEST_D4CB_PUBLIC_KEY_SPKI_SHA256)
  assert.match(result.attestationStatementSha256, /^[a-f0-9]{64}$/)
  assert.equal('keyIdHex' in result, false)
  assert.equal('keyIdPublicComponentBindingVerified' in result, false)
  assert.equal(result.keyLocalAttributeCryptographicallyBoundToCallerPinnedRoots, true)
  assert.equal(result.keyNonExtractableAttributeCryptographicallyBoundToCallerPinnedRoots, true)
  assert.equal(result.keyCreatedInsideHsmVerified, false)
  assert.equal(result.keyNonExtractableVerified, false)
  assert.equal(result.productionGoogleTrustAnchorsVerified, false)
  assert.equal(result.productionKeyCreatedInsideHsmVerified, false)
  assert.equal(result.productionKeyNonExtractableVerified, false)
  assert.equal(result.trustedTimeVerified, false)
  assert.equal(result.certificateRevocationVerified, false)
  assert.equal(result.custodyEstablished, false)
  assert.equal(Object.isFrozen(result), true)
  assert.doesNotMatch(JSON.stringify(result), /BEGIN CERTIFICATE|BEGIN PUBLIC KEY/)
})

test('D4c-b accept signed int64-style short numeric project resource', () => {
  const input = validInput()
  const attestationGzip = Buffer.from(
    TEST_D4CB_SHORT_NUMERIC_PROJECT_ATTESTATION_GZIP_BASE64,
    'base64'
  )
  const result = verifyGoogleCloudKmsHsmAttestationBinding({
    ...input,
    cryptoKeyVersionName: TEST_D4CB_SHORT_NUMERIC_PROJECT_RESOURCE_NAME,
    envelope: {
      ...input.envelope,
      attestationGzip,
      expectedAttestationGzipSha256: createHash('sha256').update(attestationGzip).digest('hex')
    }
  })
  assert.equal(result.cryptoKeyVersionName, TEST_D4CB_SHORT_NUMERIC_PROJECT_RESOURCE_NAME)
})

test('D4c-b reject exact resource substitution và caller-pinned SPKI substitution', () => {
  rejects({
    ...validInput(),
    cryptoKeyVersionName: TEST_D4CB_RESOURCE_NAME.replace(/\/7$/, '/8')
  })

  const other = generateKeyPairSync('ed25519').publicKey
  const otherPem = other.export({ type: 'spki', format: 'pem' }).toString()
  const otherSha256 = createHash('sha256')
    .update(other.export({ type: 'spki', format: 'der' })).digest('hex')
  rejects({ ...validInput(), expectedPublicKeyPem: otherPem, expectedPublicKeySpkiSha256: otherSha256 })
  rejects({ ...validInput(), expectedPublicKeySpkiSha256: 'f'.repeat(64) })

  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey
  const rsaPem = rsa.export({ type: 'spki', format: 'pem' }).toString()
  const rsaSha256 = createHash('sha256')
    .update(rsa.export({ type: 'spki', format: 'der' })).digest('hex')
  rejects({ ...validInput(), expectedPublicKeyPem: rsaPem, expectedPublicKeySpkiSha256: rsaSha256 })
})

test('D4c-b reject envelope tamper dù gzip hash được recompute', () => {
  const input = validInput()
  const tampered = Buffer.from(input.envelope.attestationGzip)
  tampered[40] ^= 1
  rejects({
    ...input,
    envelope: {
      ...input.envelope,
      attestationGzip: tampered,
      expectedAttestationGzipSha256: createHash('sha256').update(tampered).digest('hex')
    }
  })
})

test('D4c-b reject malformed pin, SharedArrayBuffer và sanitize hostile getter', () => {
  rejects({ ...validInput(), cryptoKeyVersionName: `${TEST_D4CB_RESOURCE_NAME}/extra` })
  rejects({
    ...validInput(),
    cryptoKeyVersionName: TEST_D4CB_RESOURCE_NAME.replace('projects/123456789012', 'projects/012345678901')
  })
  rejects({ ...validInput(), expectedPublicKeyPem: `${TEST_D4CB_PUBLIC_KEY_PEM}\ntrailing` })

  const invalidProject = validInput()
  const invalidProjectGzip = Buffer.from(
    TEST_D4CB_INVALID_PROJECT_ATTESTATION_GZIP_BASE64,
    'base64'
  )
  rejects({
    ...invalidProject,
    cryptoKeyVersionName: TEST_D4CB_INVALID_PROJECT_RESOURCE_NAME,
    envelope: {
      ...invalidProject.envelope,
      attestationGzip: invalidProjectGzip,
      expectedAttestationGzipSha256: createHash('sha256').update(invalidProjectGzip).digest('hex')
    }
  })

  const overflowNumeric = validInput()
  const overflowNumericGzip = Buffer.from(
    TEST_D4CB_OVERFLOW_NUMERIC_PROJECT_ATTESTATION_GZIP_BASE64,
    'base64'
  )
  rejects({
    ...overflowNumeric,
    cryptoKeyVersionName: TEST_D4CB_OVERFLOW_NUMERIC_PROJECT_RESOURCE_NAME,
    envelope: {
      ...overflowNumeric.envelope,
      attestationGzip: overflowNumericGzip,
      expectedAttestationGzipSha256: createHash('sha256').update(overflowNumericGzip).digest('hex')
    }
  })

  const source = validInput()
  const shared = new Uint8Array(new SharedArrayBuffer(source.envelope.attestationGzip.byteLength))
  shared.set(source.envelope.attestationGzip)
  rejects({ ...source, envelope: { ...source.envelope, attestationGzip: shared } })

  for (const property of [
    'cryptoKeyVersionName',
    'expectedPublicKeyPem',
    'expectedPublicKeySpkiSha256',
    'envelope'
  ] as const) {
    const hostile = validInput()
    Object.defineProperty(hostile, property, {
      get() { throw new Error('private_key=getter-sensitive-marker') }
    })
    rejects(hostile)
  }

  const hostileEnvelope = validInput()
  Object.defineProperty(hostileEnvelope.envelope, 'attestationGzip', {
    get() { throw new Error('private_key=getter-sensitive-marker') }
  })
  rejects(hostileEnvelope)
})
