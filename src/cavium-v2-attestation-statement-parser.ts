const RESPONSE_HEADER_BYTES = 16
const GENERATE_KEY_PAIR_RESPONSE_BYTES = 32
const INFO_HEADER_BYTES = 8
const OBJECT_HEADER_BYTES = 12
const TLV_HEADER_BYTES = 8
const RSA_SIGNATURE_BYTES = 256
const MAX_STATEMENT_BYTES = 256 * 1024
const MAX_ATTRIBUTES_PER_OBJECT = 64

const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype), 'byteLength'
)?.get
const typedArrayBuffer = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype), 'buffer'
)?.get

const ATTR = {
  CLASS: 0x0000, TOKEN: 0x0001, PRIVATE: 0x0002, LABEL: 0x0003,
  TRUSTED: 0x0086, KEY_TYPE: 0x0100, ID: 0x0102, SENSITIVE: 0x0103,
  ENCRYPT: 0x0104, DECRYPT: 0x0105, WRAP: 0x0106, UNWRAP: 0x0107,
  SIGN: 0x0108, VERIFY: 0x010a, DERIVE: 0x010c, MODULUS: 0x0120,
  MODULUS_BITS: 0x0121, PUBLIC_EXPONENT: 0x0122, VALUE_LEN: 0x0161,
  EXTRACTABLE: 0x0162, LOCAL: 0x0163, NEVER_EXTRACTABLE: 0x0164,
  ALWAYS_SENSITIVE: 0x0165, KCV: 0x0173, EC_PARAMS: 0x0180,
  EC_POINT: 0x0181, WRAP_WITH_TRUSTED: 0x0210, EXT_ATTR1: 0x1000,
  EKCV: 0x1003, ALLOWED_MECHANISMS: 0x80000000, SPLITTABLE: 0x80000002,
  IS_SPLIT: 0x80000003, ENCRYPT_MECHANISMS: 0x80000174,
  DECRYPT_MECHANISMS: 0x80000175, SIGN_MECHANISMS: 0x80000176,
  VERIFY_MECHANISMS: 0x80000177, WRAP_MECHANISMS: 0x80000178,
  UNWRAP_MECHANISMS: 0x80000179, DERIVE_MECHANISMS: 0x80000180
} as const

const KNOWN_ATTRIBUTES = new Set<number>(Object.values(ATTR))
const BOOLEAN_ATTRIBUTES = new Set<number>([
  ATTR.TOKEN, ATTR.PRIVATE, ATTR.TRUSTED, ATTR.SENSITIVE, ATTR.ENCRYPT,
  ATTR.DECRYPT, ATTR.WRAP, ATTR.UNWRAP, ATTR.SIGN, ATTR.VERIFY, ATTR.DERIVE,
  ATTR.EXTRACTABLE, ATTR.LOCAL, ATTR.NEVER_EXTRACTABLE, ATTR.ALWAYS_SENSITIVE,
  ATTR.WRAP_WITH_TRUSTED, ATTR.SPLITTABLE, ATTR.IS_SPLIT
])
const parsedStatements = new WeakSet<object>()

export interface CaviumV2AttestedObject {
  readonly role: 'PUBLIC_KEY' | 'PRIVATE_KEY'
  readonly handle: number
  readonly attributes: Readonly<Record<string, string>>
}

export interface CaviumV2AttestationStatement {
  readonly schemaVersion: 1
  readonly statementParsed: true
  readonly responseCode: 0
  readonly responseFlags: number
  readonly objectVersion: 1
  readonly requestFlags: number
  readonly objectKind: 'ASYMMETRIC_KEY_PAIR'
  readonly objects: readonly CaviumV2AttestedObject[]
}

export interface CaviumV2GeneratedEd25519AttributesVerification {
  readonly schemaVersion: 1
  readonly attestationStatementParsed: true
  readonly attestationSignatureVerified: false
  readonly attestationAttributesMatchedExpectedPolicy: true
  readonly keyType: 'CKK_EC_EDWARDS'
  readonly keyAlgorithm: 'Ed25519'
  readonly keyLocalAttributeMatched: true
  readonly keyNonExtractableAttributeMatched: true
  readonly privateKeySensitiveAttributeMatched: true
  readonly keyCreatedInsideHsmVerified: false
  readonly keyNonExtractableVerified: false
  readonly keyIdHex: string
  readonly resourceBindingVerified: false
  readonly publicKeyBindingVerified: false
  readonly custodyEstablished: false
}

function key(type: number): string {
  return `0x${type.toString(16).padStart(4, '0')}`
}

function readU16(bytes: Buffer, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.byteLength) throw new Error()
  return bytes.readUInt16BE(offset)
}

function readU32(bytes: Buffer, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new Error()
  return bytes.readUInt32BE(offset)
}

function parseObject(
  buffer: Buffer,
  start: number,
  end: number,
  role: CaviumV2AttestedObject['role']
): CaviumV2AttestedObject {
  if (start < INFO_HEADER_BYTES || end > buffer.byteLength
    || end - start < OBJECT_HEADER_BYTES) throw new Error()
  const handle = readU32(buffer, start)
  const count = readU32(buffer, start + 4)
  const objectSize = readU32(buffer, start + 8)
  if (count < 1 || count > MAX_ATTRIBUTES_PER_OBJECT || objectSize !== end - start) throw new Error()

  let cursor = start + OBJECT_HEADER_BYTES
  const attributes: Record<string, string> = Object.create(null) as Record<string, string>
  for (let index = 0; index < count; index += 1) {
    if (cursor + TLV_HEADER_BYTES > end) throw new Error()
    const type = readU32(buffer, cursor)
    const length = readU32(buffer, cursor + 4)
    cursor += TLV_HEADER_BYTES
    if (!KNOWN_ATTRIBUTES.has(type) || length < 1 || length > end - cursor) throw new Error()
    const attributeKey = key(type)
    if (Object.hasOwn(attributes, attributeKey)) throw new Error()
    const value = buffer.subarray(cursor, cursor + length)
    if (BOOLEAN_ATTRIBUTES.has(type)
      && (length !== 1 || (value[0] !== 0 && value[0] !== 1))) throw new Error()
    attributes[attributeKey] = value.toString('hex')
    cursor += length
  }
  if (cursor !== end) throw new Error()
  return Object.freeze({ role, handle, attributes: Object.freeze(attributes) })
}

export function parseCaviumV2AttestationStatement(
  input: Uint8Array
): Readonly<CaviumV2AttestationStatement> {
  try {
    const length = typedArrayByteLength?.call(input) as number
    const backing = typedArrayBuffer?.call(input)
    if (!(backing instanceof ArrayBuffer) || !Number.isSafeInteger(length)
      || length < RESPONSE_HEADER_BYTES + INFO_HEADER_BYTES + OBJECT_HEADER_BYTES
      || length > MAX_STATEMENT_BYTES) throw new Error()
    const bytes = Buffer.from(input)
    if (bytes.byteLength !== length) throw new Error()

    const responseCode = readU32(bytes, 0)
    const responseFlags = readU32(bytes, 4)
    const totalSize = readU32(bytes, 8)
    const bufferSize = readU32(bytes, 12)
    if (responseCode !== 0 || totalSize !== length + RSA_SIGNATURE_BYTES
      || bufferSize < INFO_HEADER_BYTES + OBJECT_HEADER_BYTES
      || bufferSize > length - RESPONSE_HEADER_BYTES) throw new Error()
    const attributeOffset = totalSize - bufferSize - RSA_SIGNATURE_BYTES
    if (attributeOffset !== GENERATE_KEY_PAIR_RESPONSE_BYTES
      || attributeOffset !== length - bufferSize) throw new Error()
    const buffer = bytes.subarray(attributeOffset)

    const objectVersion = readU16(buffer, 0)
    const requestFlags = readU16(buffer, 2)
    const offset1 = readU16(buffer, 4)
    const offset2 = readU16(buffer, 6)
    if (objectVersion !== 1 || requestFlags !== responseFlags || offset1 !== INFO_HEADER_BYTES
      || offset1 >= buffer.byteLength || offset2 <= offset1 || offset2 >= buffer.byteLength) throw new Error()

    const objects = [
      parseObject(buffer, offset1, offset2, 'PUBLIC_KEY'),
      parseObject(buffer, offset2, buffer.byteLength, 'PRIVATE_KEY')
    ]
    const result = Object.freeze({
      schemaVersion: 1 as const,
      statementParsed: true as const,
      responseCode: 0 as const,
      responseFlags,
      objectVersion: 1 as const,
      requestFlags,
      objectKind: 'ASYMMETRIC_KEY_PAIR' as const,
      objects: Object.freeze(objects)
    })
    parsedStatements.add(result)
    return result
  } catch {
    throw new Error('Cavium V2 attestation statement parsing failed')
  }
}

function requireAttribute(object: CaviumV2AttestedObject, type: number, expected?: string): string {
  const value = object.attributes[key(type)]
  if (typeof value !== 'string' || (expected !== undefined && value !== expected)) throw new Error()
  return value
}

export function verifyCaviumV2GeneratedEd25519Attributes(
  statement: Readonly<CaviumV2AttestationStatement>
): Readonly<CaviumV2GeneratedEd25519AttributesVerification> {
  try {
    if (!statement || typeof statement !== 'object' || !parsedStatements.has(statement)
      || statement.objectKind !== 'ASYMMETRIC_KEY_PAIR' || statement.objects.length !== 2) throw new Error()
    const [publicKey, privateKey] = statement.objects
    if (!publicKey || !privateKey || publicKey.role !== 'PUBLIC_KEY'
      || privateKey.role !== 'PRIVATE_KEY') throw new Error()

    requireAttribute(publicKey, ATTR.CLASS, '02')
    requireAttribute(privateKey, ATTR.CLASS, '03')
    for (const object of [publicKey, privateKey]) {
      requireAttribute(object, ATTR.TOKEN, '01')
      requireAttribute(object, ATTR.KEY_TYPE, '40')
      requireAttribute(object, ATTR.LOCAL, '01')
      requireAttribute(object, ATTR.EC_PARAMS, '06032b6570')
    }
    requireAttribute(publicKey, ATTR.PRIVATE, '00')
    requireAttribute(publicKey, ATTR.VERIFY, '01')
    const publicPoint = requireAttribute(publicKey, ATTR.EC_POINT)
    if (!/^0420[a-f0-9]{64}$/.test(publicPoint)) throw new Error()

    requireAttribute(privateKey, ATTR.PRIVATE, '01')
    requireAttribute(privateKey, ATTR.SIGN, '01')
    requireAttribute(privateKey, ATTR.SENSITIVE, '01')
    requireAttribute(privateKey, ATTR.EXTRACTABLE, '00')
    requireAttribute(privateKey, ATTR.NEVER_EXTRACTABLE, '01')
    requireAttribute(privateKey, ATTR.ALWAYS_SENSITIVE, '01')
    const publicId = requireAttribute(publicKey, ATTR.ID)
    const privateId = requireAttribute(privateKey, ATTR.ID)
    if (privateId !== publicId) throw new Error()
    const keyIdBytes = Buffer.from(publicId, 'hex')
    if (keyIdBytes.byteLength !== 128
      || !keyIdBytes.every(byte => (byte >= 0x30 && byte <= 0x39)
        || (byte >= 0x61 && byte <= 0x66))) throw new Error()
    const keyIdHex = keyIdBytes.toString('latin1')

    return Object.freeze({
      schemaVersion: 1,
      attestationStatementParsed: true,
      attestationSignatureVerified: false,
      attestationAttributesMatchedExpectedPolicy: true,
      keyType: 'CKK_EC_EDWARDS',
      keyAlgorithm: 'Ed25519',
      keyLocalAttributeMatched: true,
      keyNonExtractableAttributeMatched: true,
      privateKeySensitiveAttributeMatched: true,
      keyCreatedInsideHsmVerified: false,
      keyNonExtractableVerified: false,
      keyIdHex,
      resourceBindingVerified: false,
      publicKeyBindingVerified: false,
      custodyEstablished: false
    })
  } catch {
    throw new Error('Cavium V2 generated Ed25519 attribute verification failed')
  }
}
