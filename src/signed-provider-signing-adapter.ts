import {
  assertSignedProviderClaimTrustStoreSnapshot,
  canonicalSignedProviderObservationBoundClaimV2,
  verifyCanonicalSignedProviderClaimSignature,
  type SignedProviderClaimTrustKey,
  type SignedProviderClaimTrustStore
} from './signed-provider-claim.js'
import {
  parseSignedProviderCanonicalContent,
  type SignedProviderClaimEnvelopeV2,
  type SignedProviderClaims
} from './signed-provider-claim-schema.js'
import type { JvmArtifactObservationV1 } from './jvm-artifact-observation.js'

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/
const CREDENTIAL_OR_PATH = /(password|passwd|secret|token|credential|api[_-]?key|bearer|[\\/])/i
const MAX_TIMEOUT_MS = 60_000
const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  'byteLength'
)?.get

export interface OpaqueSignerDescriptor {
  readonly keyId: string
  readonly provider: SignedProviderClaimTrustKey['provider']
  readonly opaqueKeyHandleId: string
}

export interface OpaqueSignRequest {
  readonly canonicalPayload: Uint8Array
  readonly opaqueKeyHandleId: string
  readonly signal: AbortSignal
}

export type OpaqueSignCallback = (
  request: Readonly<OpaqueSignRequest>
) => Uint8Array | Promise<Uint8Array>

export interface ObservationBoundEnvelopeInput {
  readonly claims: SignedProviderClaims
  readonly jvmArtifactObservation: JvmArtifactObservationV1
}

export interface SignedProviderOpaqueSigningAdapterOptions {
  readonly trustStore: SignedProviderClaimTrustStore
  readonly descriptor: OpaqueSignerDescriptor
  readonly signer: OpaqueSignCallback
  readonly timeoutMs: number
  readonly wallNowMs?: () => number
}

interface SigningOperationState {
  callbackStarted: boolean
  callbackSettled: boolean
  outerSettled: boolean
}

function sameProvider(
  left: SignedProviderClaimTrustKey['provider'],
  right: SignedProviderClaimTrustKey['provider']
): boolean {
  return left.kind === right.kind
    && left.id === right.id
    && left.version === right.version
    && left.instanceId === right.instanceId
}

function safeNow(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Signing verification time is invalid')
  return value
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
    throw new Error('Opaque signer returned an invalid signature')
  }
}

function validateDescriptor(input: OpaqueSignerDescriptor): Readonly<OpaqueSignerDescriptor> {
  if (!input || typeof input !== 'object') throw new Error('Opaque signer descriptor is invalid')
  const descriptorKeys = Object.keys(input).sort()
  if (descriptorKeys.join(',') !== 'keyId,opaqueKeyHandleId,provider') {
    throw new Error('Opaque signer descriptor is not strict')
  }
  const keyId = input.keyId
  const providerInput = input.provider
  const opaqueKeyHandleId = input.opaqueKeyHandleId
  if (!/^[a-f0-9]{64}$/.test(keyId)) throw new Error('Opaque signer key ID is invalid')
  if (!providerInput || typeof providerInput !== 'object') throw new Error('Opaque signer provider is invalid')
  const providerKeys = Object.keys(providerInput).sort()
  const kind = providerInput.kind
  const id = providerInput.id
  const version = providerInput.version
  const instanceId = providerInput.instanceId
  const expectedProviderKeys = instanceId === undefined
    ? 'id,kind,version'
    : 'id,instanceId,kind,version'
  if (providerKeys.join(',') !== expectedProviderKeys) {
    throw new Error('Opaque signer provider is not strict')
  }
  if (!SAFE_ID.test(opaqueKeyHandleId)
    || opaqueKeyHandleId !== opaqueKeyHandleId.normalize('NFC')
    || CREDENTIAL_OR_PATH.test(opaqueKeyHandleId)) {
    throw new Error('Opaque key handle ID is invalid')
  }
  return Object.freeze({
    keyId,
    provider: Object.freeze({ kind, id, version, ...(instanceId === undefined ? {} : { instanceId }) }),
    opaqueKeyHandleId
  })
}

export class SignedProviderOpaqueSigningAdapter {
  private readonly trustStore: SignedProviderClaimTrustStore
  private readonly descriptor: Readonly<OpaqueSignerDescriptor>
  private readonly signer: OpaqueSignCallback
  private readonly timeoutMs: number
  private readonly wallNowMs: () => number
  private activeOperation: SigningOperationState | undefined

  constructor(options: SignedProviderOpaqueSigningAdapterOptions) {
    if (!options || typeof options !== 'object') throw new Error('Opaque signing adapter options are invalid')
    if (typeof options.signer !== 'function') throw new Error('Opaque signer callback is invalid')
    assertSignedProviderClaimTrustStoreSnapshot(options.trustStore)
    if (!Number.isSafeInteger(options.timeoutMs)
      || options.timeoutMs <= 0
      || options.timeoutMs > MAX_TIMEOUT_MS) {
      throw new Error('Opaque signer timeout is invalid')
    }
    this.trustStore = options.trustStore
    this.descriptor = validateDescriptor(options.descriptor)
    this.signer = options.signer
    this.timeoutMs = options.timeoutMs
    this.wallNowMs = options.wallNowMs ?? Date.now
  }

  async createObservationBoundEnvelope(
    input: ObservationBoundEnvelopeInput
  ): Promise<Readonly<SignedProviderClaimEnvelopeV2>> {
    if (this.activeOperation) throw new Error('REENTRANT')
    const operation: SigningOperationState = {
      callbackStarted: false,
      callbackSettled: false,
      outerSettled: false
    }
    this.activeOperation = operation
    try {
      return await this.createObservationBoundEnvelopeInternal(input, operation)
    } finally {
      operation.outerSettled = true
      this.releaseOperationIfSettled(operation)
    }
  }

  private async createObservationBoundEnvelopeInternal(
    input: ObservationBoundEnvelopeInput,
    operation: SigningOperationState
  ): Promise<Readonly<SignedProviderClaimEnvelopeV2>> {
    const signedContent = parseSignedProviderCanonicalContent({
      schemaVersion: 2,
      profile: 'jvm-observation-bound-v2',
      claims: input?.claims,
      jvmArtifactObservation: input?.jvmArtifactObservation
    })
    if (signedContent.schemaVersion !== 2) throw new Error('Observation-bound signed content is required')

    const key = this.trustStore.keys.find(candidate => candidate.keyId === this.descriptor.keyId)
    if (!key) throw new Error('Opaque signer key is unavailable')
    if (!sameProvider(key.provider, this.descriptor.provider)
      || signedContent.claims.keyId !== this.descriptor.keyId
      || !sameProvider(signedContent.claims.provider, this.descriptor.provider)) {
      throw new Error('Opaque signer descriptor does not match signed claims')
    }
    if (signedContent.claims.trustStoreId !== this.trustStore.trustStoreId
      || signedContent.claims.trustStoreVersion !== this.trustStore.trustStoreVersion
      || signedContent.claims.trustStoreSha256 !== this.trustStore.trustStoreSha256) {
      throw new Error('Opaque signer trust store does not match signed claims')
    }
    if (!key.allowedBindings.some(binding =>
      binding.bindingId === signedContent.claims.bindingId
      && binding.targetBindingSha256 === signedContent.claims.targetBindingSha256)) {
      throw new Error('Opaque signer binding is not allowed')
    }

    const verificationTimeMs = safeNow(this.wallNowMs())
    if (verificationTimeMs < key.notBeforeMs || verificationTimeMs >= key.notAfterMs) {
      throw new Error('Opaque signer key is outside its active window')
    }
    const canonicalPayload = canonicalSignedProviderObservationBoundClaimV2({
      claims: signedContent.claims,
      jvmArtifactObservation: signedContent.jvmArtifactObservation
    })
    const controller = new AbortController()
    let timer: NodeJS.Timeout | undefined
    try {
      const request = Object.freeze({
        canonicalPayload: new Uint8Array(canonicalPayload),
        opaqueKeyHandleId: this.descriptor.opaqueKeyHandleId,
        signal: controller.signal
      })
      const callbackResult = Promise.resolve()
        .then(() => this.signer(request))
        .catch(() => { throw new Error('Opaque signer callback failed') })
      operation.callbackStarted = true
      void callbackResult.then(
        () => this.markCallbackSettled(operation),
        () => this.markCallbackSettled(operation)
      )
      const signatureInput = await Promise.race([
        callbackResult,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            const error = new Error('Opaque signer timed out')
            controller.abort(error)
            reject(error)
          }, this.timeoutMs)
        })
      ])
      const signature = copyExactSignature(signatureInput)
      const postCallbackVerificationTimeMs = safeNow(this.wallNowMs())
      if (postCallbackVerificationTimeMs < key.notBeforeMs
        || postCallbackVerificationTimeMs >= key.notAfterMs) {
        throw new Error('Opaque signer key is outside its active window')
      }
      verifyCanonicalSignedProviderClaimSignature({
        trustStore: this.trustStore,
        verificationTimeMs: postCallbackVerificationTimeMs,
        signedContent,
        signature
      })
      return Object.freeze({
        schemaVersion: 2,
        profile: 'jvm-observation-bound-v2',
        claims: signedContent.claims,
        jvmArtifactObservation: signedContent.jvmArtifactObservation,
        signatureBase64Url: signature.toString('base64url')
      })
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private markCallbackSettled(operation: SigningOperationState): void {
    operation.callbackSettled = true
    this.releaseOperationIfSettled(operation)
  }

  private releaseOperationIfSettled(operation: SigningOperationState): void {
    if (this.activeOperation === operation
      && operation.outerSettled
      && (!operation.callbackStarted || operation.callbackSettled)) {
      this.activeOperation = undefined
    }
  }
}
