import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseCaviumV2AttestationStatement,
  verifyCaviumV2GeneratedEd25519Attributes
} from '../src/cavium-v2-attestation-statement-parser.js'

const ATTR = {
  CLASS: 0x0000,
  TOKEN: 0x0001,
  PRIVATE: 0x0002,
  KEY_TYPE: 0x0100,
  ID: 0x0102,
  SENSITIVE: 0x0103,
  SIGN: 0x0108,
  VERIFY: 0x010a,
  EXTRACTABLE: 0x0162,
  LOCAL: 0x0163,
  NEVER_EXTRACTABLE: 0x0164,
  ALWAYS_SENSITIVE: 0x0165,
  EC_PARAMS: 0x0180,
  EC_POINT: 0x0181
} as const

type Attribute = readonly [type: number, value: Buffer]

function u16(value: number): Buffer {
  const output = Buffer.alloc(2)
  output.writeUInt16BE(value)
  return output
}

function u32(value: number): Buffer {
  const output = Buffer.alloc(4)
  output.writeUInt32BE(value)
  return output
}

function tlv([type, value]: Attribute): Buffer {
  return Buffer.concat([u32(type), u32(value.byteLength), value])
}

function object(handle: number, attributes: readonly Attribute[]): Buffer {
  const body = Buffer.concat(attributes.map(tlv))
  return Buffer.concat([u32(handle), u32(attributes.length), u32(12 + body.byteLength), body])
}

const keyId = Buffer.from(`${'11'.repeat(32)}${'22'.repeat(32)}`, 'ascii')

function publicAttributes(): Attribute[] {
  return [
    [ATTR.CLASS, Buffer.of(0x02)],
    [ATTR.TOKEN, Buffer.of(0x01)],
    [ATTR.PRIVATE, Buffer.of(0x00)],
    [ATTR.KEY_TYPE, Buffer.of(0x40)],
    [ATTR.ID, keyId],
    [ATTR.SENSITIVE, Buffer.of(0x00)],
    [ATTR.VERIFY, Buffer.of(0x01)],
    [ATTR.LOCAL, Buffer.of(0x01)],
    [ATTR.EC_PARAMS, Buffer.from('06032b6570', 'hex')],
    [ATTR.EC_POINT, Buffer.alloc(32, 0x33)]
  ]
}

function privateAttributes(): Attribute[] {
  return [
    [ATTR.CLASS, Buffer.of(0x03)],
    [ATTR.TOKEN, Buffer.of(0x01)],
    [ATTR.PRIVATE, Buffer.of(0x01)],
    [ATTR.KEY_TYPE, Buffer.of(0x40)],
    [ATTR.ID, keyId],
    [ATTR.SENSITIVE, Buffer.of(0x01)],
    [ATTR.SIGN, Buffer.of(0x01)],
    [ATTR.EXTRACTABLE, Buffer.of(0x00)],
    [ATTR.LOCAL, Buffer.of(0x01)],
    [ATTR.NEVER_EXTRACTABLE, Buffer.of(0x01)],
    [ATTR.ALWAYS_SENSITIVE, Buffer.of(0x01)],
    [ATTR.EC_PARAMS, Buffer.from('06032b6570', 'hex')]
  ]
}

function statement(options: Readonly<{
  publicAttributes?: readonly Attribute[]
  privateAttributes?: readonly Attribute[]
  betweenObjects?: Uint8Array
  afterObjects?: Uint8Array
}> = {}): Buffer {
  const publicObject = object(7, options.publicAttributes ?? publicAttributes())
  const privateObject = object(8, options.privateAttributes ?? privateAttributes())
  const betweenObjects = Buffer.from(options.betweenObjects ?? [])
  const afterObjects = Buffer.from(options.afterObjects ?? [])
  const info = Buffer.concat([
    u16(1),
    u16(3),
    u16(8),
    u16(8 + publicObject.byteLength + betweenObjects.byteLength)
  ])
  const attributeBuffer = Buffer.concat([
    info,
    publicObject,
    betweenObjects,
    privateObject,
    afterObjects
  ])
  const responseSpecificHeader = Buffer.alloc(16)
  const statementLength = 16 + responseSpecificHeader.byteLength + attributeBuffer.byteLength
  const responseHeader = Buffer.concat([
    u32(0),
    u32(3),
    u32(statementLength + 256),
    u32(attributeBuffer.byteLength)
  ])
  return Buffer.concat([responseHeader, responseSpecificHeader, attributeBuffer])
}

function rejectsStatement(input: Uint8Array): void {
  assert.throws(
    () => parseCaviumV2AttestationStatement(input),
    /^Error: Cavium V2 attestation statement parsing failed$/
  )
}

test('D4c-a parse strict Cavium V2 asymmetric key-pair TLV và verify generated Ed25519 policy', () => {
  const parsed = parseCaviumV2AttestationStatement(statement())
  assert.equal(parsed.schemaVersion, 1)
  assert.equal(parsed.statementParsed, true)
  assert.equal(parsed.objectVersion, 1)
  assert.equal(parsed.requestFlags, 3)
  assert.equal(parsed.objectKind, 'ASYMMETRIC_KEY_PAIR')
  assert.deepEqual(parsed.objects.map(entry => entry.role), ['PUBLIC_KEY', 'PRIVATE_KEY'])
  assert.equal(parsed.objects[0]?.attributes['0x0100'], '40')
  assert.equal(parsed.objects[1]?.attributes['0x0162'], '00')
  assert.equal(Object.isFrozen(parsed), true)
  assert.equal(Object.isFrozen(parsed.objects), true)
  assert.equal(Object.isFrozen(parsed.objects[0]?.attributes), true)

  const verified = verifyCaviumV2GeneratedEd25519Attributes(parsed)
  assert.equal(verified.schemaVersion, 1)
  assert.equal(verified.attestationStatementParsed, true)
  assert.equal(verified.attestationSignatureVerified, false)
  assert.equal(verified.attestationAttributesMatchedExpectedPolicy, true)
  assert.equal(verified.keyType, 'CKK_EC_EDWARDS')
  assert.equal(verified.keyLocalAttributeMatched, true)
  assert.equal(verified.keyNonExtractableAttributeMatched, true)
  assert.equal(verified.privateKeySensitiveAttributeMatched, true)
  assert.equal(verified.keyCreatedInsideHsmVerified, false)
  assert.equal(verified.keyNonExtractableVerified, false)
  assert.equal(verified.resourceBindingVerified, false)
  assert.equal(verified.publicKeyBindingVerified, false)
  assert.equal(verified.custodyEstablished, false)
  assert.equal(verified.keyIdHex, keyId.toString('ascii'))
  assert.equal(Object.isFrozen(verified), true)
})

test('D4c-a reject duplicate, unknown, truncated và non-canonical trailing TLV bytes', () => {
  rejectsStatement(statement({
    publicAttributes: [...publicAttributes(), [ATTR.CLASS, Buffer.of(0x02)]]
  }))
  rejectsStatement(statement({
    publicAttributes: [...publicAttributes(), [0x9999, Buffer.of(0)]]
  }))
  rejectsStatement(statement({ betweenObjects: Buffer.of(0) }))
  rejectsStatement(statement({ afterObjects: Buffer.of(0) }))

  const truncated = statement()
  const attributeOffset = truncated.byteLength - truncated.readUInt32BE(12)
  const firstObjectOffset = attributeOffset + truncated.readUInt16BE(attributeOffset + 4)
  const firstTlvLengthOffset = firstObjectOffset + 12 + 4
  truncated.writeUInt32BE(0x7fffffff, firstTlvLengthOffset)
  rejectsStatement(truncated)
})

test('D4c-a reject inconsistent total/buffer size, offsets, bool encoding và object size', () => {
  for (const mutate of [
    (bytes: Buffer) => bytes.writeUInt32BE(bytes.readUInt32BE(8) + 1, 8),
    (bytes: Buffer) => bytes.writeUInt32BE(bytes.readUInt32BE(12) + 1, 12),
    (bytes: Buffer) => {
      const info = bytes.byteLength - bytes.readUInt32BE(12)
      bytes.writeUInt16BE(7, info + 6)
    },
    (bytes: Buffer) => {
      const info = bytes.byteLength - bytes.readUInt32BE(12)
      const firstObject = info + bytes.readUInt16BE(info + 4)
      bytes.writeUInt32BE(bytes.readUInt32BE(firstObject + 8) + 1, firstObject + 8)
    }
  ]) {
    const input = statement()
    mutate(input)
    rejectsStatement(input)
  }

  rejectsStatement(statement({
    privateAttributes: privateAttributes().map(attribute =>
      attribute[0] === ATTR.LOCAL ? [ATTR.LOCAL, Buffer.of(0x02)] : attribute)
  }))
})

test('D4c-a reject non-canonical GenerateKeyPair response header length', () => {
  const source = statement()
  const attributeOffset = source.byteLength - source.readUInt32BE(12)
  const shifted = Buffer.concat([
    source.subarray(0, attributeOffset),
    Buffer.of(0),
    source.subarray(attributeOffset)
  ])
  shifted.writeUInt32BE(shifted.readUInt32BE(8) + 1, 8)
  rejectsStatement(shifted)
})

test('D4c-a policy fail closed khi key imported, extractable, sai type hoặc thiếu sensitive', () => {
  const cases: Attribute[][] = [
    privateAttributes().map(attribute => attribute[0] === ATTR.LOCAL
      ? [ATTR.LOCAL, Buffer.of(0)] : attribute),
    privateAttributes().map(attribute => attribute[0] === ATTR.EXTRACTABLE
      ? [ATTR.EXTRACTABLE, Buffer.of(1)] : attribute),
    privateAttributes().map(attribute => attribute[0] === ATTR.KEY_TYPE
      ? [ATTR.KEY_TYPE, Buffer.of(0x03)] : attribute),
    privateAttributes().filter(attribute => attribute[0] !== ATTR.SENSITIVE)
  ]
  for (const attributes of cases) {
    const parsed = parseCaviumV2AttestationStatement(statement({ privateAttributes: attributes }))
    assert.throws(
      () => verifyCaviumV2GeneratedEd25519Attributes(parsed),
      /^Error: Cavium V2 generated Ed25519 attribute verification failed$/
    )
  }
})

test('D4c-a policy reject malformed hoặc high-bit-aliased hex key ID', () => {
  for (const id of [
    Buffer.alloc(64, 0x11),
    Buffer.from('g'.repeat(128), 'ascii'),
    Buffer.concat([Buffer.alloc(64, 0xb1), Buffer.alloc(64, 0xb2)])
  ]) {
    const parsed = parseCaviumV2AttestationStatement(statement({
      publicAttributes: publicAttributes().map(attribute => attribute[0] === ATTR.ID
        ? [ATTR.ID, id] : attribute),
      privateAttributes: privateAttributes().map(attribute => attribute[0] === ATTR.ID
        ? [ATTR.ID, id] : attribute)
    }))
    assert.throws(() => verifyCaviumV2GeneratedEd25519Attributes(parsed))
  }
})

test('D4c-a policy reject missing hoặc malformed Ed25519 public-point shape', () => {
  for (const attributes of [
    publicAttributes().filter(attribute => attribute[0] !== ATTR.EC_POINT),
    publicAttributes().map(attribute => attribute[0] === ATTR.EC_POINT
      ? [ATTR.EC_POINT, Buffer.concat([Buffer.of(0x04, 0x20), Buffer.alloc(32, 0x33)])] as Attribute
      : attribute)
  ]) {
    const parsed = parseCaviumV2AttestationStatement(statement({ publicAttributes: attributes }))
    assert.throws(() => verifyCaviumV2GeneratedEd25519Attributes(parsed))
  }
})

test('D4c-a reject SharedArrayBuffer và sanitize hostile getter', () => {
  const source = statement()
  const shared = new Uint8Array(new SharedArrayBuffer(source.byteLength))
  shared.set(source)
  rejectsStatement(shared)

  assert.throws(
    () => verifyCaviumV2GeneratedEd25519Attributes({
      get schemaVersion() { throw new Error('private_key=getter-sensitive-marker') }
    } as never),
    (error: unknown) => error instanceof Error
      && error.message === 'Cavium V2 generated Ed25519 attribute verification failed'
      && !error.message.includes('getter-sensitive-marker')
  )
})
