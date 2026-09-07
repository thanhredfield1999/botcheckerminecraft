import { types } from 'node:util'
import {
  canonicalPaperBukkitOnlinePlayerPayloadV1,
  PAPER_BUKKIT_ONLINE_PLAYER_DOMAIN,
  PAPER_BUKKIT_ONLINE_PLAYER_PROFILE,
  parsePaperBukkitOnlinePlayerChallengeV1,
  parsePaperBukkitOnlinePlayerPayloadV1,
  type PaperBukkitOnlinePlayerChallengeV1,
  type PaperBukkitOnlinePlayerPayloadV1
} from './paper-bukkit-online-player-claim.js'

export type { PaperBukkitOnlinePlayerChallengeV1 } from './paper-bukkit-online-player-claim.js'

const VERSION = 1
const REQUEST_MAGIC = Buffer.from('BCPQ', 'ascii')
const RESPONSE_MAGIC = Buffer.from('BCPR', 'ascii')
const REQUEST_HEADER_BYTES = 9
const RESPONSE_HEADER_BYTES = 11
const MAX_CHALLENGE_BYTES = 4 * 1024
const MAX_PAYLOAD_BYTES = 16 * 1024
const SIGNATURE_BYTES = 64
const MAX_REQUEST_FRAME_BYTES = REQUEST_HEADER_BYTES + MAX_CHALLENGE_BYTES
const MAX_RESPONSE_FRAME_BYTES = RESPONSE_HEADER_BYTES + MAX_PAYLOAD_BYTES + SIGNATURE_BYTES
const utf8 = new TextDecoder('utf-8', { fatal: true })

export type PaperBukkitOnlinePlayerEnvelopeV1 = Readonly<PaperBukkitOnlinePlayerPayloadV1 & {
  readonly signatureBase64Url: string
}>

function ownedBytes(input: Uint8Array, maxBytes: number): Buffer {
  if (!(input instanceof Uint8Array) || types.isProxy(input)) throw new Error()
  const backing = input.buffer
  if (!(backing instanceof ArrayBuffer)) throw new Error()
  const length = input.byteLength
  if (!Number.isSafeInteger(length) || length <= 0 || length > maxBytes) throw new Error()
  const owned = Buffer.from(input)
  if (owned.byteLength !== length) throw new Error()
  return owned
}

function exactMagic(bytes: Buffer, expected: Buffer): boolean {
  return bytes.subarray(0, expected.byteLength).equals(expected)
}

function encodedString(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.byteLength <= 0 || bytes.byteLength > 512) throw new Error()
  const encoded = Buffer.allocUnsafe(2 + bytes.byteLength)
  encoded.writeUInt16BE(bytes.byteLength, 0)
  bytes.copy(encoded, 2)
  return encoded
}

function encodedSafeInteger(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error()
  const encoded = Buffer.allocUnsafe(8)
  encoded.writeBigUInt64BE(BigInt(value), 0)
  return encoded
}

function canonicalRequestBody(challenge: PaperBukkitOnlinePlayerChallengeV1): Buffer {
  const fields = [
    encodedString(challenge.audience),
    encodedString(challenge.verifierInstanceId),
    encodedSafeInteger(challenge.sequence),
    encodedString(challenge.challengeId),
    encodedString(challenge.nonceBase64Url),
    encodedString(challenge.runId),
    encodedString(challenge.keyId),
    encodedString(challenge.bindingId),
    encodedString(challenge.targetBindingSha256),
    encodedString(challenge.provider.id),
    encodedString(challenge.provider.version),
    encodedString(challenge.provider.instanceId ?? '-'),
    encodedString(challenge.trustStoreId),
    encodedString(challenge.trustStoreVersion),
    encodedString(challenge.trustStoreSha256),
    encodedSafeInteger(challenge.issuedAtMs),
    encodedSafeInteger(challenge.expiresAtMs)
  ]
  const body = Buffer.concat(fields)
  if (body.byteLength <= 0 || body.byteLength > MAX_CHALLENGE_BYTES) throw new Error()
  return body
}

class RequestBodyReader {
  private offset = 0

  constructor(private readonly body: Buffer) {
  }

  string(): string {
    if (this.offset + 2 > this.body.byteLength) throw new Error()
    const length = this.body.readUInt16BE(this.offset)
    this.offset += 2
    if (length <= 0 || length > 512 || this.offset + length > this.body.byteLength) throw new Error()
    const value = utf8.decode(this.body.subarray(this.offset, this.offset + length))
    this.offset += length
    return value
  }

  safeInteger(): number {
    if (this.offset + 8 > this.body.byteLength) throw new Error()
    const value = this.body.readBigUInt64BE(this.offset)
    this.offset += 8
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error()
    return Number(value)
  }

  done(): boolean {
    return this.offset === this.body.byteLength
  }
}

export function encodePaperBukkitOnlinePlayerRequestFrameV1(input: unknown): Buffer {
  try {
    const challenge = parsePaperBukkitOnlinePlayerChallengeV1(input)
    const body = canonicalRequestBody(challenge)
    const frame = Buffer.allocUnsafe(REQUEST_HEADER_BYTES + body.byteLength)
    REQUEST_MAGIC.copy(frame, 0)
    frame.writeUInt8(VERSION, 4)
    frame.writeUInt32BE(body.byteLength, 5)
    body.copy(frame, REQUEST_HEADER_BYTES)
    return frame
  } catch {
    throw new Error('Paper Bukkit request frame is invalid')
  }
}

export function decodePaperBukkitOnlinePlayerRequestFrameV1(
  input: Uint8Array
): PaperBukkitOnlinePlayerChallengeV1 {
  try {
    const frame = ownedBytes(input, MAX_REQUEST_FRAME_BYTES)
    if (frame.byteLength < REQUEST_HEADER_BYTES || !exactMagic(frame, REQUEST_MAGIC)
      || frame.readUInt8(4) !== VERSION) throw new Error()
    const bodyLength = frame.readUInt32BE(5)
    if (bodyLength <= 0 || bodyLength > MAX_CHALLENGE_BYTES
      || frame.byteLength !== REQUEST_HEADER_BYTES + bodyLength) throw new Error()
    const body = frame.subarray(REQUEST_HEADER_BYTES)
    const reader = new RequestBodyReader(body)
    const audience = reader.string()
    const verifierInstanceId = reader.string()
    const sequence = reader.safeInteger()
    const challengeId = reader.string()
    const nonceBase64Url = reader.string()
    const runId = reader.string()
    const keyId = reader.string()
    const bindingId = reader.string()
    const targetBindingSha256 = reader.string()
    const providerId = reader.string()
    const providerVersion = reader.string()
    const providerInstanceId = reader.string()
    const trustStoreId = reader.string()
    const trustStoreVersion = reader.string()
    const trustStoreSha256 = reader.string()
    const issuedAtMs = reader.safeInteger()
    const expiresAtMs = reader.safeInteger()
    if (!reader.done()) throw new Error()
    const challenge = parsePaperBukkitOnlinePlayerChallengeV1({
      schemaVersion: 1,
      domain: PAPER_BUKKIT_ONLINE_PLAYER_DOMAIN,
      profile: PAPER_BUKKIT_ONLINE_PLAYER_PROFILE,
      audience,
      verifierInstanceId,
      sequence,
      challengeId,
      nonceBase64Url,
      runId,
      keyId,
      bindingId,
      targetBindingSha256,
      provider: {
        kind: 'server-probe',
        id: providerId,
        version: providerVersion,
        ...(providerInstanceId === '-' ? {} : { instanceId: providerInstanceId })
      },
      trustStoreId,
      trustStoreVersion,
      trustStoreSha256,
      issuedAtMs,
      expiresAtMs
    })
    if (!body.equals(canonicalRequestBody(challenge))) throw new Error()
    return challenge
  } catch {
    throw new Error('Paper Bukkit request frame is invalid')
  }
}

export function encodePaperBukkitOnlinePlayerResponseFrameV1(
  payloadInput: unknown,
  signatureInput: Uint8Array
): Buffer {
  try {
    const payload = canonicalPaperBukkitOnlinePlayerPayloadV1(payloadInput)
    if (payload.byteLength <= 0 || payload.byteLength > MAX_PAYLOAD_BYTES) throw new Error()
    const signature = ownedBytes(signatureInput, SIGNATURE_BYTES)
    if (signature.byteLength !== SIGNATURE_BYTES) throw new Error()
    const frame = Buffer.allocUnsafe(RESPONSE_HEADER_BYTES + payload.byteLength + signature.byteLength)
    RESPONSE_MAGIC.copy(frame, 0)
    frame.writeUInt8(VERSION, 4)
    frame.writeUInt32BE(payload.byteLength, 5)
    frame.writeUInt16BE(signature.byteLength, 9)
    payload.copy(frame, RESPONSE_HEADER_BYTES)
    signature.copy(frame, RESPONSE_HEADER_BYTES + payload.byteLength)
    return frame
  } catch {
    throw new Error('Paper Bukkit response frame is invalid')
  }
}

export function decodePaperBukkitOnlinePlayerResponseFrameV1(
  input: Uint8Array
): PaperBukkitOnlinePlayerEnvelopeV1 {
  try {
    const frame = ownedBytes(input, MAX_RESPONSE_FRAME_BYTES)
    if (frame.byteLength < RESPONSE_HEADER_BYTES || !exactMagic(frame, RESPONSE_MAGIC)
      || frame.readUInt8(4) !== VERSION) throw new Error()
    const payloadLength = frame.readUInt32BE(5)
    const signatureLength = frame.readUInt16BE(9)
    if (payloadLength <= 0 || payloadLength > MAX_PAYLOAD_BYTES
      || signatureLength !== SIGNATURE_BYTES
      || frame.byteLength !== RESPONSE_HEADER_BYTES + payloadLength + signatureLength) throw new Error()
    const payloadBytes = frame.subarray(RESPONSE_HEADER_BYTES, RESPONSE_HEADER_BYTES + payloadLength)
    const signature = frame.subarray(RESPONSE_HEADER_BYTES + payloadLength)
    const raw = JSON.parse(utf8.decode(payloadBytes)) as unknown
    const payload = parsePaperBukkitOnlinePlayerPayloadV1(raw)
    if (!payloadBytes.equals(canonicalPaperBukkitOnlinePlayerPayloadV1(payload))) throw new Error()
    return Object.freeze({ ...payload, signatureBase64Url: signature.toString('base64url') })
  } catch {
    throw new Error('Paper Bukkit response frame is invalid')
  }
}
