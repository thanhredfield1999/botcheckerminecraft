import { createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto'
import { KeyManagementServiceClient } from '@google-cloud/kms'
import crc32c from 'fast-crc32c'

const RESOURCE = /^projects\/[a-z][a-z0-9-]{4,62}\/locations\/[a-z0-9-]{1,63}\/keyRings\/[a-zA-Z0-9_-]{1,63}\/cryptoKeys\/[a-zA-Z0-9_-]{1,63}\/cryptoKeyVersions\/[1-9][0-9]{0,18}$/
const SHA256 = /^[a-f0-9]{64}$/
const MAX_CANONICAL_PAYLOAD_BYTES = 256 * 1024
// Local allocation-abuse cap, not a claim about the Cloud KMS service maximum.
const MAX_HSM_ATTESTATION_BYTES = 64 * 1024
const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  'byteLength'
)?.get
const typedArrayBuffer = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  'buffer'
)?.get
const attestedClients = new WeakMap<object, {
  readonly client: GoogleCloudKmsClientPort
  readonly asymmetricSign: GoogleCloudKmsClientPort['asymmetricSign']
  readonly publicKey: KeyObject
  readonly cryptoKeyVersionName: string
  readonly keyId: string
}>()

export interface GoogleCloudKmsClientPort {
  getCryptoKeyVersion(input: { readonly name: string }): Promise<readonly [unknown, ...unknown[]]>
  getPublicKey(input: { readonly name: string }): Promise<readonly [unknown, ...unknown[]]>
  asymmetricSign(input: GoogleCloudKmsAsymmetricSignRequest): Promise<readonly [unknown, ...unknown[]]>
  close?(): Promise<void>
}

export interface GoogleCloudKmsAsymmetricSignRequest {
  readonly name: string
  readonly data: Uint8Array
  readonly dataCrc32c: Readonly<{ value: number }>
}

export interface GoogleCloudKmsHsmEd25519Attestation {
  readonly cryptoKeyVersionName: string
  readonly keyId: string
  readonly algorithm: 'EC_SIGN_ED25519'
  readonly protectionLevel: 'HSM'
  readonly state: 'ENABLED'
  readonly keyProtectionMetadataVerified: true
  readonly signingOperationObserved: false
  readonly custodyEstablished: false
  readonly keyOriginMetadata?: 'GENERATED_NOT_IMPORTED'
  readonly hsmAttestationPresent?: true
  readonly hsmAttestationFormat?: 'CAVIUM_V1_COMPRESSED' | 'CAVIUM_V2_COMPRESSED'
  readonly hsmAttestationSha256?: string
  readonly attestationCryptographicallyVerified?: false
}

export interface GoogleCloudKmsAttestationInput {
  readonly client: GoogleCloudKmsClientPort
  readonly cryptoKeyVersionName: string
  readonly expectedKeyId: string
  readonly requiredKeyOriginMetadata?: 'GENERATED_NOT_IMPORTED'
}

export interface GoogleCloudKmsHsmSignerBinding {
  readonly keyId: string
  readonly opaqueKeyHandleId: string
  readonly sign: GoogleCloudKmsOpaqueSignCallback
}

export type GoogleCloudKmsOpaqueSignCallback = (request: Readonly<{
  readonly canonicalPayload: Uint8Array
  readonly opaqueKeyHandleId: string
  readonly signal: AbortSignal
}>) => Uint8Array | Promise<Uint8Array>

export interface GoogleCloudKmsSignerBindingInput {
  readonly client: GoogleCloudKmsClientPort
  readonly attestation: Readonly<GoogleCloudKmsHsmEd25519Attestation>
}

export interface GoogleCloudKmsAdcClientOptions {
  readonly rpcTimeoutMs: number
}

export function createGoogleCloudKmsAdcClient(
  input: GoogleCloudKmsAdcClientOptions
): Readonly<GoogleCloudKmsClientPort> {
  let rpcTimeoutMs: number
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.getPrototypeOf(input) !== Object.prototype
      || Reflect.ownKeys(input).length !== 1
      || !Object.prototype.hasOwnProperty.call(input, 'rpcTimeoutMs')) {
      throw new Error()
    }
    rpcTimeoutMs = input.rpcTimeoutMs
  } catch {
    throw new Error('Google Cloud KMS ADC client options are invalid')
  }
  if (!Number.isSafeInteger(rpcTimeoutMs) || rpcTimeoutMs < 100 || rpcTimeoutMs > 30_000) {
    throw new Error('Google Cloud KMS RPC timeout is invalid')
  }
  const client = new KeyManagementServiceClient()
  const callOptions = Object.freeze({ timeout: rpcTimeoutMs, retry: null })
  const port: GoogleCloudKmsClientPort = {
    getCryptoKeyVersion: input => client.getCryptoKeyVersion(input, callOptions),
    getPublicKey: input => client.getPublicKey(input, callOptions),
    asymmetricSign: input => client.asymmetricSign(input, callOptions),
    close: async () => { await client.close() }
  }
  return Object.freeze(port)
}

function record(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`Google Cloud KMS ${label} is invalid`)
  }
  return input as Record<string, unknown>
}

function isEnum(input: unknown, name: string, number: number): boolean {
  return input === name || input === number
}

function uint32(input: unknown, label: string): number {
  try {
    if (typeof input === 'number' && Number.isSafeInteger(input)
      && input >= 0 && input <= 0xffff_ffff) return input
    if (typeof input === 'string' && /^(0|[1-9][0-9]{0,9})$/.test(input)) {
      const parsed = Number(input)
      if (parsed <= 0xffff_ffff) return parsed
    }
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      const value = input as Record<string, unknown>
      const low = value.low
      const high = value.high
      if (Number.isInteger(low) && high === 0) return (low as number) >>> 0
    }
  } catch {
    // Normalize hostile protobuf-wrapper accessors below.
  }
  throw new Error(`Google Cloud KMS ${label} is invalid`)
}

function abortSignalIsAborted(signal: AbortSignal): boolean {
  try {
    return signal.aborted
  } catch {
    throw new Error('Google Cloud KMS signing request is invalid')
  }
}

function parseEd25519PublicKey(pem: string): Readonly<{ key: KeyObject, keyId: string }> {
  let key
  try {
    key = createPublicKey(pem)
  } catch {
    throw new Error('Google Cloud KMS public key is invalid')
  }
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') {
    throw new Error('Google Cloud KMS public key must be Ed25519')
  }
  const der = key.export({ type: 'spki', format: 'der' })
  return Object.freeze({ key, keyId: createHash('sha256').update(der).digest('hex') })
}

function copyExactSignature(input: unknown): Buffer {
  try {
    if (!(input instanceof Uint8Array)
      || !typedArrayByteLength
      || typedArrayByteLength.call(input) !== 64) {
      throw new Error()
    }
    const copied = Buffer.from(input.subarray(0, 64))
    if (copied.byteLength !== 64) throw new Error()
    return copied
  } catch {
    throw new Error('Google Cloud KMS signature is invalid')
  }
}

function validProtobufTimestamp(input: unknown): boolean {
  try {
    const timestamp = record(input, 'generation timestamp')
    const seconds = timestamp.seconds
    const nanos = timestamp.nanos
    let normalizedSeconds: number
    if (typeof seconds === 'number') {
      normalizedSeconds = seconds
    } else if (typeof seconds === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(seconds)) {
      normalizedSeconds = Number(seconds)
    } else {
      const long = record(seconds, 'generation timestamp seconds')
      const low = long.low
      const high = long.high
      if (!Number.isInteger(low) || !Number.isInteger(high)
        || (low as number) < -0x8000_0000 || (low as number) > 0x7fff_ffff
        || (high as number) < 0 || (high as number) > 0x1f_ffff) return false
      normalizedSeconds = (high as number) * 0x1_0000_0000 + ((low as number) >>> 0)
    }
    return Number.isSafeInteger(normalizedSeconds)
      && normalizedSeconds >= 0 && normalizedSeconds <= 253_402_300_799
      && Number.isInteger(nanos) && (nanos as number) >= 0 && (nanos as number) <= 999_999_999
  } catch {
    return false
  }
}

function copyHsmAttestation(input: unknown): Readonly<{
  format: 'CAVIUM_V1_COMPRESSED' | 'CAVIUM_V2_COMPRESSED'
  sha256: string
}> {
  try {
    const attestation = record(input, 'HSM attestation')
    const formatRaw = attestation.format
    const contentRaw = attestation.content
    const format = formatRaw === 3 || formatRaw === 'CAVIUM_V1_COMPRESSED'
      ? 'CAVIUM_V1_COMPRESSED'
      : formatRaw === 4 || formatRaw === 'CAVIUM_V2_COMPRESSED'
        ? 'CAVIUM_V2_COMPRESSED'
        : undefined
    const bytes = typedArrayByteLength?.call(contentRaw) as number
    const backing = typedArrayBuffer?.call(contentRaw)
    if (!format || !(backing instanceof ArrayBuffer)
      || !Number.isSafeInteger(bytes) || bytes <= 0
      || bytes > MAX_HSM_ATTESTATION_BYTES) throw new Error()
    const content = Buffer.from(contentRaw as Uint8Array)
    if (content.byteLength !== bytes) throw new Error()
    return Object.freeze({ format, sha256: createHash('sha256').update(content).digest('hex') })
  } catch {
    throw new Error('Google Cloud KMS HSM attestation metadata is invalid')
  }
}

export async function attestGoogleCloudKmsHsmEd25519Key(
  input: GoogleCloudKmsAttestationInput
): Promise<Readonly<GoogleCloudKmsHsmEd25519Attestation>> {
  if (!input || typeof input !== 'object') {
    throw new Error('Google Cloud KMS attestation input is invalid')
  }
  let inputSnapshot: {
    readonly client: GoogleCloudKmsClientPort
    readonly cryptoKeyVersionName: string
    readonly expectedKeyId: string
    readonly requiredKeyOriginMetadata?: 'GENERATED_NOT_IMPORTED'
  }
  let getCryptoKeyVersion: GoogleCloudKmsClientPort['getCryptoKeyVersion']
  let getPublicKey: GoogleCloudKmsClientPort['getPublicKey']
  let asymmetricSign: GoogleCloudKmsClientPort['asymmetricSign']
  try {
    inputSnapshot = {
      client: input.client,
      cryptoKeyVersionName: input.cryptoKeyVersionName,
      expectedKeyId: input.expectedKeyId,
      requiredKeyOriginMetadata: input.requiredKeyOriginMetadata
    }
    if (!inputSnapshot.client) throw new Error()
    if (inputSnapshot.requiredKeyOriginMetadata !== undefined
      && inputSnapshot.requiredKeyOriginMetadata !== 'GENERATED_NOT_IMPORTED') throw new Error()
    getCryptoKeyVersion = inputSnapshot.client.getCryptoKeyVersion.bind(inputSnapshot.client)
    getPublicKey = inputSnapshot.client.getPublicKey.bind(inputSnapshot.client)
    asymmetricSign = inputSnapshot.client.asymmetricSign.bind(inputSnapshot.client)
  } catch {
    throw new Error('Google Cloud KMS attestation input is invalid')
  }
  const name = inputSnapshot.cryptoKeyVersionName
  if (typeof name !== 'string' || !RESOURCE.test(name)) {
    throw new Error('Google Cloud KMS key version resource is invalid')
  }
  if (typeof inputSnapshot.expectedKeyId !== 'string' || !SHA256.test(inputSnapshot.expectedKeyId)) {
    throw new Error('Google Cloud KMS expected key ID is invalid')
  }

  let versionRaw: unknown
  try {
    ;[versionRaw] = await getCryptoKeyVersion({ name })
  } catch {
    throw new Error('Google Cloud KMS attestation failed')
  }
  let versionSnapshot: Readonly<{
    name: unknown
    state: unknown
    algorithm: unknown
    protectionLevel: unknown
    generateTime?: unknown
    importJob?: unknown
    importTime?: unknown
    reimportEligible?: unknown
    attestation?: unknown
  }>
  try {
    const version = record(versionRaw, 'key version')
    const baseSnapshot = {
      name: version.name,
      state: version.state,
      algorithm: version.algorithm,
      protectionLevel: version.protectionLevel
    }
    versionSnapshot = inputSnapshot.requiredKeyOriginMetadata === 'GENERATED_NOT_IMPORTED'
      ? {
          ...baseSnapshot,
          generateTime: version.generateTime,
          importJob: version.importJob,
          importTime: version.importTime,
          reimportEligible: version.reimportEligible,
          attestation: version.attestation
        }
      : baseSnapshot
  } catch {
    throw new Error('Google Cloud KMS key version response is invalid')
  }
  if (versionSnapshot.name !== name || !isEnum(versionSnapshot.state, 'ENABLED', 1)
    || !isEnum(versionSnapshot.algorithm, 'EC_SIGN_ED25519', 40)
    || !isEnum(versionSnapshot.protectionLevel, 'HSM', 2)) {
    throw new Error('Google Cloud KMS key version posture is invalid')
  }
  let originMetadata: Readonly<{
    keyOriginMetadata: 'GENERATED_NOT_IMPORTED'
    hsmAttestationPresent: true
    hsmAttestationFormat: 'CAVIUM_V1_COMPRESSED' | 'CAVIUM_V2_COMPRESSED'
    hsmAttestationSha256: string
    attestationCryptographicallyVerified: false
  }> | undefined
  if (inputSnapshot.requiredKeyOriginMetadata === 'GENERATED_NOT_IMPORTED') {
    const importJobAbsent = versionSnapshot.importJob === undefined
      || versionSnapshot.importJob === null || versionSnapshot.importJob === ''
    const importTimeAbsent = versionSnapshot.importTime === undefined
      || versionSnapshot.importTime === null
    if (!validProtobufTimestamp(versionSnapshot.generateTime) || !importJobAbsent
      || !importTimeAbsent || versionSnapshot.reimportEligible !== false) {
      throw new Error('Google Cloud KMS key origin metadata is invalid')
    }
    const hsmAttestation = copyHsmAttestation(versionSnapshot.attestation)
    originMetadata = Object.freeze({
      keyOriginMetadata: 'GENERATED_NOT_IMPORTED',
      hsmAttestationPresent: true,
      hsmAttestationFormat: hsmAttestation.format,
      hsmAttestationSha256: hsmAttestation.sha256,
      attestationCryptographicallyVerified: false
    })
  }

  let publicRaw: unknown
  try {
    ;[publicRaw] = await getPublicKey({ name })
  } catch {
    throw new Error('Google Cloud KMS attestation failed')
  }
  let publicKeySnapshot: Record<
    'name' | 'pem' | 'algorithm' | 'protectionLevel' | 'pemCrc32c',
    unknown
  >
  try {
    const publicKey = record(publicRaw, 'public key')
    publicKeySnapshot = {
      name: publicKey.name,
      pem: publicKey.pem,
      algorithm: publicKey.algorithm,
      protectionLevel: publicKey.protectionLevel,
      pemCrc32c: publicKey.pemCrc32c
    }
  } catch {
    throw new Error('Google Cloud KMS public key response is invalid')
  }
  if (publicKeySnapshot.name !== name || typeof publicKeySnapshot.pem !== 'string'
    || !isEnum(publicKeySnapshot.algorithm, 'EC_SIGN_ED25519', 40)
    || !isEnum(publicKeySnapshot.protectionLevel, 'HSM', 2)) {
    throw new Error('Google Cloud KMS public key response is invalid')
  }
  let pemChecksum: number
  try {
    pemChecksum = uint32(
      record(publicKeySnapshot.pemCrc32c, 'public key checksum').value,
      'public key checksum'
    )
  } catch {
    throw new Error('Google Cloud KMS public key checksum is invalid')
  }
  if (pemChecksum !== crc32c.calculate(Buffer.from(publicKeySnapshot.pem, 'utf8'))) {
    throw new Error('Google Cloud KMS public key integrity is invalid')
  }
  const parsedPublicKey = parseEd25519PublicKey(publicKeySnapshot.pem)
  const keyId = parsedPublicKey.keyId
  if (keyId !== inputSnapshot.expectedKeyId) {
    throw new Error('Google Cloud KMS public key fingerprint mismatch')
  }
  const attestation = Object.freeze({
    cryptoKeyVersionName: name,
    keyId,
    algorithm: 'EC_SIGN_ED25519',
    protectionLevel: 'HSM',
    state: 'ENABLED',
    keyProtectionMetadataVerified: true,
    signingOperationObserved: false,
    custodyEstablished: false,
    ...(originMetadata ?? {})
  })
  attestedClients.set(attestation, {
    client: inputSnapshot.client,
    asymmetricSign,
    publicKey: parsedPublicKey.key,
    cryptoKeyVersionName: name,
    keyId
  })
  return attestation
}

export function createGoogleCloudKmsHsmEd25519SignerBinding(
  input: GoogleCloudKmsSignerBindingInput
): Readonly<GoogleCloudKmsHsmSignerBinding> {
  if (!input || typeof input !== 'object') {
    throw new Error('Google Cloud KMS signer binding input is invalid')
  }
  let inputSnapshot: {
    readonly client: GoogleCloudKmsClientPort
    readonly attestation: Readonly<GoogleCloudKmsHsmEd25519Attestation>
  }
  try {
    inputSnapshot = { client: input.client, attestation: input.attestation }
  } catch {
    throw new Error('Google Cloud KMS signer binding input is invalid')
  }
  if (!inputSnapshot.client || !inputSnapshot.attestation) {
    throw new Error('Google Cloud KMS signer binding input is invalid')
  }
  const clientSnapshot = attestedClients.get(inputSnapshot.attestation)
  if (!clientSnapshot) throw new Error('Google Cloud KMS attestation is invalid')
  if (clientSnapshot.client !== inputSnapshot.client) throw new Error('Google Cloud KMS client mismatch')
  const name = clientSnapshot.cryptoKeyVersionName
  const opaqueKeyHandleId = `gcp-kms-hsm:${createHash('sha256').update(name).digest('hex').slice(0, 32)}`
  const sign: GoogleCloudKmsOpaqueSignCallback = async request => {
    let requestSnapshot: {
      readonly opaqueKeyHandleId: string
      readonly signal: AbortSignal
      readonly canonicalPayload: Uint8Array
    }
    try {
      requestSnapshot = {
        opaqueKeyHandleId: request.opaqueKeyHandleId,
        signal: request.signal,
        canonicalPayload: request.canonicalPayload
      }
    } catch {
      throw new Error('Google Cloud KMS signing request is invalid')
    }
    if (requestSnapshot.opaqueKeyHandleId !== opaqueKeyHandleId
      || abortSignalIsAborted(requestSnapshot.signal)) {
      throw new Error('Google Cloud KMS signing request is invalid')
    }
    let payloadBytes: number
    try {
      payloadBytes = typedArrayByteLength?.call(requestSnapshot.canonicalPayload) as number
    } catch {
      throw new Error('Google Cloud KMS signing payload is invalid')
    }
    if (!Number.isSafeInteger(payloadBytes) || payloadBytes <= 0
      || payloadBytes > MAX_CANONICAL_PAYLOAD_BYTES) {
      throw new Error('Google Cloud KMS signing payload is invalid')
    }
    let data: Buffer
    try {
      data = Buffer.from(requestSnapshot.canonicalPayload)
    } catch {
      throw new Error('Google Cloud KMS signing payload is invalid')
    }
    const rpcData = Buffer.from(data)
    let raw: unknown
    try {
      ;[raw] = await clientSnapshot.asymmetricSign({
        name,
        data: rpcData,
        dataCrc32c: Object.freeze({ value: crc32c.calculate(rpcData) })
      })
    } catch {
      throw new Error('Google Cloud KMS signing failed')
    }
    if (abortSignalIsAborted(requestSnapshot.signal)) {
      throw new Error('Google Cloud KMS signing aborted')
    }
    let responseSnapshot: Record<
      'name' | 'verifiedDataCrc32c' | 'protectionLevel' | 'signature' | 'signatureCrc32c',
      unknown
    >
    try {
      const response = record(raw, 'sign response')
      responseSnapshot = {
        name: response.name,
        verifiedDataCrc32c: response.verifiedDataCrc32c,
        protectionLevel: response.protectionLevel,
        signature: response.signature,
        signatureCrc32c: response.signatureCrc32c
      }
    } catch {
      throw new Error('Google Cloud KMS sign response is invalid')
    }
    if (responseSnapshot.name !== name || responseSnapshot.verifiedDataCrc32c !== true
      || !isEnum(responseSnapshot.protectionLevel, 'HSM', 2)) {
      throw new Error('Google Cloud KMS sign response posture is invalid')
    }
    const signature = copyExactSignature(responseSnapshot.signature)
    let checksum: number
    try {
      checksum = uint32(
        record(responseSnapshot.signatureCrc32c, 'signature checksum').value,
        'signature checksum'
      )
    } catch {
      throw new Error('Google Cloud KMS signature checksum is invalid')
    }
    if (checksum !== crc32c.calculate(signature)) {
      throw new Error('Google Cloud KMS signature integrity is invalid')
    }
    if (!cryptoVerify(null, data, clientSnapshot.publicKey, signature)) {
      throw new Error('Google Cloud KMS signature is invalid')
    }
    return new Uint8Array(signature)
  }
  return Object.freeze({ keyId: clientSnapshot.keyId, opaqueKeyHandleId, sign })
}
