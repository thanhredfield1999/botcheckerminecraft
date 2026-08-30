import { createHash } from 'node:crypto'
import {
  assessJvmArtifactObservationAgainstBinding,
  parseJvmArtifactObservationV1,
  type JvmArtifactObservationV1
} from './jvm-artifact-observation.js'
import type { SignedProviderClaimChallenge } from './signed-provider-claim.js'
import {
  canonicalSignedProviderChallengeIdentityV1,
  parseSignedProviderCanonicalContent
} from './signed-provider-claim-schema.js'
import { SignedProviderOpaqueSigningAdapter } from './signed-provider-signing-adapter.js'
import {
  artifactTargetBindingSha256,
  validateArtifactTargetBinding,
  type ArtifactTargetBinding
} from './target-binding.js'

const MAX_OBSERVER_TIMEOUT_MS = 60_000

export interface SignedProviderObservationRequest {
  readonly challenge: SignedProviderClaimChallenge
  readonly candidate: Readonly<{
    role: 'candidate'
    logicalId: string
    logicalPath: string
    expectedSha256: string
  }>
  readonly signal: AbortSignal
}

export interface SignedProviderObservationResult {
  readonly observedAtMs: number
  readonly claimedServerInstanceId: string
  readonly claimedBootId: string
  readonly jvmArtifactObservation: JvmArtifactObservationV1
}

export type SignedProviderObservationProvider = (
  request: Readonly<SignedProviderObservationRequest>
) => SignedProviderObservationResult | Promise<SignedProviderObservationResult>

export interface SignedProviderObserverSigningPipelineOptions {
  readonly expectedBinding: ArtifactTargetBinding
  readonly observer: SignedProviderObservationProvider
  readonly signingAdapter: SignedProviderOpaqueSigningAdapter
  readonly observerTimeoutMs: number
  readonly wallNowMs?: () => number
}

export interface SignedProviderObserverSigningOperationOptions {
  readonly signal?: AbortSignal
}

interface ObservationOperationState {
  callbackStarted: boolean
  callbackSettled: boolean
  downstreamStarted: boolean
  downstreamSettled: boolean
  outerSettled: boolean
}

function snapshotBinding(input: ArtifactTargetBinding): ArtifactTargetBinding {
  const binding = validateArtifactTargetBinding(input)
  for (const artifact of binding.artifacts) Object.freeze(artifact)
  Object.freeze(binding.artifacts)
  Object.freeze(binding.provider)
  Object.freeze(binding.authorization.scope)
  Object.freeze(binding.authorization)
  return Object.freeze(binding)
}

function snapshotChallenge(input: SignedProviderClaimChallenge): SignedProviderClaimChallenge {
  const challengeWithoutId = {
    schemaVersion: input.schemaVersion,
    domain: input.domain,
    ...(input.requiredClaimProfile ? { requiredClaimProfile: input.requiredClaimProfile } : {}),
    audience: input.audience,
    verifierInstanceId: input.verifierInstanceId,
    sequence: input.sequence,
    nonceBase64Url: input.nonceBase64Url,
    runId: input.runId,
    keyId: input.keyId,
    bindingId: input.bindingId,
    targetBindingSha256: input.targetBindingSha256,
    provider: { ...input.provider },
    trustStoreId: input.trustStoreId,
    trustStoreVersion: input.trustStoreVersion,
    trustStoreSha256: input.trustStoreSha256,
    issuedAtMs: input.issuedAtMs,
    expiresAtMs: input.expiresAtMs
  }
  const expectedChallengeId = createHash('sha256')
    .update(canonicalSignedProviderChallengeIdentityV1(challengeWithoutId)).digest('hex')
  if (input.challengeId !== expectedChallengeId) throw new Error('Observer challenge identity is invalid')
  return Object.freeze({
    ...challengeWithoutId,
    challengeId: expectedChallengeId,
    provider: Object.freeze({ ...challengeWithoutId.provider })
  })
}

function sameProvider(
  left: SignedProviderClaimChallenge['provider'],
  right: ArtifactTargetBinding['provider']
): boolean {
  return left.kind === right.kind
    && left.id === right.id
    && left.version === right.version
    && left.instanceId === right.instanceId
}

export class SignedProviderObserverSigningPipeline {
  private readonly expectedBinding: ArtifactTargetBinding
  private readonly observer: SignedProviderObservationProvider
  private readonly signingAdapter: SignedProviderOpaqueSigningAdapter
  private readonly observerTimeoutMs: number
  private readonly wallNowMs: () => number
  private activeOperation: ObservationOperationState | undefined

  constructor(options: SignedProviderObserverSigningPipelineOptions) {
    if (!options || typeof options !== 'object') throw new Error('Observer signing pipeline options are invalid')
    const expectedBinding = options.expectedBinding
    const observer = options.observer
    const signingAdapter = options.signingAdapter
    const observerTimeoutMs = options.observerTimeoutMs
    const wallNowMs = options.wallNowMs
    if (typeof observer !== 'function') throw new Error('Observation provider is invalid')
    if (!(signingAdapter instanceof SignedProviderOpaqueSigningAdapter)) {
      throw new Error('Opaque signing adapter is invalid')
    }
    if (!Number.isSafeInteger(observerTimeoutMs)
      || observerTimeoutMs <= 0
      || observerTimeoutMs > MAX_OBSERVER_TIMEOUT_MS) {
      throw new Error('Observation provider timeout is invalid')
    }
    this.expectedBinding = snapshotBinding(expectedBinding)
    if (this.expectedBinding.provider.kind !== 'server-probe') {
      throw new Error('Observer signing pipeline requires a server-probe target')
    }
    if (this.expectedBinding.artifacts.filter(artifact => artifact.role === 'probe').length !== 1) {
      throw new Error('Observer signing pipeline requires exactly one probe artifact')
    }
    this.observer = observer
    this.signingAdapter = signingAdapter
    this.observerTimeoutMs = observerTimeoutMs
    this.wallNowMs = wallNowMs ?? Date.now
  }

  async createObservationBoundEnvelope(
    challengeInput: SignedProviderClaimChallenge,
    options: SignedProviderObserverSigningOperationOptions = {}
  ) {
    if (this.activeOperation) throw new Error('REENTRANT')
    const operation: ObservationOperationState = {
      callbackStarted: false,
      callbackSettled: false,
      downstreamStarted: false,
      downstreamSettled: false,
      outerSettled: false
    }
    this.activeOperation = operation
    try {
      return await this.createObservationBoundEnvelopeInternal(
        challengeInput,
        operation,
        options.signal
      )
    } finally {
      operation.outerSettled = true
      this.releaseOperationIfSettled(operation)
    }
  }

  private async createObservationBoundEnvelopeInternal(
    challengeInput: SignedProviderClaimChallenge,
    operation: ObservationOperationState,
    outerSignal: AbortSignal | undefined
  ) {
    if (outerSignal?.aborted) throw new Error('Observation operation cancelled')
    let challenge: SignedProviderClaimChallenge
    try {
      challenge = snapshotChallenge(challengeInput)
    } catch {
      throw new Error('Observer challenge is invalid')
    }
    const targetBindingSha256 = artifactTargetBindingSha256(this.expectedBinding)
    if (challenge.requiredClaimProfile !== 'jvm-observation-bound-v2'
      || challenge.bindingId !== this.expectedBinding.bindingId
      || challenge.targetBindingSha256 !== targetBindingSha256
      || !sameProvider(challenge.provider, this.expectedBinding.provider)) {
      throw new Error('Observer challenge does not match expected target binding')
    }
    const preObserverWallNow = this.wallNowMs()
    if (outerSignal?.aborted) throw new Error('Observation operation cancelled')
    if (!Number.isSafeInteger(preObserverWallNow)
      || preObserverWallNow < challenge.issuedAtMs
      || preObserverWallNow >= challenge.expiresAtMs) {
      throw new Error('Observer challenge is outside its active window')
    }
    const candidate = this.expectedBinding.artifacts.find(artifact => artifact.role === 'candidate')
    if (!candidate) throw new Error('Observer candidate artifact is unavailable')
    const candidateRequest = Object.freeze({
      role: 'candidate' as const,
      logicalId: candidate.logicalId,
      logicalPath: candidate.logicalPath,
      expectedSha256: candidate.sha256
    })
    const controller = new AbortController()
    let timer: NodeJS.Timeout | undefined
    let cancel: (() => void) | undefined
    try {
      const callbackResult = Promise.resolve()
        .then(() => this.observer(Object.freeze({
          challenge,
          candidate: candidateRequest,
          signal: controller.signal
        })))
        .catch(() => { throw new Error('Observation provider failed') })
      operation.callbackStarted = true
      void callbackResult.then(
        () => this.markCallbackSettled(operation),
        () => this.markCallbackSettled(operation)
      )
      const cancellation = new Promise<never>((_, reject) => {
        if (!outerSignal) return
        cancel = () => {
          const error = new Error('Observation operation cancelled')
          reject(error)
          controller.abort(error)
        }
        outerSignal.addEventListener('abort', cancel, { once: true })
        if (outerSignal.aborted) cancel()
      })
      const observationInput = await Promise.race([
        callbackResult,
        cancellation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            const error = new Error('Observation provider timed out')
            controller.abort(error)
            reject(error)
          }, this.observerTimeoutMs)
        })
      ])
      let observedAtMs: number
      let claimedServerInstanceId: string
      let claimedBootId: string
      let jvmArtifactObservation: JvmArtifactObservationV1
      try {
        observedAtMs = observationInput.observedAtMs
        claimedServerInstanceId = observationInput.claimedServerInstanceId
        claimedBootId = observationInput.claimedBootId
        jvmArtifactObservation = parseJvmArtifactObservationV1(
          observationInput.jvmArtifactObservation
        )
      } catch {
        throw new Error('Observation provider returned an invalid result')
      }
      if (!Number.isSafeInteger(observedAtMs)
        || observedAtMs < challenge.issuedAtMs
        || observedAtMs > challenge.expiresAtMs) {
        throw new Error('Observation time is outside the challenge window')
      }
      const assessment = assessJvmArtifactObservationAgainstBinding(
        jvmArtifactObservation,
        this.expectedBinding
      )
      if (assessment.status !== 'TARGET_FILE_MATCH_NON_AUTHORITATIVE'
        || assessment.artifact.role !== 'candidate') {
        throw new Error('Observed JVM candidate does not match expected target binding')
      }
      const wallNow = this.wallNowMs()
      if (outerSignal?.aborted) throw new Error('Observation operation cancelled')
      if (!Number.isSafeInteger(wallNow)
        || wallNow < challenge.issuedAtMs
        || wallNow >= challenge.expiresAtMs
        || observedAtMs > wallNow) {
        throw new Error('Observer challenge is outside its active window')
      }
      let signedContent: ReturnType<typeof parseSignedProviderCanonicalContent>
      try {
        signedContent = parseSignedProviderCanonicalContent({
          schemaVersion: 2,
          profile: 'jvm-observation-bound-v2',
          claims: {
            ...challenge,
            observedAtMs,
            claimedServerInstanceId,
            claimedBootId,
            loadedArtifacts: this.expectedBinding.artifacts.map(artifact => ({ ...artifact }))
          },
          jvmArtifactObservation
        })
        if (signedContent.schemaVersion !== 2) throw new Error()
      } catch {
        throw new Error('Observation provider returned an invalid result')
      }
      operation.downstreamStarted = true
      try {
        return await this.signingAdapter.createObservationBoundEnvelope(
          {
            claims: {
              ...signedContent.claims,
              provider: { ...signedContent.claims.provider },
              loadedArtifacts: signedContent.claims.loadedArtifacts.map(artifact => ({ ...artifact }))
            },
            jvmArtifactObservation: signedContent.jvmArtifactObservation
          },
          { signal: outerSignal }
        )
      } finally {
        void this.signingAdapter.whenIdle().then(() => {
          operation.downstreamSettled = true
          this.releaseOperationIfSettled(operation)
        })
      }
    } finally {
      if (timer) clearTimeout(timer)
      if (cancel && outerSignal) outerSignal.removeEventListener('abort', cancel)
    }
  }

  private markCallbackSettled(operation: ObservationOperationState): void {
    operation.callbackSettled = true
    this.releaseOperationIfSettled(operation)
  }

  private releaseOperationIfSettled(operation: ObservationOperationState): void {
    if (this.activeOperation === operation
      && operation.outerSettled
      && (!operation.callbackStarted || operation.callbackSettled)
      && (!operation.downstreamStarted || operation.downstreamSettled)) {
      this.activeOperation = undefined
    }
  }
}
