import { createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto'
import { KeyManagementServiceClient } from '@google-cloud/kms'
import crc32c from 'fast-crc32c'

const RESOURCE = /^projects\/[a-z][a-z0-9-]{4,62}\/locations\/[a-z0-9-]{1,63}\/keyRings\/[a-zA-Z0-9_-]{1,63}\/cryptoKeys\/[a-zA-Z0-9_-]{1,63}\/cryptoKeyVersions\/[1-9][0-9]{0,18}$/
const SHA256 = /^[a-f0-9]{64}$/
const MAX_CANONICAL_PAYLOAD_BYTES = 256 * 1024
const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  'byteLength'
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
}

export interface GoogleCloudKmsAttestationInput {
  readonly client: GoogleCloudKmsClientPort
  readonly cryptoKeyVersionName: string
  readonly expectedKeyId: string
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
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.getPrototypeOf(input) !== Object.prototype
    || Reflect.ownKeys(input).length !== 1
    || !Object.prototype.hasOwnProperty.call(input, 'rpcTimeoutMs')) {
    throw new Error('Google Cloud KMS ADC client options are invalid')
  }
  const rpcTimeoutMs = input.rpcTimeoutMs
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
  if (typeof input === 'number' && Number.isSafeInteger(input)
    && input >= 0 && input <= 0xffff_ffff) return input
  if (typeof input === 'string' && /^(0|[1-9][0-9]{0,9})$/.test(input)) {
    const parsed = Number(input)
    if (parsed <= 0xffff_ffff) return parsed
  }
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const value = input as Record<string, unknown>
    if (Number.isInteger(value.low) && value.high === 0) {
      return (value.low as number) >>> 0
    }
  }
  throw new Error(`Google Cloud KMS ${label} is invalid`)
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

export async function attestGoogleCloudKmsHsmEd25519Key(
  input: GoogleCloudKmsAttestationInput
): Promise<Readonly<GoogleCloudKmsHsmEd25519Attestation>> {
  if (!input || typeof input !== 'object') {
    throw new Error('Google Cloud KMS attestation input is invalid')
  }
  const inputSnapshot = {
    client: input.client,
    cryptoKeyVersionName: input.cryptoKeyVersionName,
    expectedKeyId: input.expectedKeyId
  }
  if (!inputSnapshot.client) throw new Error('Google Cloud KMS attestation input is invalid')
  const getCryptoKeyVersion = inputSnapshot.client.getCryptoKeyVersion.bind(inputSnapshot.client)
  const getPublicKey = inputSnapshot.client.getPublicKey.bind(inputSnapshot.client)
  const asymmetricSign = inputSnapshot.client.asymmetricSign.bind(inputSnapshot.client)
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
  const version = record(versionRaw, 'key version')
  if (version.name !== name || !isEnum(version.state, 'ENABLED', 1)
    || !isEnum(version.algorithm, 'EC_SIGN_ED25519', 40)
    || !isEnum(version.protectionLevel, 'HSM', 2)) {
    throw new Error('Google Cloud KMS key version posture is invalid')
  }

  let publicRaw: unknown
  try {
    ;[publicRaw] = await getPublicKey({ name })
  } catch {
    throw new Error('Google Cloud KMS attestation failed')
  }
  const publicKey = record(publicRaw, 'public key')
  const publicKeySnapshot = {
    name: publicKey.name,
    pem: publicKey.pem,
    algorithm: publicKey.algorithm,
    protectionLevel: publicKey.protectionLevel,
    pemCrc32c: publicKey.pemCrc32c
  }
  if (publicKeySnapshot.name !== name || typeof publicKeySnapshot.pem !== 'string'
    || !isEnum(publicKeySnapshot.algorithm, 'EC_SIGN_ED25519', 40)
    || !isEnum(publicKeySnapshot.protectionLevel, 'HSM', 2)) {
    throw new Error('Google Cloud KMS public key response is invalid')
  }
  const pemChecksum = uint32(
    record(publicKeySnapshot.pemCrc32c, 'public key checksum').value,
    'public key checksum'
  )
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
    custodyEstablished: false
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
  const inputSnapshot = { client: input.client, attestation: input.attestation }
  if (!inputSnapshot.client || !inputSnapshot.attestation) {
    throw new Error('Google Cloud KMS signer binding input is invalid')
  }
  const clientSnapshot = attestedClients.get(inputSnapshot.attestation)
  if (!clientSnapshot) throw new Error('Google Cloud KMS attestation is invalid')
  if (clientSnapshot.client !== inputSnapshot.client) throw new Error('Google Cloud KMS client mismatch')
  const name = clientSnapshot.cryptoKeyVersionName
  const opaqueKeyHandleId = `gcp-kms-hsm:${createHash('sha256').update(name).digest('hex').slice(0, 32)}`
  const sign: GoogleCloudKmsOpaqueSignCallback = async request => {
    const requestSnapshot = {
      opaqueKeyHandleId: request.opaqueKeyHandleId,
      signal: request.signal,
      canonicalPayload: request.canonicalPayload
    }
    if (requestSnapshot.opaqueKeyHandleId !== opaqueKeyHandleId || requestSnapshot.signal.aborted) {
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
    const data = Buffer.from(requestSnapshot.canonicalPayload)
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
    if (requestSnapshot.signal.aborted) throw new Error('Google Cloud KMS signing aborted')
    const response = record(raw, 'sign response')
    const responseSnapshot = {
      name: response.name,
      verifiedDataCrc32c: response.verifiedDataCrc32c,
      protectionLevel: response.protectionLevel,
      signature: response.signature,
      signatureCrc32c: response.signatureCrc32c
    }
    if (responseSnapshot.name !== name || responseSnapshot.verifiedDataCrc32c !== true
      || !isEnum(responseSnapshot.protectionLevel, 'HSM', 2)) {
      throw new Error('Google Cloud KMS sign response posture is invalid')
    }
    const signature = copyExactSignature(responseSnapshot.signature)
    const checksum = uint32(
      record(responseSnapshot.signatureCrc32c, 'signature checksum').value,
      'signature checksum'
    )
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
