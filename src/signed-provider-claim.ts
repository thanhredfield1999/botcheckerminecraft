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
import {
  canonicalSignedProviderChallengeIdentityV1,
  canonicalSignedProviderClaimV1,
  canonicalSignedProviderObservationBoundClaimV2,
  parseSignedProviderCanonicalContent,
  parseSignedProviderClaimEnvelope,
  type SignedProviderCanonicalContent,
  type SignedProviderClaims
} from './signed-provider-claim-schema.js'
import type { SignedProviderChallengeStore } from './signed-provider-challenge-store.js'
import { assessJvmArtifactObservationAgainstBinding } from './jvm-artifact-observation.js'

export {
  canonicalSignedProviderClaimV1,
  canonicalSignedProviderObservationBoundClaimV2,
  type SignedProviderClaims
} from './signed-provider-claim-schema.js'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/
const SAFE_VERSION = /^[a-zA-Z0-9][a-zA-Z0-9._:+-]{0,127}$/
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key|bearer)/i
const MAX_KEYS = 64
const MAX_BINDINGS_PER_KEY = 64
const MAX_SPKI_BASE64_CHARS = 1024
const MAX_PENDING_CHALLENGES = 1024
const MAX_CHALLENGE_TTL_MS = 60_000
const MAX_CANONICAL_CLAIM_BYTES = 256 * 1024
const CLAIM_DOMAIN = 'botcheckerminecraft.signed-provider-claim.v1'

const safeIdentifier = (label: string) => z.string().min(1).max(128).regex(SAFE_ID)
  .refine(value => value === value.normalize('NFC'), `${label} must be NFC normalized`)
  .refine(value => !CREDENTIAL_PATTERN.test(value), `Credential-like ${label} rejected`)

const safeVersion = z.string().min(1).max(128).regex(SAFE_VERSION)
  .refine(value => value === value.normalize('NFC'), 'Version must be NFC normalized')
  .refine(value => !CREDENTIAL_PATTERN.test(value), 'Credential-like version rejected')

const providerSchema = z.strictObject({
  kind: z.literal('server-probe'),
  id: safeIdentifier('provider ID'),
  version: safeVersion,
  instanceId: safeIdentifier('provider instance ID').optional()
})

const allowedBindingSchema = z.strictObject({
  bindingId: safeIdentifier('binding ID'),
  targetBindingSha256: z.string().regex(SHA256_PATTERN)
})

const trustKeyInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  algorithm: z.literal('ed25519'),
  keyId: z.string().regex(SHA256_PATTERN),
  publicKeySpkiDerBase64: z.string().min(1).max(MAX_SPKI_BASE64_CHARS).regex(CANONICAL_BASE64),
  provider: providerSchema,
  allowedBindings: z.array(allowedBindingSchema).min(1).max(MAX_BINDINGS_PER_KEY),
  notBeforeMs: z.number().int().safe().nonnegative(),
  notAfterMs: z.number().int().safe().positive(),
  status: z.literal('active')
}).superRefine((value, context) => {
  if (value.notAfterMs <= value.notBeforeMs) {
    context.addIssue({ code: 'custom', path: ['notAfterMs'], message: 'Key validity window is invalid' })
  }
  const bindings = value.allowedBindings.map(binding =>
    `${binding.bindingId}\u0000${binding.targetBindingSha256}`)
  if (new Set(bindings).size !== bindings.length) {
    context.addIssue({ code: 'custom', path: ['allowedBindings'], message: 'Duplicate allowed binding' })
  }
})

const trustStoreInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  trustStoreId: safeIdentifier('trust store ID'),
  trustStoreVersion: safeVersion,
  keys: z.array(trustKeyInputSchema).min(1).max(MAX_KEYS)
})

export type SignedProviderClaimTrustKeyInput = z.input<typeof trustKeyInputSchema>
export type SignedProviderClaimTrustStoreInput = z.input<typeof trustStoreInputSchema>

export interface SignedProviderClaimTrustKey {
  readonly keyId: string
  readonly provider: Readonly<z.infer<typeof providerSchema>>
  readonly allowedBindings: ReadonlyArray<Readonly<z.infer<typeof allowedBindingSchema>>>
  readonly notBeforeMs: number
  readonly notAfterMs: number
  readonly status: 'active'
}

export interface SignedProviderClaimTrustStore {
  readonly schemaVersion: 1
  readonly trustStoreId: string
  readonly trustStoreVersion: string
  readonly trustStoreSha256: string
  readonly keys: ReadonlyArray<SignedProviderClaimTrustKey>
}

export interface CanonicalSignedProviderSignatureInput {
  readonly trustStore: SignedProviderClaimTrustStore
  readonly verificationTimeMs: number
  readonly signedContent: SignedProviderCanonicalContent
  readonly signature: Uint8Array
}

export interface CanonicalSignedProviderSignatureVerification {
  readonly signatureValid: true
  readonly freshnessEstablished: false
  readonly replayChecked: false
  readonly nonceConsumed: false
  readonly keyId: string
  readonly trustStoreId: string
  readonly trustStoreVersion: string
  readonly trustStoreSha256: string
  readonly provider: Readonly<z.infer<typeof providerSchema>>
  readonly bindingId: string
  readonly targetBindingSha256: string
}

interface CompiledTrustKey {
  publicKey: KeyObject
  publicKeySpkiDer: Buffer
}

export interface SignedProviderClaimChallenge {
  readonly schemaVersion: 1
  readonly domain: typeof CLAIM_DOMAIN
  readonly requiredClaimProfile?: 'jvm-observation-bound-v2'
  readonly audience: string
  readonly verifierInstanceId: string
  readonly sequence: number
  readonly challengeId: string
  readonly nonceBase64Url: string
  readonly runId: string
  readonly keyId: string
  readonly bindingId: string
  readonly targetBindingSha256: string
  readonly provider: Readonly<z.infer<typeof providerSchema>>
  readonly trustStoreId: string
  readonly trustStoreVersion: string
  readonly trustStoreSha256: string
  readonly issuedAtMs: number
  readonly expiresAtMs: number
}

interface PendingChallenge {
  readonly challenge: SignedProviderClaimChallenge
  readonly expectedBinding: ArtifactTargetBinding
  readonly issuedMonotonicMs: number
  readonly expiresMonotonicMs: number
  invalidAttempts: number
}

export interface SignedProviderClaimVerifierOptions {
  readonly trustStore: SignedProviderClaimTrustStore
  readonly audience: string
  readonly verifierInstanceId?: string
  readonly wallNowMs?: () => number
  readonly monotonicNowMs?: () => number
  readonly randomBytes?: (size: number) => Uint8Array
  readonly maxPending?: number
  readonly maxInvalidAttempts?: number
  readonly challengeStore?: SignedProviderChallengeStore
}

export interface SignedProviderClaimVerification {
  readonly schemaVersion: 1
  readonly signatureValid: true
  readonly configuredKeyMatch: true
  readonly claimFreshness: 'fresh'
  readonly nonceConsumed: true
  readonly trustDecision: 'ACCEPTED_NON_RELEASE'
  readonly evidenceGrade: 'artifact-bound'
  readonly releaseEligible: false
  readonly trustStoreId: string
  readonly trustStoreVersion: string
  readonly trustStoreSha256: string
  readonly keyId: string
  readonly runId: string
  readonly bindingId: string
  readonly targetBindingSha256: string
  readonly provider: Readonly<z.infer<typeof providerSchema>>
  readonly claimedServerInstanceId: string
  readonly claimedBootId: string
  readonly observationBinding?: Readonly<{
    status: 'TARGET_FILE_MATCH_NON_AUTHORITATIVE'
    authoritative: false
    provesLoadedBytecode: false
    releaseEligible: false
    role: 'paper' | 'candidate' | 'probe'
    logicalId: string
    logicalPath: string
    observationSha256: string
    codeSourceUriFingerprint: string
    codeSourceFileSha256: string
    internalEntryConsistency: 'MATCH' | 'MISMATCH' | 'NOT_A_JAR'
    observedAtMs: number
    observationTimeAttested: 'self-asserted-by-signer'
    observationFreshness: 'not-established'
    limitations: ReadonlyArray<
      | 'declared-identity-is-caller-supplied'
      | 'codesource-file-is-not-loaded-bytecode-proof'
      | 'class-resource-is-loader-mediated-informational-evidence'
      | 'snapshot-is-best-effort-non-atomic'
    >
  }>
}

const compiledTrustKeys = new WeakMap<SignedProviderClaimTrustStore, Map<string, CompiledTrustKey>>()
const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  'byteLength'
)?.get

class CanonicalSignatureInvalidError extends Error {
  constructor() {
    super('Canonical signed provider claim signature is invalid')
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

function decodeCanonicalSpki(base64: string): { der: Buffer; publicKey: KeyObject } {
  const der = Buffer.from(base64, 'base64')
  if (der.length === 0 || der.toString('base64') !== base64) {
    throw new Error('Public key SPKI must use canonical base64')
  }
  let publicKey: KeyObject
  try {
    publicKey = createPublicKey({ key: der, format: 'der', type: 'spki' })
  } catch {
    throw new Error('Public key must be canonical Ed25519 SPKI')
  }
  if (publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('Public key must be Ed25519')
  }
  const exported = publicKey.export({ type: 'spki', format: 'der' })
  if (!Buffer.isBuffer(exported) || !exported.equals(der)) {
    throw new Error('Public key SPKI is not byte-canonical')
  }
  return { der, publicKey }
}

export function buildSignedProviderClaimTrustStore(input: unknown): SignedProviderClaimTrustStore {
  const parsed = trustStoreInputSchema.parse(input)
  const keyIds = parsed.keys.map(key => key.keyId)
  if (new Set(keyIds).size !== keyIds.length) throw new Error('Duplicate trusted key ID')

  const compiled = new Map<string, CompiledTrustKey>()
  const canonicalKeys = parsed.keys.map(key => {
    const { der, publicKey } = decodeCanonicalSpki(key.publicKeySpkiDerBase64)
    if (sha256(der) !== key.keyId) throw new Error('Trusted keyId does not match SPKI fingerprint')
    const allowedBindings = [...key.allowedBindings]
      .map(binding => ({ ...binding }))
      .sort((left, right) => compareText(left.bindingId, right.bindingId)
        || compareText(left.targetBindingSha256, right.targetBindingSha256))
    compiled.set(key.keyId, { publicKey, publicKeySpkiDer: Buffer.from(der) })
    return {
      keyId: key.keyId,
      publicKeySpkiDerBase64: der.toString('base64'),
      provider: { ...key.provider },
      allowedBindings,
      notBeforeMs: key.notBeforeMs,
      notAfterMs: key.notAfterMs,
      status: key.status
    }
  }).sort((left, right) => compareText(left.keyId, right.keyId))

  const canonicalPayload = {
    schemaVersion: 1 as const,
    trustStoreId: parsed.trustStoreId,
    trustStoreVersion: parsed.trustStoreVersion,
    keys: canonicalKeys
  }
  const keys = canonicalKeys.map(({ publicKeySpkiDerBase64: _omitted, ...key }) => Object.freeze({
    ...key,
    provider: Object.freeze({ ...key.provider }),
    allowedBindings: Object.freeze(key.allowedBindings.map(binding => Object.freeze({ ...binding })))
  }))
  const store: SignedProviderClaimTrustStore = Object.freeze({
    schemaVersion: 1,
    trustStoreId: parsed.trustStoreId,
    trustStoreVersion: parsed.trustStoreVersion,
    trustStoreSha256: sha256(JSON.stringify(canonicalPayload)),
    keys: Object.freeze(keys)
  })
  compiledTrustKeys.set(store, compiled)
  return store
}

export function assertSignedProviderClaimTrustStoreSnapshot(
  trustStore: SignedProviderClaimTrustStore
): void {
  if (!compiledTrustKeys.has(trustStore)) {
    throw new Error('Trust store must be an exact built snapshot')
  }
}

export function verifyCanonicalSignedProviderClaimSignature(
  input: CanonicalSignedProviderSignatureInput
): Readonly<CanonicalSignedProviderSignatureVerification> {
  if (!input || typeof input !== 'object') throw new Error('Canonical signature input is invalid')
  const trustStore = input.trustStore
  const compiled = compiledTrustKeys.get(trustStore)
  if (!compiled) throw new Error('Trust store must be built by the verifier trust-store builder')
  const verificationTimeMs = safeNow(input.verificationTimeMs, 'Signature verification time', true)
  const signatureInput = input.signature
  if (!(signatureInput instanceof Uint8Array)) {
    throw new Error('Canonical signature must be a 64-byte Uint8Array')
  }
  if (!typedArrayByteLength || typedArrayByteLength.call(signatureInput) !== 64) {
    throw new Error('Canonical signature must be a 64-byte Uint8Array')
  }
  const signature = Buffer.from(signatureInput.subarray(0, 64))
  if (signature.byteLength !== 64) {
    throw new Error('Canonical signature must be a 64-byte Uint8Array')
  }
  const signedContentInput = input.signedContent
  const signedContent = parseSignedProviderCanonicalContent(signedContentInput)
  const claims = signedContent.claims
  const canonicalPayload = signedContent.schemaVersion === 1
    ? canonicalSignedProviderClaimV1(claims)
    : canonicalSignedProviderObservationBoundClaimV2({
        claims,
        jvmArtifactObservation: signedContent.jvmArtifactObservation
      })
  if (canonicalPayload.byteLength === 0 || canonicalPayload.byteLength > MAX_CANONICAL_CLAIM_BYTES) {
    throw new Error('Canonical payload byte length is invalid')
  }

  const keyId = claims.keyId
  const provider = claims.provider
  const bindingId = claims.bindingId
  const targetBindingSha256 = claims.targetBindingSha256
  if (
    claims.trustStoreId !== trustStore.trustStoreId
    || claims.trustStoreVersion !== trustStore.trustStoreVersion
    || claims.trustStoreSha256 !== trustStore.trustStoreSha256
  ) throw new Error('Signed claim trust store does not match local verifier policy')
  const key = trustStore.keys.find(candidate => candidate.keyId === keyId)
  const compiledKey = compiled.get(keyId)
  if (!key || !compiledKey) throw new Error('Configured trust key is unavailable')
  if (JSON.stringify(provider) !== JSON.stringify(key.provider)) {
    throw new Error('Provider does not match local verifier policy')
  }
  if (!key.allowedBindings.some(binding =>
    binding.bindingId === bindingId
    && binding.targetBindingSha256 === targetBindingSha256)) {
    throw new Error('Binding is not authorized by local verifier policy')
  }
  if (verificationTimeMs < key.notBeforeMs || verificationTimeMs > key.notAfterMs) {
    throw new Error('Configured trust key is not active at verification time')
  }
  if (!cryptoVerify(null, canonicalPayload, compiledKey.publicKey, signature)) {
    throw new CanonicalSignatureInvalidError()
  }
  return Object.freeze({
    signatureValid: true,
    freshnessEstablished: false,
    replayChecked: false,
    nonceConsumed: false,
    keyId,
    trustStoreId: trustStore.trustStoreId,
    trustStoreVersion: trustStore.trustStoreVersion,
    trustStoreSha256: trustStore.trustStoreSha256,
    provider: Object.freeze({ ...provider }),
    bindingId,
    targetBindingSha256
  })
}

function safeNow(value: number, label: string, integer: boolean): number {
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) {
    throw new Error(`${label} must be a nonnegative${integer ? ' safe integer' : ' finite number'}`)
  }
  return value
}

function safeMonotonicNow(value: number): number {
  const validated = safeNow(value, 'Monotonic clock', false)
  if (validated > Number.MAX_SAFE_INTEGER - MAX_CHALLENGE_TTL_MS) {
    throw new Error('Monotonic expiry exceeds safe numeric range')
  }
  return validated
}

function freezeChallenge(input: Omit<SignedProviderClaimChallenge, 'challengeId'>): SignedProviderClaimChallenge {
  return Object.freeze({
    ...input,
    challengeId: sha256(canonicalSignedProviderChallengeIdentityV1(input)),
    provider: Object.freeze({ ...input.provider })
  })
}

export class SignedProviderClaimVerifier {
  private readonly trustStore: SignedProviderClaimTrustStore
  private readonly compiledKeys: Map<string, CompiledTrustKey>
  private readonly audience: string
  private readonly verifierInstanceId: string
  private readonly wallNow: () => number
  private readonly monotonicNow: () => number
  private readonly random: (size: number) => Uint8Array
  private readonly maxPending: number
  private readonly maxInvalidAttempts: number
  private readonly challengeStore: SignedProviderChallengeStore | undefined
  private readonly pending = new Map<string, PendingChallenge>()
  private sequence = 0
  private lastMonotonicMs: number | undefined
  private monotonicCompromised = false

  constructor(options: SignedProviderClaimVerifierOptions) {
    const compiled = compiledTrustKeys.get(options.trustStore)
    if (!compiled) throw new Error('Trust store must be built by the verifier trust-store builder')
    this.trustStore = options.trustStore
    this.compiledKeys = compiled
    this.audience = safeIdentifier('audience').parse(options.audience)
    this.wallNow = options.wallNowMs ?? Date.now
    this.monotonicNow = options.monotonicNowMs ?? (() => performance.now())
    this.random = options.randomBytes ?? cryptoRandomBytes
    const instanceId = options.verifierInstanceId ?? cryptoRandomBytes(16).toString('hex')
    this.verifierInstanceId = safeIdentifier('verifier instance ID').parse(instanceId)
    this.maxPending = z.number().int().min(1).max(MAX_PENDING_CHALLENGES)
      .parse(options.maxPending ?? MAX_PENDING_CHALLENGES)
    this.maxInvalidAttempts = z.number().int().min(1).max(64)
      .parse(options.maxInvalidAttempts ?? 8)
    this.challengeStore = options.challengeStore
    if (this.challengeStore && (
      this.challengeStore.audience !== this.audience
      || this.challengeStore.verifierInstanceId !== this.verifierInstanceId
    )) throw new Error('Shared challenge store scope does not match verifier scope')
    this.challengeStore?.configureVerifierPolicy(
      this.maxPending,
      this.maxInvalidAttempts,
      this.trustStore.trustStoreSha256,
      this.wallNow
    )
  }

  issueChallenge(input: {
    readonly runId: string
    readonly expectedBinding: ArtifactTargetBinding
    readonly keyId: string
    readonly ttlMs: number
    readonly requiredClaimProfile?: 'jvm-observation-bound-v2'
  }): SignedProviderClaimChallenge {
    const wallNow = safeNow(this.wallNow(), 'Wall clock', true)
    const monotonicNow = safeMonotonicNow(this.monotonicNow())
    if (this.monotonicCompromised) throw new Error('Verifier monotonic state is compromised and unusable')
    if (this.lastMonotonicMs !== undefined && monotonicNow < this.lastMonotonicMs) {
      this.monotonicCompromised = true
      this.pending.clear()
      throw new Error('Monotonic clock moved backwards')
    }
    this.lastMonotonicMs = monotonicNow
    const ttlMs = z.number().int().min(1).max(MAX_CHALLENGE_TTL_MS).parse(input.ttlMs)
    const runId = safeIdentifier('run ID').parse(input.runId)
    const keyId = z.string().regex(SHA256_PATTERN).parse(input.keyId)
    const requiredClaimProfile = z.literal('jvm-observation-bound-v2')
      .optional().parse(input.requiredClaimProfile)
    const expectedBinding = validateArtifactTargetBinding(input.expectedBinding)
    if (expectedBinding.artifacts.filter(artifact => artifact.role === 'probe').length !== 1) {
      throw new Error('Signed provider challenge requires exactly one declared probe artifact')
    }
    const targetBindingSha256 = artifactTargetBindingSha256(expectedBinding)
    const key = this.trustStore.keys.find(candidate => candidate.keyId === keyId)
    if (!key || !this.compiledKeys.has(keyId)) throw new Error('Trusted key is unavailable')
    if (wallNow < key.notBeforeMs || wallNow > key.notAfterMs) {
      throw new Error('Trusted key is not active at challenge issue time')
    }
    if (wallNow + ttlMs > key.notAfterMs) throw new Error('Challenge exceeds trusted key validity window')
    if (!key.allowedBindings.some(binding =>
      binding.bindingId === expectedBinding.bindingId
      && binding.targetBindingSha256 === targetBindingSha256)) {
      throw new Error('Trusted key is not authorized for exact target binding')
    }
    const buildChallenge = (sequence: number, issuedWallNow: number): SignedProviderClaimChallenge => {
      const nonce = Buffer.from(this.random(32))
      if (nonce.byteLength !== 32) throw new Error('Challenge random source must return exactly 32 bytes')
      return freezeChallenge({
        schemaVersion: 1,
        domain: CLAIM_DOMAIN,
        ...(requiredClaimProfile ? { requiredClaimProfile } : {}),
        audience: this.audience,
        verifierInstanceId: this.verifierInstanceId,
        sequence,
        nonceBase64Url: nonce.toString('base64url'),
        runId,
        keyId,
        bindingId: expectedBinding.bindingId,
        targetBindingSha256,
        provider: key.provider,
        trustStoreId: this.trustStore.trustStoreId,
        trustStoreVersion: this.trustStore.trustStoreVersion,
        trustStoreSha256: this.trustStore.trustStoreSha256,
        issuedAtMs: issuedWallNow,
        expiresAtMs: issuedWallNow + ttlMs
      })
    }
    if (this.challengeStore) {
      return this.challengeStore.issue({
        wallNowMs: this.wallNow,
        maxPending: this.maxPending,
        build: (sequence, issuedWallNow) => {
          if (issuedWallNow < key.notBeforeMs || issuedWallNow > key.notAfterMs) {
            throw new Error('Trusted key is not active at shared challenge issue time')
          }
          if (issuedWallNow + ttlMs > key.notAfterMs) {
            throw new Error('Shared challenge exceeds trusted key validity window')
          }
          return { challenge: buildChallenge(sequence, issuedWallNow), expectedBinding }
        }
      }).challenge
    }
    this.pruneExpired(monotonicNow, wallNow)
    if (this.pending.size >= this.maxPending) throw new Error('Signed provider challenge capacity exhausted')
    if (this.sequence >= Number.MAX_SAFE_INTEGER) throw new Error('Challenge sequence exhausted')
    this.sequence += 1
    const challenge = buildChallenge(this.sequence, wallNow)
    if (this.pending.has(challenge.challengeId)) throw new Error('Duplicate challenge identity')
    this.pending.set(challenge.challengeId, {
      challenge,
      expectedBinding,
      issuedMonotonicMs: monotonicNow,
      expiresMonotonicMs: monotonicNow + ttlMs,
      invalidAttempts: 0
    })
    return challenge
  }

  verifyAndConsume(input: unknown): SignedProviderClaimVerification {
    const monotonicNow = safeMonotonicNow(this.monotonicNow())
    const wallNow = safeNow(this.wallNow(), 'Wall clock', true)
    if (this.monotonicCompromised) throw new Error('Verifier monotonic state is compromised and unusable')
    if (this.lastMonotonicMs !== undefined && monotonicNow < this.lastMonotonicMs) {
      this.monotonicCompromised = true
      this.pending.clear()
      throw new Error('Monotonic clock moved backwards')
    }
    this.lastMonotonicMs = monotonicNow
    if (!this.challengeStore) this.pruneExpired(monotonicNow, wallNow)
    const envelope = parseSignedProviderClaimEnvelope(input)
    const claims = envelope.claims
    const sharedPending = this.challengeStore?.load(claims.challengeId, this.wallNow)
    const localPending = this.challengeStore ? undefined : this.pending.get(claims.challengeId)
    const pending = sharedPending ?? localPending
    if (!pending) throw new Error('Signed provider challenge is unavailable, expired, consumed, or replayed')
    const challenge = pending.challenge
    if (
      (localPending !== undefined && monotonicNow >= localPending.expiresMonotonicMs)
      || wallNow >= challenge.expiresAtMs
    ) {
      this.pending.delete(challenge.challengeId)
      throw new Error('Signed provider challenge expired')
    }
    const exactChallengeFields =
      claims.schemaVersion === challenge.schemaVersion
      && claims.domain === challenge.domain
      && (claims.requiredClaimProfile ?? 'legacy-v1')
        === (challenge.requiredClaimProfile ?? 'legacy-v1')
      && claims.audience === challenge.audience
      && claims.verifierInstanceId === challenge.verifierInstanceId
      && claims.sequence === challenge.sequence
      && claims.nonceBase64Url === challenge.nonceBase64Url
      && claims.runId === challenge.runId
      && claims.keyId === challenge.keyId
      && claims.bindingId === challenge.bindingId
      && claims.targetBindingSha256 === challenge.targetBindingSha256
      && JSON.stringify(claims.provider) === JSON.stringify(challenge.provider)
      && claims.trustStoreId === challenge.trustStoreId
      && claims.trustStoreVersion === challenge.trustStoreVersion
      && claims.trustStoreSha256 === challenge.trustStoreSha256
      && claims.issuedAtMs === challenge.issuedAtMs
      && claims.expiresAtMs === challenge.expiresAtMs
    if (!exactChallengeFields) throw new Error('Signed provider claim does not match challenge')
    const envelopeProfile = envelope.schemaVersion === 1 ? 'legacy-v1' : envelope.profile
    if (envelopeProfile !== (challenge.requiredClaimProfile ?? 'legacy-v1')) {
      throw new Error('Signed provider claim profile does not match challenge requirement')
    }
    if (
      claims.observedAtMs < challenge.issuedAtMs
      || claims.observedAtMs > challenge.expiresAtMs
      || claims.observedAtMs > wallNow
    ) throw new Error('Signed provider claim observation time is outside the fresh challenge window')

    if (
      challenge.trustStoreId !== this.trustStore.trustStoreId
      || challenge.trustStoreVersion !== this.trustStore.trustStoreVersion
      || challenge.trustStoreSha256 !== this.trustStore.trustStoreSha256
    ) throw new Error('Challenge trust store does not match local verifier policy')
    const expectedArtifacts = pending.expectedBinding.artifacts
    const claimedArtifacts = validateArtifactTargetBinding({
      ...pending.expectedBinding,
      artifacts: claims.loadedArtifacts
    }).artifacts
    if (JSON.stringify(claimedArtifacts) !== JSON.stringify(expectedArtifacts)) {
      throw new Error('Signed provider claim loaded artifacts do not exactly match expected binding')
    }

    const signature = Buffer.from(envelope.signatureBase64Url, 'base64url')
    try {
      verifyCanonicalSignedProviderClaimSignature({
        trustStore: this.trustStore,
        verificationTimeMs: wallNow,
        signedContent: envelope.schemaVersion === 1
          ? { schemaVersion: 1, claims }
          : {
              schemaVersion: 2,
              profile: envelope.profile,
              claims,
              jvmArtifactObservation: envelope.jvmArtifactObservation
            },
        signature
      })
    } catch (error) {
      if (!(error instanceof CanonicalSignatureInvalidError)) throw error
      if (this.challengeStore) {
        this.challengeStore.recordInvalidAttempt(
          challenge.challengeId,
          this.wallNow,
          this.maxInvalidAttempts
        )
      } else {
        if (!localPending) throw new Error('Local challenge state is unavailable')
        localPending.invalidAttempts += 1
        if (localPending.invalidAttempts >= this.maxInvalidAttempts) this.pending.delete(challenge.challengeId)
      }
      throw new Error('Signed provider claim signature is invalid')
    }
    let observationBinding: SignedProviderClaimVerification['observationBinding']
    if (envelope.schemaVersion === 2) {
      const assessment = assessJvmArtifactObservationAgainstBinding(
        envelope.jvmArtifactObservation,
        pending.expectedBinding
      )
      if (
        assessment.status !== 'TARGET_FILE_MATCH_NON_AUTHORITATIVE'
        || assessment.artifact.role !== 'candidate'
      ) {
        throw new Error('Signed provider JVM candidate observation does not exactly match target binding')
      }
      observationBinding = Object.freeze({
        status: assessment.status,
        authoritative: false,
        provesLoadedBytecode: false,
        releaseEligible: false,
        role: assessment.artifact.role,
        logicalId: assessment.artifact.logicalId,
        logicalPath: assessment.artifact.logicalPath,
        observationSha256: assessment.observationSha256,
        codeSourceUriFingerprint: assessment.codeSourceUriFingerprint,
        codeSourceFileSha256: assessment.codeSourceFileSha256,
        internalEntryConsistency: assessment.internalEntryConsistency,
        observedAtMs: claims.observedAtMs,
        observationTimeAttested: 'self-asserted-by-signer',
        observationFreshness: 'not-established',
        limitations: assessment.limitations
      })
    }
    if (this.challengeStore) {
      if (!this.challengeStore.consume(challenge.challengeId, this.wallNow)) {
        throw new Error('Signed provider challenge is unavailable, consumed, or replayed')
      }
    } else {
      this.pending.delete(challenge.challengeId)
    }
    return Object.freeze({
      schemaVersion: 1,
      signatureValid: true,
      configuredKeyMatch: true,
      claimFreshness: 'fresh',
      nonceConsumed: true,
      trustDecision: 'ACCEPTED_NON_RELEASE',
      evidenceGrade: 'artifact-bound',
      releaseEligible: false,
      trustStoreId: challenge.trustStoreId,
      trustStoreVersion: challenge.trustStoreVersion,
      trustStoreSha256: challenge.trustStoreSha256,
      keyId: challenge.keyId,
      runId: challenge.runId,
      bindingId: challenge.bindingId,
      targetBindingSha256: challenge.targetBindingSha256,
      provider: Object.freeze({ ...challenge.provider }),
      claimedServerInstanceId: claims.claimedServerInstanceId,
      claimedBootId: claims.claimedBootId,
      ...(observationBinding ? { observationBinding } : {})
    })
  }

  private pruneExpired(monotonicNow: number, wallNow: number): void {
    for (const [challengeId, pending] of this.pending) {
      if (
        monotonicNow >= pending.expiresMonotonicMs
        || wallNow >= pending.challenge.expiresAtMs
      ) this.pending.delete(challengeId)
    }
  }
}
