import {
  createHash,
  createPublicKey,
  randomBytes as cryptoRandomBytes,
  verify as cryptoVerify,
  type KeyObject
} from 'node:crypto'
import { z } from 'zod'
import {
  artifactTargetBindingSha256,
  validateArtifactTargetBinding,
  type ArtifactTargetBinding
} from './target-binding.js'

export const PAPER_BUKKIT_ONLINE_PLAYER_DOMAIN = 'botcheckerminecraft.paper-bukkit-online-player.v1'
export const PAPER_BUKKIT_ONLINE_PLAYER_PROFILE = 'paper-bukkit-online-player-v1'
const DOMAIN = PAPER_BUKKIT_ONLINE_PLAYER_DOMAIN
const PROFILE = PAPER_BUKKIT_ONLINE_PLAYER_PROFILE
const SHA256 = /^[a-f0-9]{64}$/
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/
const SAFE_VERSION = /^[a-zA-Z0-9][a-zA-Z0-9._:+-]{0,127}$/
const CREDENTIAL = /(password|passwd|secret|token|credential|api[_-]?key|bearer)/i
const MAX_PENDING = 1_024
const MAX_TTL_MS = 60_000
/**
 * Số lần verify thất bại tối đa cho MỘT challenge trước khi nonce bị burn.
 *
 * Burn ngay lần đầu (đề xuất ban đầu) sẽ khiến một client lỗi mạng tự khoá mình
 * khỏi challenge hợp lệ, và phá contract đã được test khoá. Không burn thì attacker
 * có loopback được thử Ed25519 verify không giới hạn trong suốt TTL (tối đa 60 s).
 * Ngưỡng nhỏ giữ được retry lành mạnh nhưng chặn dò kéo dài.
 */
const MAX_FAILED_ATTEMPTS_PER_CHALLENGE = 5
const MAX_CHALLENGE_BYTES = 4 * 1024
const MAX_PAYLOAD_BYTES = 16 * 1024

const safeId = (label: string) => z.string().min(1).max(128).regex(SAFE_ID)
  .refine(value => value === value.normalize('NFC'), `${label} must be NFC normalized`)
  .refine(value => !CREDENTIAL.test(value), `Credential-like ${label} rejected`)
const safeVersion = z.string().min(1).max(128).regex(SAFE_VERSION)
  .refine(value => value === value.normalize('NFC'), 'Version must be NFC normalized')
  .refine(value => !CREDENTIAL.test(value), 'Credential-like version rejected')
const base64 = (bytes: number) => z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/)
  .refine(value => {
    const decoded = Buffer.from(value, 'base64')
    return decoded.byteLength === bytes && decoded.toString('base64') === value
  }, `Canonical base64 for ${bytes} bytes required`)
const base64url = (bytes: number) => z.string().regex(/^[A-Za-z0-9_-]+$/)
  .refine(value => {
    const decoded = Buffer.from(value, 'base64url')
    return decoded.byteLength === bytes && decoded.toString('base64url') === value
  }, `Canonical base64url for ${bytes} bytes required`)

const providerSchema = z.strictObject({
  kind: z.literal('server-probe'),
  id: safeId('provider ID'),
  version: safeVersion,
  instanceId: safeId('provider instance ID').optional()
})
const allowedBindingSchema = z.strictObject({
  bindingId: safeId('binding ID'),
  targetBindingSha256: z.string().regex(SHA256)
})
const keySchema = z.strictObject({
  schemaVersion: z.literal(1),
  algorithm: z.literal('ed25519'),
  keyId: z.string().regex(SHA256),
  publicKeySpkiDerBase64: base64(44),
  provider: providerSchema,
  allowedBindings: z.array(allowedBindingSchema).min(1).max(64),
  notBeforeMs: z.number().int().safe().nonnegative(),
  notAfterMs: z.number().int().safe().positive(),
  status: z.literal('active')
}).superRefine((value, context) => {
  if (value.notAfterMs <= value.notBeforeMs) {
    context.addIssue({ code: 'custom', path: ['notAfterMs'], message: 'Key window is invalid' })
  }
  const unique = new Set(value.allowedBindings.map(item => `${item.bindingId}\u0000${item.targetBindingSha256}`))
  if (unique.size !== value.allowedBindings.length) {
    context.addIssue({ code: 'custom', path: ['allowedBindings'], message: 'Duplicate allowed binding' })
  }
})
const trustStoreSchema = z.strictObject({
  schemaVersion: z.literal(1),
  trustStoreId: safeId('trust store ID'),
  trustStoreVersion: safeVersion,
  keys: z.array(keySchema).min(1).max(64)
})
const challengeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  domain: z.literal(DOMAIN),
  profile: z.literal(PROFILE),
  audience: safeId('audience'),
  verifierInstanceId: safeId('verifier instance ID'),
  sequence: z.number().int().safe().positive(),
  challengeId: z.string().regex(SHA256),
  nonceBase64Url: base64url(32),
  runId: safeId('run ID'),
  keyId: z.string().regex(SHA256),
  bindingId: safeId('binding ID'),
  targetBindingSha256: z.string().regex(SHA256),
  provider: providerSchema,
  trustStoreId: safeId('trust store ID'),
  trustStoreVersion: safeVersion,
  trustStoreSha256: z.string().regex(SHA256),
  issuedAtMs: z.number().int().safe().nonnegative(),
  expiresAtMs: z.number().int().safe().positive()
}).superRefine((value, context) => {
  if (value.expiresAtMs <= value.issuedAtMs) {
    context.addIssue({ code: 'custom', path: ['expiresAtMs'], message: 'Challenge window is invalid' })
  }
})
const observationSchema = z.strictObject({
  source: z.literal('bukkit-getOnlinePlayers-size'),
  primaryThreadSnapshot: z.literal(true),
  atomicSnapshot: z.literal(false),
  releaseEligible: z.literal(false)
})
const payloadSchema = challengeSchema.extend({
  observedAtMs: z.number().int().safe().nonnegative(),
  claimedServerInstanceId: safeId('claimed server instance ID'),
  claimedBootId: safeId('claimed boot ID'),
  onlinePlayers: z.number().int().min(0).max(10_000),
  observation: observationSchema
})
const envelopeSchema = payloadSchema.extend({ signatureBase64Url: base64url(64) })

type CanonicalChallenge = z.infer<typeof challengeSchema>
type CanonicalPayload = z.infer<typeof payloadSchema>
type ChallengeIdentity = Omit<CanonicalChallenge, 'challengeId'>
export type PaperBukkitOnlinePlayerChallengeV1 = Readonly<CanonicalChallenge>
export type PaperBukkitOnlinePlayerPayloadV1 = Readonly<CanonicalPayload>
interface TrustKey {
  readonly schemaVersion: 1
  readonly algorithm: 'ed25519'
  readonly keyId: string
  readonly publicKeySpkiDerBase64: string
  readonly provider: Readonly<z.infer<typeof providerSchema>>
  readonly allowedBindings: readonly Readonly<z.infer<typeof allowedBindingSchema>>[]
  readonly notBeforeMs: number
  readonly notAfterMs: number
  readonly status: 'active'
}

export interface PaperBukkitOnlinePlayerTrustStore {
  readonly schemaVersion: 1
  readonly trustStoreId: string
  readonly trustStoreVersion: string
  readonly trustStoreSha256: string
  readonly keys: readonly TrustKey[]
}
export interface PaperBukkitOnlinePlayerVerifierOptions {
  readonly trustStore: PaperBukkitOnlinePlayerTrustStore
  readonly audience: string
  readonly verifierInstanceId: string
  readonly wallNowMs?: () => number
  readonly monotonicNowMs?: () => number
  readonly randomBytes?: (size: number) => Uint8Array
  readonly maxPending?: number
}

const compiledKeys = new WeakMap<PaperBukkitOnlinePlayerTrustStore, Map<string, KeyObject>>()

function now(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Verifier wall clock is invalid')
  return value
}
function monotonicNow(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER - MAX_TTL_MS) {
    throw new Error('Verifier monotonic clock is invalid')
  }
  return value
}
function sameProvider(left: z.infer<typeof providerSchema>, right: z.infer<typeof providerSchema>): boolean {
  return left.kind === right.kind && left.id === right.id && left.version === right.version
    && left.instanceId === right.instanceId
}
function challengeIdentityObject(input: ChallengeIdentity): unknown {
  return {
    schemaVersion: 1,
    domain: DOMAIN,
    profile: PROFILE,
    audience: input.audience,
    verifierInstanceId: input.verifierInstanceId,
    sequence: input.sequence,
    nonceBase64Url: input.nonceBase64Url,
    runId: input.runId,
    keyId: input.keyId,
    bindingId: input.bindingId,
    targetBindingSha256: input.targetBindingSha256,
    provider: input.provider,
    trustStoreId: input.trustStoreId,
    trustStoreVersion: input.trustStoreVersion,
    trustStoreSha256: input.trustStoreSha256,
    issuedAtMs: input.issuedAtMs,
    expiresAtMs: input.expiresAtMs
  }
}
function challengeCanonicalObject(input: CanonicalChallenge): unknown {
  return {
    schemaVersion: 1,
    domain: DOMAIN,
    profile: PROFILE,
    audience: input.audience,
    verifierInstanceId: input.verifierInstanceId,
    sequence: input.sequence,
    challengeId: input.challengeId,
    nonceBase64Url: input.nonceBase64Url,
    runId: input.runId,
    keyId: input.keyId,
    bindingId: input.bindingId,
    targetBindingSha256: input.targetBindingSha256,
    provider: input.provider,
    trustStoreId: input.trustStoreId,
    trustStoreVersion: input.trustStoreVersion,
    trustStoreSha256: input.trustStoreSha256,
    issuedAtMs: input.issuedAtMs,
    expiresAtMs: input.expiresAtMs
  }
}
function challengeProjection(input: CanonicalPayload): Omit<CanonicalChallenge, 'challengeId'> & { challengeId: string } {
  return {
    schemaVersion: input.schemaVersion,
    domain: input.domain,
    profile: input.profile,
    audience: input.audience,
    verifierInstanceId: input.verifierInstanceId,
    sequence: input.sequence,
    challengeId: input.challengeId,
    nonceBase64Url: input.nonceBase64Url,
    runId: input.runId,
    keyId: input.keyId,
    bindingId: input.bindingId,
    targetBindingSha256: input.targetBindingSha256,
    provider: input.provider,
    trustStoreId: input.trustStoreId,
    trustStoreVersion: input.trustStoreVersion,
    trustStoreSha256: input.trustStoreSha256,
    issuedAtMs: input.issuedAtMs,
    expiresAtMs: input.expiresAtMs
  }
}
function payloadProjection(input: z.infer<typeof envelopeSchema>): CanonicalPayload {
  const { signatureBase64Url: _ignored, ...payload } = input
  return payload
}
function sameChallenge(left: CanonicalChallenge, right: CanonicalChallenge): boolean {
  return left.schemaVersion === right.schemaVersion
    && left.domain === right.domain
    && left.profile === right.profile
    && left.audience === right.audience
    && left.verifierInstanceId === right.verifierInstanceId
    && left.sequence === right.sequence
    && left.challengeId === right.challengeId
    && left.nonceBase64Url === right.nonceBase64Url
    && left.runId === right.runId
    && left.keyId === right.keyId
    && left.bindingId === right.bindingId
    && left.targetBindingSha256 === right.targetBindingSha256
    && sameProvider(left.provider, right.provider)
    && left.trustStoreId === right.trustStoreId
    && left.trustStoreVersion === right.trustStoreVersion
    && left.trustStoreSha256 === right.trustStoreSha256
    && left.issuedAtMs === right.issuedAtMs
    && left.expiresAtMs === right.expiresAtMs
}
function canonicalChallengeObject(input: unknown): CanonicalChallenge {
  const parsed = challengeSchema.parse(input)
  const { challengeId: _ignored, ...identity } = parsed
  const challengeId = createHash('sha256')
    .update(Buffer.from(JSON.stringify(challengeIdentityObject(identity)), 'utf8')).digest('hex')
  if (parsed.challengeId !== challengeId) throw new Error('Paper Bukkit challenge identity is invalid')
  return Object.freeze({ ...parsed, provider: Object.freeze({ ...parsed.provider }) })
}

export function parsePaperBukkitOnlinePlayerChallengeV1(input: unknown): PaperBukkitOnlinePlayerChallengeV1 {
  try {
    return canonicalChallengeObject(input)
  } catch {
    throw new Error('Paper Bukkit challenge is invalid')
  }
}

export function canonicalPaperBukkitOnlinePlayerChallengeV1(input: unknown): Buffer {
  const challenge = parsePaperBukkitOnlinePlayerChallengeV1(input)
  const bytes = Buffer.from(JSON.stringify(challengeCanonicalObject(challenge)), 'utf8')
  if (bytes.byteLength > MAX_CHALLENGE_BYTES) throw new Error('Paper Bukkit challenge is invalid')
  return bytes
}

export function parsePaperBukkitOnlinePlayerPayloadV1(input: unknown): PaperBukkitOnlinePlayerPayloadV1 {
  const parsed = payloadSchema.safeParse(input)
  if (!parsed.success) throw new Error('Paper Bukkit payload is invalid')
  return Object.freeze({
    ...parsed.data,
    provider: Object.freeze({ ...parsed.data.provider }),
    observation: Object.freeze({ ...parsed.data.observation })
  })
}

export function canonicalPaperBukkitOnlinePlayerPayloadV1(input: unknown): Buffer {
  const payload = parsePaperBukkitOnlinePlayerPayloadV1(input)
  const bytes = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    domain: DOMAIN,
    profile: PROFILE,
    audience: payload.audience,
    verifierInstanceId: payload.verifierInstanceId,
    sequence: payload.sequence,
    challengeId: payload.challengeId,
    nonceBase64Url: payload.nonceBase64Url,
    runId: payload.runId,
    keyId: payload.keyId,
    bindingId: payload.bindingId,
    targetBindingSha256: payload.targetBindingSha256,
    provider: payload.provider,
    trustStoreId: payload.trustStoreId,
    trustStoreVersion: payload.trustStoreVersion,
    trustStoreSha256: payload.trustStoreSha256,
    issuedAtMs: payload.issuedAtMs,
    expiresAtMs: payload.expiresAtMs,
    observedAtMs: payload.observedAtMs,
    claimedServerInstanceId: payload.claimedServerInstanceId,
    claimedBootId: payload.claimedBootId,
    onlinePlayers: payload.onlinePlayers,
    observation: payload.observation
  }), 'utf8')
  if (bytes.byteLength > MAX_PAYLOAD_BYTES) throw new Error('Paper Bukkit payload exceeds bound')
  return bytes
}

export function buildPaperBukkitOnlinePlayerTrustStore(input: unknown): PaperBukkitOnlinePlayerTrustStore {
  const parsed = trustStoreSchema.parse(input)
  const compiled = new Map<string, KeyObject>()
  const keys = parsed.keys.map(key => {
    const der = Buffer.from(key.publicKeySpkiDerBase64, 'base64')
    let publicKey: KeyObject
    try { publicKey = createPublicKey({ key: der, format: 'der', type: 'spki' }) } catch { throw new Error('Paper Bukkit public key is invalid') }
    if (publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519'
      || !Buffer.from(publicKey.export({ type: 'spki', format: 'der' })).equals(der)
      || createHash('sha256').update(der).digest('hex') !== key.keyId) {
      throw new Error('Paper Bukkit public key is invalid')
    }
    if (compiled.has(key.keyId)) throw new Error('Duplicate Paper Bukkit trusted key ID')
    compiled.set(key.keyId, publicKey)
    return Object.freeze({ ...key, provider: Object.freeze({ ...key.provider }), allowedBindings: Object.freeze(
      key.allowedBindings.map(binding => Object.freeze({ ...binding }))
    ) })
  }).sort((left, right) => left.keyId.localeCompare(right.keyId, 'en'))
  const trustStoreSha256 = createHash('sha256').update(JSON.stringify({
    schemaVersion: 1, trustStoreId: parsed.trustStoreId, trustStoreVersion: parsed.trustStoreVersion, keys
  })).digest('hex')
  const store = Object.freeze({ schemaVersion: 1 as const, trustStoreId: parsed.trustStoreId,
    trustStoreVersion: parsed.trustStoreVersion, trustStoreSha256, keys: Object.freeze(keys) })
  compiledKeys.set(store, compiled)
  return store
}

export class PaperBukkitOnlinePlayerVerifier {
  private readonly trustStore: PaperBukkitOnlinePlayerTrustStore
  private readonly audience: string
  private readonly verifierInstanceId: string
  private readonly wallNow: () => number
  private readonly monotonicNow: () => number
  private readonly random: (size: number) => Uint8Array
  private readonly maxPending: number
  private readonly pending = new Map<string, {
    challenge: CanonicalChallenge
    binding: ArtifactTargetBinding
    expiresMonotonicMs: number
    failedAttempts: number
  }>()
  private sequence = 0
  private lastMonotonicMs: number | undefined
  private monotonicCompromised = false

  constructor(options: PaperBukkitOnlinePlayerVerifierOptions) {
    const compiled = compiledKeys.get(options?.trustStore)
    if (!compiled) throw new Error('Paper Bukkit trust store must be built')
    this.trustStore = options.trustStore
    this.audience = safeId('audience').parse(options.audience)
    this.verifierInstanceId = safeId('verifier instance ID').parse(options.verifierInstanceId)
    this.wallNow = options.wallNowMs ?? Date.now
    this.monotonicNow = options.monotonicNowMs ?? (() => performance.now())
    this.random = options.randomBytes ?? cryptoRandomBytes
    this.maxPending = z.number().int().min(1).max(MAX_PENDING).parse(options.maxPending ?? MAX_PENDING)
  }

  issueChallenge(input: { readonly runId: string, readonly expectedBinding: ArtifactTargetBinding, readonly keyId: string, readonly ttlMs: number }): CanonicalChallenge {
    const issuedAtMs = now(this.wallNow())
    const issuedMonotonicMs = this.observeMonotonic()
    for (const [challengeId, pending] of this.pending) {
      if (issuedAtMs >= pending.challenge.expiresAtMs
        || issuedMonotonicMs >= pending.expiresMonotonicMs) this.pending.delete(challengeId)
    }
    const ttlMs = z.number().int().min(1).max(MAX_TTL_MS).parse(input.ttlMs)
    const binding = validateArtifactTargetBinding(input.expectedBinding)
    if (binding.provider.kind !== 'server-probe') throw new Error('Paper Bukkit binding provider is invalid')
    const bindingProvider = providerSchema.parse(binding.provider)
    const key = this.trustStore.keys.find(candidate => candidate.keyId === input.keyId)
    if (!key || !sameProvider(key.provider, bindingProvider) || issuedAtMs < key.notBeforeMs
      || issuedAtMs + ttlMs > key.notAfterMs || !key.allowedBindings.some(allowed =>
        allowed.bindingId === binding.bindingId && allowed.targetBindingSha256 === artifactTargetBindingSha256(binding))) {
      throw new Error('Paper Bukkit trusted key is unavailable for target binding')
    }
    if (this.pending.size >= this.maxPending || this.sequence >= Number.MAX_SAFE_INTEGER) {
      throw new Error('Paper Bukkit challenge capacity exhausted')
    }
    const nonce = Buffer.from(this.random(32))
    if (nonce.byteLength !== 32) throw new Error('Paper Bukkit random source is invalid')
    this.sequence += 1
    const identity: ChallengeIdentity = {
      schemaVersion: 1 as const, domain: DOMAIN, profile: PROFILE, audience: this.audience,
      verifierInstanceId: this.verifierInstanceId, sequence: this.sequence, nonceBase64Url: nonce.toString('base64url'),
      runId: safeId('run ID').parse(input.runId), keyId: key.keyId, bindingId: binding.bindingId,
      targetBindingSha256: artifactTargetBindingSha256(binding), provider: key.provider,
      trustStoreId: this.trustStore.trustStoreId, trustStoreVersion: this.trustStore.trustStoreVersion,
      trustStoreSha256: this.trustStore.trustStoreSha256, issuedAtMs, expiresAtMs: issuedAtMs + ttlMs
    }
    const challenge = canonicalChallengeObject({
      schemaVersion: identity.schemaVersion,
      domain: identity.domain,
      profile: identity.profile,
      audience: identity.audience,
      verifierInstanceId: identity.verifierInstanceId,
      sequence: identity.sequence,
      challengeId: createHash('sha256')
        .update(Buffer.from(JSON.stringify(challengeIdentityObject(identity)), 'utf8')).digest('hex'),
      nonceBase64Url: identity.nonceBase64Url,
      runId: identity.runId,
      keyId: identity.keyId,
      bindingId: identity.bindingId,
      targetBindingSha256: identity.targetBindingSha256,
      provider: identity.provider,
      trustStoreId: identity.trustStoreId,
      trustStoreVersion: identity.trustStoreVersion,
      trustStoreSha256: identity.trustStoreSha256,
      issuedAtMs: identity.issuedAtMs,
      expiresAtMs: identity.expiresAtMs
    })
    this.pending.set(challenge.challengeId, {
      challenge,
      binding,
      expiresMonotonicMs: issuedMonotonicMs + ttlMs,
      failedAttempts: 0
    })
    return challenge
  }

  verifyAndConsume(input: unknown): Readonly<{ schemaVersion: 1, signatureValid: true, nonceConsumed: true, onlinePlayers: number, claimedServerInstanceId: string, claimedBootId: string, targetBindingSha256: string, releaseEligible: false }> {
    const verificationTime = now(this.wallNow())
    const verificationMonotonicMs = this.observeMonotonic()
    for (const [challengeId, pending] of this.pending) {
      if (verificationTime >= pending.challenge.expiresAtMs
        || verificationMonotonicMs >= pending.expiresMonotonicMs) this.pending.delete(challengeId)
    }
    const parsedEnvelope = envelopeSchema.safeParse(input)
    if (!parsedEnvelope.success) throw new Error('Paper Bukkit response is invalid')
    const envelope = parsedEnvelope.data
    const payload = payloadProjection(envelope)
    const responseChallenge = canonicalChallengeObject(challengeProjection(payload))
    const pending = this.pending.get(payload.challengeId)
    if (!pending) {
      this.pending.delete(payload.challengeId)
      throw new Error('Paper Bukkit challenge is unavailable, expired, consumed, or replayed')
    }
    const challenge = pending.challenge
    const fieldsMatch = sameChallenge(responseChallenge, challenge)
    if (!fieldsMatch || payload.observedAtMs < challenge.issuedAtMs || payload.observedAtMs > challenge.expiresAtMs
      || payload.observedAtMs > verificationTime) {
      this.recordFailedAttempt(challenge.challengeId)
      throw new Error('Paper Bukkit response does not match active challenge')
    }
    const key = this.trustStore.keys.find(candidate => candidate.keyId === challenge.keyId)
    const publicKey = compiledKeys.get(this.trustStore)?.get(challenge.keyId)
    if (!key || !publicKey || verificationTime < key.notBeforeMs || verificationTime >= key.notAfterMs
      || !sameProvider(key.provider, challenge.provider) || !key.allowedBindings.some(allowed =>
        allowed.bindingId === challenge.bindingId && allowed.targetBindingSha256 === challenge.targetBindingSha256)) {
      this.recordFailedAttempt(challenge.challengeId)
      throw new Error('Paper Bukkit trusted key is unavailable')
    }
    const signature = Buffer.from(envelope.signatureBase64Url, 'base64url')
    if (!cryptoVerify(null, canonicalPaperBukkitOnlinePlayerPayloadV1(payload), publicKey, signature)) {
      this.recordFailedAttempt(challenge.challengeId)
      throw new Error('Paper Bukkit signature is invalid')
    }
    this.pending.delete(challenge.challengeId)
    return Object.freeze({ schemaVersion: 1 as const, signatureValid: true as const, nonceConsumed: true as const,
      onlinePlayers: payload.onlinePlayers, claimedServerInstanceId: payload.claimedServerInstanceId,
      claimedBootId: payload.claimedBootId, targetBindingSha256: challenge.targetBindingSha256,
      releaseEligible: false as const })
  }

  /**
   * Đếm một lần verify thất bại cho challenge và burn nonce khi chạm ngưỡng.
   * Nonce đã burn không thể dùng lại kể cả với envelope hợp lệ — buộc phải xin
   * challenge mới.
   */
  private recordFailedAttempt(challengeId: string): void {
    const pending = this.pending.get(challengeId)
    if (!pending) return
    pending.failedAttempts += 1
    if (pending.failedAttempts >= MAX_FAILED_ATTEMPTS_PER_CHALLENGE) {
      this.pending.delete(challengeId)
    }
  }

  private observeMonotonic(): number {
    const value = monotonicNow(this.monotonicNow())
    if (this.monotonicCompromised) {
      throw new Error('Paper Bukkit verifier monotonic state is compromised and unusable')
    }
    if (this.lastMonotonicMs !== undefined && value < this.lastMonotonicMs) {
      this.monotonicCompromised = true
      this.pending.clear()
      throw new Error('Paper Bukkit verifier monotonic clock moved backwards')
    }
    this.lastMonotonicMs = value
    return value
  }
}
