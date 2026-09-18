import { z } from 'zod'
import {
  PaperBukkitOnlinePlayerVerifier,
  type PaperBukkitOnlinePlayerTrustStore
} from './paper-bukkit-online-player-claim.js'
import type { PaperBukkitOnlinePlayerLoopbackClient } from './paper-bukkit-online-player-loopback-client.js'
import { artifactTargetBindingSha256, type ArtifactTargetBinding } from './target-binding.js'

/**
 * Composition duy nhất biến một Paper/Bukkit adapter thành online-player fact đã xác thực.
 *
 * Nó sở hữu một verifier instance, phát challenge cho exact target binding của run, đẩy
 * challenge qua loopback client, rồi `verifyAndConsume` phản hồi đã ký. Chỉ scalar đi ra
 * từ bước consume mới được dùng làm preflight fact — thay cho `onlinePlayers` do caller
 * cung cấp trước đây (audit BC-002).
 *
 * Nonclaims giữ nguyên: kết quả KHÔNG chứng minh custody khóa, danh tính process/JVM,
 * clock đáng tin, hay release eligibility. Nó chỉ chứng minh rằng một khoá đã pin trong
 * trust store đã ký đúng challenge này, một lần.
 */

export interface PaperBukkitOnlinePlayerVerifiedObservation {
  readonly schemaVersion: 1
  readonly onlinePlayers: number
  readonly signatureVerified: true
  readonly nonceConsumed: true
  readonly claimedServerInstanceId: string
  readonly claimedBootId: string
  readonly targetBindingSha256: string
  readonly releaseEligible: false
}

export interface PaperBukkitOnlinePlayerPreflightFacts {
  readonly schemaVersion: number
  readonly onlinePlayers: number
  readonly onlinePlayersFactSource: 'verified-signed-claim'
  readonly authorizationId: string
  readonly requiredScope: readonly string[]
}

export interface PaperBukkitOnlinePlayerVerifiedOnlinePlayerSource {
  observe(
    runId: string,
    signal: AbortSignal
  ): Promise<PaperBukkitOnlinePlayerVerifiedObservation>
  /**
   * Xác nhận một envelope đã được dùng đúng một lần: lần verify thứ hai trên cùng
   * envelope phải bị từ chối (nonce đã consume). Ném lỗi sanitized nếu chưa có
   * observation nào trước đó.
   */
  replayAttemptRejected(): boolean
  toPreflightFacts(
    observation: PaperBukkitOnlinePlayerVerifiedObservation,
    remainingFacts: unknown
  ): PaperBukkitOnlinePlayerPreflightFacts
}

export interface PaperBukkitOnlinePlayerVerifiedOnlinePlayerSourceOptions {
  readonly trustStore: PaperBukkitOnlinePlayerTrustStore
  readonly audience: string
  readonly verifierInstanceId: string
  readonly keyId: string
  readonly targetBinding: ArtifactTargetBinding
  readonly challengeTtlMs: number
  readonly loopbackClient: PaperBukkitOnlinePlayerLoopbackClient
  readonly wallNowMs?: () => number
  readonly monotonicNowMs?: () => number
  readonly randomBytes?: (size: number) => Uint8Array
  readonly maxPending?: number
}

const remainingFactsSchema = z.strictObject({
  schemaVersion: z.number().int().positive(),
  authorizationId: z.string().min(1).max(128),
  requiredScope: z.array(z.string().min(1).max(128)).min(1).max(32)
})

export function createPaperBukkitOnlinePlayerVerifiedOnlinePlayerSource(
  options: PaperBukkitOnlinePlayerVerifiedOnlinePlayerSourceOptions
): PaperBukkitOnlinePlayerVerifiedOnlinePlayerSource {
  const verifier = new PaperBukkitOnlinePlayerVerifier({
    trustStore: options.trustStore,
    audience: options.audience,
    verifierInstanceId: options.verifierInstanceId,
    ...(options.wallNowMs ? { wallNowMs: options.wallNowMs } : {}),
    ...(options.monotonicNowMs ? { monotonicNowMs: options.monotonicNowMs } : {}),
    ...(options.randomBytes ? { randomBytes: options.randomBytes } : {}),
    ...(options.maxPending !== undefined ? { maxPending: options.maxPending } : {})
  })
  const expectedTargetBindingSha256 = artifactTargetBindingSha256(options.targetBinding)
  let lastEnvelope: Awaited<ReturnType<PaperBukkitOnlinePlayerLoopbackClient['request']>> | undefined

  return Object.freeze({
    async observe(runId: string, signal: AbortSignal) {
      try {
        const challenge = verifier.issueChallenge({
          runId,
          expectedBinding: options.targetBinding,
          keyId: options.keyId,
          ttlMs: options.challengeTtlMs
        })
        const envelope = await options.loopbackClient.request(challenge, signal)
        const verified = verifier.verifyAndConsume(envelope)
        if (verified.targetBindingSha256 !== expectedTargetBindingSha256) throw new Error()
        lastEnvelope = envelope
        return Object.freeze({
          schemaVersion: 1 as const,
          onlinePlayers: verified.onlinePlayers,
          signatureVerified: true as const,
          nonceConsumed: true as const,
          claimedServerInstanceId: verified.claimedServerInstanceId,
          claimedBootId: verified.claimedBootId,
          targetBindingSha256: verified.targetBindingSha256,
          releaseEligible: false as const
        })
      } catch {
        // Sanitize: không để chi tiết transport/verifier rò ra ngoài biên tin cậy.
        throw new Error('Paper Bukkit online-player observation failed')
      }
    },

    replayAttemptRejected() {
      if (lastEnvelope === undefined) {
        throw new Error('Paper Bukkit replay probe requires a prior observation')
      }
      try {
        verifier.verifyAndConsume(lastEnvelope)
        return false
      } catch {
        return true
      }
    },

    toPreflightFacts(
      observation: PaperBukkitOnlinePlayerVerifiedObservation,
      remainingFactsInput: unknown
    ) {
      if (typeof remainingFactsInput === 'object' && remainingFactsInput !== null
        && 'onlinePlayers' in remainingFactsInput) {
        throw new Error(
          'Paper Bukkit caller-supplied online-player fact is not allowed')
      }
      const remainingFacts = remainingFactsSchema.parse(remainingFactsInput)
      if (observation.signatureVerified !== true || observation.nonceConsumed !== true) {
        throw new Error('Paper Bukkit online-player observation is unverified')
      }
      return Object.freeze({
        schemaVersion: remainingFacts.schemaVersion,
        onlinePlayers: observation.onlinePlayers,
        onlinePlayersFactSource: 'verified-signed-claim' as const,
        authorizationId: remainingFacts.authorizationId,
        requiredScope: Object.freeze([...remainingFacts.requiredScope])
      })
    }
  })
}
