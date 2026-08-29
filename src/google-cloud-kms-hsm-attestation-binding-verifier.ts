import { createHash, createPublicKey } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import {
  verifyGoogleCloudKmsHsmAttestationEnvelope,
  type GoogleCloudKmsHsmAttestationVerificationInput
} from './google-cloud-kms-hsm-attestation-verifier.js'
import {
  parseCaviumV2AttestationStatement,
  verifyCaviumV2GeneratedEd25519Attributes
} from './cavium-v2-attestation-statement-parser.js'

const PROJECT = '(?:[a-z][a-z0-9-]{4,28}[a-z0-9]|[1-9][0-9]{0,18})'
const RESOURCE = new RegExp(`^projects\/${PROJECT}\/locations\/[a-z0-9-]{1,63}\/keyRings\/[a-zA-Z0-9_-]{1,63}\/cryptoKeys\/[a-zA-Z0-9_-]{1,63}\/cryptoKeyVersions\/[1-9][0-9]{0,18}$`)
const SHA256 = /^[a-f0-9]{64}$/
const SINGLE_PUBLIC_KEY_PEM = /^-----BEGIN PUBLIC KEY-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END PUBLIC KEY-----\r?\n?$/
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const MAX_ATTESTATION_GZIP_BYTES = 64 * 1024
const MAX_ATTESTATION_STATEMENT_BYTES = 256 * 1024
const ATTESTATION_SIGNATURE_BYTES = 256
const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype), 'byteLength'
)?.get
const typedArrayBuffer = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype), 'buffer'
)?.get

export interface GoogleCloudKmsHsmAttestationBindingVerificationInput {
  readonly cryptoKeyVersionName: string
  readonly expectedPublicKeyPem: string
  readonly expectedPublicKeySpkiSha256: string
  readonly envelope: GoogleCloudKmsHsmAttestationVerificationInput
}

export interface GoogleCloudKmsHsmAttestationBindingVerification {
  readonly schemaVersion: 1
  readonly envelopeSchemaVersion: 2
  readonly attestationFormat: 'CAVIUM_V2_COMPRESSED'
  readonly attestationSignatureVerified: true
  readonly attestationStatementParsed: true
  readonly selectedAttestationAttributesVerified: true
  readonly selectedAttestationAttributesCryptographicallyBoundToCallerPinnedRoots: true
  readonly bindingScope: 'CALLER_PINNED_TRUST_ANCHORS'
  readonly resourceBindingVerified: true
  readonly publicKeyBindingVerified: true
  readonly cryptoKeyVersionName: string
  readonly cryptoKeyVersionResourceSha256: string
  readonly publicKeySpkiSha256: string
  readonly attestationStatementSha256: string
  readonly keyLocalAttributeCryptographicallyBoundToCallerPinnedRoots: true
  readonly keyNonExtractableAttributeCryptographicallyBoundToCallerPinnedRoots: true
  readonly keyCreatedInsideHsmVerified: false
  readonly keyNonExtractableVerified: false
  readonly productionGoogleTrustAnchorsVerified: false
  readonly productionKeyCreatedInsideHsmVerified: false
  readonly productionKeyNonExtractableVerified: false
  readonly trustedTimeVerified: false
  readonly certificateRevocationVerified: false
  readonly custodyEstablished: false
}

function copyAttestationGzip(input: unknown): Buffer {
  const length = typedArrayByteLength?.call(input) as number
  const backing = typedArrayBuffer?.call(input)
  if (!(backing instanceof ArrayBuffer) || !Number.isSafeInteger(length)
    || length < 1 || length > MAX_ATTESTATION_GZIP_BYTES) throw new Error()
  const copied = Buffer.from(input as Uint8Array)
  if (copied.byteLength !== length) throw new Error()
  return copied
}

function parsePinnedEd25519PublicKey(pem: unknown, expectedSha256: unknown): Readonly<{
  spkiSha256: string
  rawPublicKeyHex: string
}> {
  if (typeof pem !== 'string' || pem.length < 1 || pem.length > 4 * 1024
    || !SINGLE_PUBLIC_KEY_PEM.test(pem)
    || typeof expectedSha256 !== 'string' || !SHA256.test(expectedSha256)) throw new Error()
  const key = createPublicKey(pem)
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') throw new Error()
  const spki = Buffer.from(key.export({ type: 'spki', format: 'der' }))
  if (spki.byteLength !== ED25519_SPKI_PREFIX.byteLength + 32
    || !spki.subarray(0, ED25519_SPKI_PREFIX.byteLength).equals(ED25519_SPKI_PREFIX)) throw new Error()
  const spkiSha256 = createHash('sha256').update(spki).digest('hex')
  if (spkiSha256 !== expectedSha256) throw new Error()
  return Object.freeze({
    spkiSha256,
    rawPublicKeyHex: spki.subarray(ED25519_SPKI_PREFIX.byteLength).toString('hex')
  })
}

export function verifyGoogleCloudKmsHsmAttestationBinding(
  input: GoogleCloudKmsHsmAttestationBindingVerificationInput
): Readonly<GoogleCloudKmsHsmAttestationBindingVerification> {
  try {
    if (!input || typeof input !== 'object') throw new Error()
    const cryptoKeyVersionName = input.cryptoKeyVersionName
    const expectedPublicKeyPem = input.expectedPublicKeyPem
    const expectedPublicKeySpkiSha256 = input.expectedPublicKeySpkiSha256
    const envelope = input.envelope
    if (typeof cryptoKeyVersionName !== 'string' || !RESOURCE.test(cryptoKeyVersionName)
      || !envelope || typeof envelope !== 'object') throw new Error()
    const project = cryptoKeyVersionName.slice(
      'projects/'.length,
      cryptoKeyVersionName.indexOf('/locations/')
    )
    if (/^[0-9]+$/.test(project) && BigInt(project) > 9_223_372_036_854_775_807n) throw new Error()
    const attestationGzip = copyAttestationGzip(envelope.attestationGzip)
    const envelopeInput: GoogleCloudKmsHsmAttestationVerificationInput = {
      attestationFormat: envelope.attestationFormat,
      attestationGzip,
      expectedAttestationGzipSha256: envelope.expectedAttestationGzipSha256,
      verificationTimeMs: envelope.verificationTimeMs,
      trustAnchors: envelope.trustAnchors,
      certificateChains: envelope.certificateChains
    }
    const envelopeVerification = verifyGoogleCloudKmsHsmAttestationEnvelope(envelopeInput)

    const inflated = gunzipSync(attestationGzip, { maxOutputLength: MAX_ATTESTATION_STATEMENT_BYTES })
    if (inflated.byteLength <= ATTESTATION_SIGNATURE_BYTES) throw new Error()
    const statementBytes = inflated.subarray(0, -ATTESTATION_SIGNATURE_BYTES)
    const statementSha256 = createHash('sha256').update(statementBytes).digest('hex')
    if (statementSha256 !== envelopeVerification.attestationStatementSha256) throw new Error()

    const statement = parseCaviumV2AttestationStatement(statementBytes)
    const attributes = verifyCaviumV2GeneratedEd25519Attributes(statement)
    const pinnedPublicKey = parsePinnedEd25519PublicKey(
      expectedPublicKeyPem,
      expectedPublicKeySpkiSha256
    )
    const resourceSha256 = createHash('sha256').update(cryptoKeyVersionName, 'utf8').digest('hex')
    if (attributes.keyIdHex.slice(64) !== resourceSha256) throw new Error()
    const publicObject = statement.objects[0]
    if (!publicObject || publicObject.role !== 'PUBLIC_KEY'
      || publicObject.attributes['0x0181'] !== pinnedPublicKey.rawPublicKeyHex) throw new Error()

    return Object.freeze({
      schemaVersion: 1,
      envelopeSchemaVersion: envelopeVerification.schemaVersion,
      attestationFormat: envelopeVerification.attestationFormat,
      attestationSignatureVerified: true,
      attestationStatementParsed: true,
      selectedAttestationAttributesVerified: true,
      selectedAttestationAttributesCryptographicallyBoundToCallerPinnedRoots: true,
      bindingScope: 'CALLER_PINNED_TRUST_ANCHORS',
      resourceBindingVerified: true,
      publicKeyBindingVerified: true,
      cryptoKeyVersionName,
      cryptoKeyVersionResourceSha256: resourceSha256,
      publicKeySpkiSha256: pinnedPublicKey.spkiSha256,
      attestationStatementSha256: statementSha256,
      keyLocalAttributeCryptographicallyBoundToCallerPinnedRoots: true,
      keyNonExtractableAttributeCryptographicallyBoundToCallerPinnedRoots: true,
      keyCreatedInsideHsmVerified: false,
      keyNonExtractableVerified: false,
      productionGoogleTrustAnchorsVerified: false,
      productionKeyCreatedInsideHsmVerified: false,
      productionKeyNonExtractableVerified: false,
      trustedTimeVerified: false,
      certificateRevocationVerified: false,
      custodyEstablished: false
    })
  } catch {
    throw new Error('Google Cloud KMS HSM attestation binding verification failed')
  }
}
