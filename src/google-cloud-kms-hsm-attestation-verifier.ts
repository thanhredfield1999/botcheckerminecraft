import { constants, createHash, verify, X509Certificate } from 'node:crypto'
import { gunzipSync } from 'node:zlib'

const SHA256 = /^[a-f0-9]{64}$/
const SINGLE_CERTIFICATE_PEM = /^-----BEGIN CERTIFICATE-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END CERTIFICATE-----\r?\n?$/
// Local allocation-abuse limits; these are not Cloud KMS service maxima.
const MAX_ATTESTATION_GZIP_BYTES = 64 * 1024
const MAX_ATTESTATION_STATEMENT_BYTES = 256 * 1024
const ATTESTATION_SIGNATURE_BYTES = 256
const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  'byteLength'
)?.get
const typedArrayBuffer = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  'buffer'
)?.get

export interface GoogleCloudKmsHsmAttestationVerificationInput {
  readonly attestationFormat: 'CAVIUM_V2_COMPRESSED'
  readonly attestationGzip: Uint8Array
  readonly expectedAttestationGzipSha256: string
  readonly verificationTimeMs: number
  readonly trustAnchors: Readonly<{
    readonly manufacturerRootPem: string
    readonly manufacturerRootCertificateSha256: string
    readonly ownerRootPem: string
    readonly ownerRootCertificateSha256: string
  }>
  readonly certificateChains: Readonly<{
    readonly caviumCerts: readonly string[]
    readonly googleCardCerts: readonly string[]
    readonly googlePartitionCerts: readonly string[]
  }>
}

export interface GoogleCloudKmsHsmAttestationEnvelopeVerification {
  readonly schemaVersion: 2
  readonly attestationFormat: 'CAVIUM_V2_COMPRESSED'
  readonly callerPinnedTrustAnchorFingerprintsMatched: true
  readonly certificateChainSignaturesVerified: true
  readonly cardPublicKeyCrossCertified: true
  readonly partitionPublicKeyCrossCertified: true
  readonly distinctTrustAnchorPublicKeysVerified: true
  readonly distinctCardAndPartitionPublicKeysVerified: true
  readonly certificateValidityAtCallerTimeVerified: true
  readonly verificationTimeSource: 'CALLER_SUPPLIED'
  readonly verificationTimeMs: number
  readonly trustedTimeVerified: false
  readonly certificateRevocationVerified: false
  readonly rfc5280PolicyVerified: false
  readonly attestationSignatureVerified: true
  readonly attestationStatementParsed: false
  readonly attestationEnvelopeCanonicalEncodingVerified: false
  readonly attestationGzipSha256: string
  readonly attestationStatementSha256: string
  readonly manufacturerRootCertificateSha256: string
  readonly ownerRootCertificateSha256: string
  readonly manufacturerRootPublicKeySpkiSha256: string
  readonly ownerRootPublicKeySpkiSha256: string
  readonly manufacturerPartitionCertificateSha256: string
  readonly ownerPartitionCertificateSha256: string
  readonly partitionPublicKeySpkiSha256: string
  readonly productionGoogleTrustAnchorsVerified: false
  readonly attestationAttributesVerified: false
  readonly keyCreatedInsideHsmVerified: false
  readonly keyNonExtractableVerified: false
  readonly resourceBindingVerified: false
  readonly publicKeyBindingVerified: false
  readonly custodyEstablished: false
}

function certificateSha256(certificate: X509Certificate): string {
  return createHash('sha256').update(certificate.raw).digest('hex')
}

function parseCertificate(pem: unknown): X509Certificate {
  if (typeof pem !== 'string' || pem.length < 1 || pem.length > 16 * 1024
    || !SINGLE_CERTIFICATE_PEM.test(pem)) throw new Error()
  return new X509Certificate(pem)
}

function issuedBy(certificate: X509Certificate, issuer: X509Certificate): boolean {
  return certificate.checkIssued(issuer) && certificate.verify(issuer.publicKey)
}

function samePublicKey(left: X509Certificate, right: X509Certificate): boolean {
  const leftDer = left.publicKey.export({ type: 'spki', format: 'der' })
  const rightDer = right.publicKey.export({ type: 'spki', format: 'der' })
  return Buffer.from(leftDer).equals(Buffer.from(rightDer))
}

function publicKeySpkiSha256(certificate: X509Certificate): string {
  const der = certificate.publicKey.export({ type: 'spki', format: 'der' })
  return createHash('sha256').update(der).digest('hex')
}

function exactCertificateArray(input: unknown, expectedLength: number): readonly string[] {
  if (!Array.isArray(input)) throw new Error()
  const initialLength = input.length
  if (initialLength !== expectedLength) throw new Error()
  const snapshot: string[] = []
  for (let index = 0; index < expectedLength; index += 1) {
    const value = input[index]
    if (typeof value !== 'string') throw new Error()
    snapshot.push(value)
  }
  if (input.length !== initialLength) throw new Error()
  return snapshot
}

function validAt(certificate: X509Certificate, verificationTimeMs: number): boolean {
  return certificate.validFromDate.getTime() <= verificationTimeMs
    && verificationTimeMs <= certificate.validToDate.getTime()
}

export function verifyGoogleCloudKmsHsmAttestationEnvelope(
  input: GoogleCloudKmsHsmAttestationVerificationInput
): Readonly<GoogleCloudKmsHsmAttestationEnvelopeVerification> {
  try {
    if (!input || typeof input !== 'object') throw new Error()
    const attestationFormat = input.attestationFormat
    if (attestationFormat !== 'CAVIUM_V2_COMPRESSED') throw new Error()
    const attestationRaw = input.attestationGzip
    const attestationBytes = typedArrayByteLength?.call(attestationRaw) as number
    const attestationBacking = typedArrayBuffer?.call(attestationRaw)
    if (!(attestationBacking instanceof ArrayBuffer)
      || !Number.isSafeInteger(attestationBytes)
      || attestationBytes < 1 || attestationBytes > MAX_ATTESTATION_GZIP_BYTES) {
      throw new Error()
    }
    const attestationGzip = Buffer.from(attestationRaw as Uint8Array)
    if (attestationGzip.byteLength !== attestationBytes) throw new Error()
    const expectedGzipSha256 = input.expectedAttestationGzipSha256
    const verificationTimeMs = input.verificationTimeMs
    if (typeof expectedGzipSha256 !== 'string' || !SHA256.test(expectedGzipSha256)) throw new Error()
    if (!Number.isSafeInteger(verificationTimeMs) || verificationTimeMs <= 0) throw new Error()
    const attestationGzipSha256 = createHash('sha256').update(attestationGzip).digest('hex')
    if (attestationGzipSha256 !== expectedGzipSha256) throw new Error()

    const trustAnchors = input.trustAnchors
    const certificateChains = input.certificateChains
    if (!trustAnchors || typeof trustAnchors !== 'object'
      || !certificateChains || typeof certificateChains !== 'object') throw new Error()
    const manufacturerRoot = parseCertificate(trustAnchors.manufacturerRootPem)
    const ownerRoot = parseCertificate(trustAnchors.ownerRootPem)
    const manufacturerRootSha256 = certificateSha256(manufacturerRoot)
    const ownerRootSha256 = certificateSha256(ownerRoot)
    const manufacturerRootSpkiSha256 = publicKeySpkiSha256(manufacturerRoot)
    const ownerRootSpkiSha256 = publicKeySpkiSha256(ownerRoot)
    if (trustAnchors.manufacturerRootCertificateSha256 !== manufacturerRootSha256
      || trustAnchors.ownerRootCertificateSha256 !== ownerRootSha256
      || manufacturerRootSha256 === ownerRootSha256
      || samePublicKey(manufacturerRoot, ownerRoot)
      || !SHA256.test(manufacturerRootSha256) || !SHA256.test(ownerRootSha256)
      || !manufacturerRoot.ca || !ownerRoot.ca
      || !manufacturerRoot.verify(manufacturerRoot.publicKey)
      || !ownerRoot.verify(ownerRoot.publicKey)) throw new Error()

    const caviumCerts = exactCertificateArray(certificateChains.caviumCerts, 2).map(parseCertificate)
    const googleCardCerts = exactCertificateArray(certificateChains.googleCardCerts, 1).map(parseCertificate)
    const googlePartitionCerts = exactCertificateArray(certificateChains.googlePartitionCerts, 1)
      .map(parseCertificate)
    const manufacturerCards = caviumCerts.filter(certificate => issuedBy(certificate, manufacturerRoot))
    if (manufacturerCards.length !== 1) throw new Error()
    const [manufacturerCard] = manufacturerCards
    const manufacturerPartitions = caviumCerts.filter(certificate => certificate !== manufacturerCard)
    const [manufacturerPartition] = manufacturerPartitions
    const [ownerCard] = googleCardCerts
    const [ownerPartition] = googlePartitionCerts
    if (!manufacturerCard || manufacturerPartitions.length !== 1
      || !manufacturerPartition || !ownerCard || !ownerPartition
      || !issuedBy(manufacturerPartition, manufacturerCard)
      || !issuedBy(ownerCard, ownerRoot)
      || !issuedBy(ownerPartition, ownerRoot)
      || !samePublicKey(manufacturerCard, ownerCard)
      || !samePublicKey(manufacturerPartition, ownerPartition)
      || samePublicKey(manufacturerCard, manufacturerPartition)) throw new Error()
    for (const certificate of [
      manufacturerRoot, ownerRoot, manufacturerCard, manufacturerPartition,
      ownerCard, ownerPartition
    ]) {
      if (!validAt(certificate, verificationTimeMs)) throw new Error()
    }

    const attestation = gunzipSync(attestationGzip, { maxOutputLength: MAX_ATTESTATION_STATEMENT_BYTES })
    if (attestation.byteLength <= ATTESTATION_SIGNATURE_BYTES) throw new Error()
    const statement = attestation.subarray(0, -ATTESTATION_SIGNATURE_BYTES)
    const signature = attestation.subarray(-ATTESTATION_SIGNATURE_BYTES)
    const verifyOptions = { key: manufacturerPartition.publicKey, padding: constants.RSA_PKCS1_PADDING }
    if (!verify('sha256', statement, verifyOptions, signature)
      || !verify('sha256', statement, {
        key: ownerPartition.publicKey,
        padding: constants.RSA_PKCS1_PADDING
      }, signature)) throw new Error()

    return Object.freeze({
      schemaVersion: 2,
      attestationFormat,
      callerPinnedTrustAnchorFingerprintsMatched: true,
      certificateChainSignaturesVerified: true,
      cardPublicKeyCrossCertified: true,
      partitionPublicKeyCrossCertified: true,
      distinctTrustAnchorPublicKeysVerified: true,
      distinctCardAndPartitionPublicKeysVerified: true,
      certificateValidityAtCallerTimeVerified: true,
      verificationTimeSource: 'CALLER_SUPPLIED',
      verificationTimeMs,
      trustedTimeVerified: false,
      certificateRevocationVerified: false,
      rfc5280PolicyVerified: false,
      attestationSignatureVerified: true,
      attestationStatementParsed: false,
      attestationEnvelopeCanonicalEncodingVerified: false,
      attestationGzipSha256,
      attestationStatementSha256: createHash('sha256').update(statement).digest('hex'),
      manufacturerRootCertificateSha256: manufacturerRootSha256,
      ownerRootCertificateSha256: ownerRootSha256,
      manufacturerRootPublicKeySpkiSha256: manufacturerRootSpkiSha256,
      ownerRootPublicKeySpkiSha256: ownerRootSpkiSha256,
      manufacturerPartitionCertificateSha256: certificateSha256(manufacturerPartition),
      ownerPartitionCertificateSha256: certificateSha256(ownerPartition),
      partitionPublicKeySpkiSha256: publicKeySpkiSha256(manufacturerPartition),
      productionGoogleTrustAnchorsVerified: false,
      attestationAttributesVerified: false,
      keyCreatedInsideHsmVerified: false,
      keyNonExtractableVerified: false,
      resourceBindingVerified: false,
      publicKeyBindingVerified: false,
      custodyEstablished: false
    })
  } catch {
    throw new Error('Google Cloud KMS HSM attestation envelope verification failed')
  }
}
