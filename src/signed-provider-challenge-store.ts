import { createHash } from 'node:crypto'
import { closeSync, lstatSync, openSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import type { SignedProviderClaimChallenge } from './signed-provider-claim.js'
import { canonicalSignedProviderChallengeIdentityV1 } from './signed-provider-claim-schema.js'
import {
  artifactTargetBindingSha256,
  validateArtifactTargetBinding,
  type ArtifactTargetBinding
} from './target-binding.js'

const STORE_SCHEMA_VERSION = 1
const CLAIM_DOMAIN = 'botcheckerminecraft.signed-provider-claim.v1'
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/
const SAFE_VERSION = /^[a-zA-Z0-9][a-zA-Z0-9._:+-]{0,127}$/
const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key|bearer)/i
const MAX_PENDING_CHALLENGES = 1024
const PRIVATE_FILE_MODE = 0o600
const PRIVATE_DIRECTORY_FORBIDDEN_MODE = 0o022
const MINIMUM_NODE_VERSION = Object.freeze([22, 18, 0] as const)

export type SignedProviderWallClock = () => number

const safeIdentifier = (label: string) => z.string().min(1).max(128).regex(SAFE_ID)
  .refine(value => value === value.normalize('NFC'), `${label} must be NFC normalized`)
  .refine(value => !CREDENTIAL_PATTERN.test(value), `Credential-like ${label} rejected`)

const providerSchema = z.strictObject({
  kind: z.literal('server-probe'),
  id: safeIdentifier('provider ID'),
  version: z.string().min(1).max(128).regex(SAFE_VERSION)
    .refine(value => value === value.normalize('NFC'), 'Provider version must be NFC normalized')
    .refine(value => !CREDENTIAL_PATTERN.test(value), 'Credential-like provider version rejected'),
  instanceId: safeIdentifier('provider instance ID').optional()
})

const challengeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  domain: z.literal(CLAIM_DOMAIN),
  requiredClaimProfile: z.literal('jvm-observation-bound-v2').optional(),
  audience: safeIdentifier('audience'),
  verifierInstanceId: safeIdentifier('verifier instance ID'),
  sequence: z.number().int().safe().positive(),
  challengeId: z.string().regex(SHA256_PATTERN),
  nonceBase64Url: z.string().min(43).max(43).refine(value => {
    const decoded = Buffer.from(value, 'base64url')
    return decoded.byteLength === 32 && decoded.toString('base64url') === value
  }, 'Challenge nonce must be canonical 32-byte base64url'),
  runId: safeIdentifier('run ID'),
  keyId: z.string().regex(SHA256_PATTERN),
  bindingId: safeIdentifier('binding ID'),
  targetBindingSha256: z.string().regex(SHA256_PATTERN),
  provider: providerSchema,
  trustStoreId: safeIdentifier('trust store ID'),
  trustStoreVersion: z.string().min(1).max(128).regex(SAFE_VERSION)
    .refine(value => !CREDENTIAL_PATTERN.test(value), 'Credential-like trust store version rejected'),
  trustStoreSha256: z.string().regex(SHA256_PATTERN),
  issuedAtMs: z.number().int().safe().nonnegative(),
  expiresAtMs: z.number().int().safe().positive()
}).superRefine((value, context) => {
  if (value.expiresAtMs <= value.issuedAtMs) {
    context.addIssue({ code: 'custom', path: ['expiresAtMs'], message: 'Challenge expiry is invalid' })
  }
})

export interface StoredSignedProviderChallengeInput {
  readonly challenge: SignedProviderClaimChallenge
  readonly expectedBinding: ArtifactTargetBinding
}

export interface StoredSignedProviderChallenge extends StoredSignedProviderChallengeInput {
  readonly invalidAttempts: number
}

export interface SqliteSignedProviderChallengeStoreOptions {
  readonly databasePath: string
  readonly audience: string
  readonly verifierInstanceId: string
  readonly busyTimeoutMs?: number
  readonly rateLimitWindowMs?: number
  readonly maxIssuesPerKeyProviderPerWindow?: number
  readonly maxInvalidAttemptsPerKeyProviderPerWindow?: number
  readonly maxRateLimitSubjectsPerScope?: number
  readonly maxScopes?: number
  readonly scopeRetentionMs?: number
  readonly maxClockSkewMs?: number
  readonly trustedWallNowMs?: SignedProviderWallClock
}

export interface SignedProviderChallengeStore {
  readonly audience: string
  readonly verifierInstanceId: string
  configureVerifierPolicy(
    maxPending: number,
    maxInvalidAttempts: number,
    trustStoreSha256: string,
    wallNowMs: SignedProviderWallClock
  ): void
  issue(input: {
    readonly wallNowMs: SignedProviderWallClock
    readonly maxPending: number
    readonly build: (sequence: number, wallNowMs: number) => StoredSignedProviderChallengeInput
  }): StoredSignedProviderChallenge
  load(challengeId: string, wallNowMs: SignedProviderWallClock): StoredSignedProviderChallenge | undefined
  consume(challengeId: string, wallNowMs: SignedProviderWallClock): StoredSignedProviderChallenge | undefined
  recordInvalidAttempt(
    challengeId: string,
    wallNowMs: SignedProviderWallClock,
    maxInvalidAttempts: number
  ): 'retained' | 'burned' | 'unavailable'
  close(): void
}

interface ScopeRow {
  audience: string
  verifier_instance_id: string
  sequence: number
  last_wall_ms: number
  rate_limit_window_ms: number
  max_issues_per_window: number
  max_invalid_attempts_per_window: number
  max_rate_limit_subjects: number
  max_pending: number | null
  max_invalid_attempts: number | null
  trust_store_sha256: string | null
}

interface SequenceRow {
  sequence: number
}

interface ChallengeRow {
  challenge_json: string
  binding_json: string
  invalid_attempts: number
}

interface RateLimitRow {
  window_start_ms: number
  issue_count: number
  invalid_attempt_count: number
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function safeWallNow(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Wall clock must be a nonnegative safe integer')
  return value
}

function assertSupportedNodeRuntime(): void {
  const parts = process.versions.node.split('.').map(part => Number.parseInt(part, 10))
  if (parts.length < 3 || parts.some(part => !Number.isSafeInteger(part) || part < 0)) {
    throw new Error('Unable to validate Node.js runtime version for shared challenge state')
  }
  const [major = 0, minor = 0, patch = 0] = parts
  const [minimumMajor, minimumMinor, minimumPatch] = MINIMUM_NODE_VERSION
  const supported = major > minimumMajor
    || (major === minimumMajor && (
      minor > minimumMinor
      || (minor === minimumMinor && patch >= minimumPatch)
    ))
  if (!supported) throw new Error('Shared challenge state requires Node.js 22.18.0 or newer')
}

function parseStored(
  input: StoredSignedProviderChallengeInput,
  audience: string,
  verifierInstanceId: string,
  expectedSequence?: number
): StoredSignedProviderChallengeInput {
  const parsed = challengeSchema.parse(input.challenge)
  if (parsed.audience !== audience || parsed.verifierInstanceId !== verifierInstanceId) {
    throw new Error('Challenge does not belong to this shared store scope')
  }
  if (expectedSequence !== undefined && parsed.sequence !== expectedSequence) {
    throw new Error('Challenge sequence does not match shared sequence')
  }
  const expectedBinding = validateArtifactTargetBinding(input.expectedBinding)
  if (
    parsed.bindingId !== expectedBinding.bindingId
    || parsed.targetBindingSha256 !== artifactTargetBindingSha256(expectedBinding)
  ) throw new Error('Challenge target binding does not match stored binding')
  const { challengeId: _omitted, ...withoutId } = parsed
  if (createHash('sha256').update(canonicalSignedProviderChallengeIdentityV1(withoutId)).digest('hex')
    !== parsed.challengeId) {
    throw new Error('Challenge identity does not match canonical challenge content')
  }
  return {
    challenge: Object.freeze({ ...parsed, provider: Object.freeze({ ...parsed.provider }) }),
    expectedBinding
  }
}

export class SqliteSignedProviderChallengeStore implements SignedProviderChallengeStore {
  private readonly database: DatabaseSync
  readonly audience: string
  readonly verifierInstanceId: string
  private readonly scopeId: string
  private readonly rateLimitWindowMs: number
  private readonly maxIssuesPerWindow: number
  private readonly maxInvalidAttemptsPerWindow: number
  private readonly maxRateLimitSubjects: number
  private readonly maxScopes: number
  private readonly scopeRetentionMs: number
  private readonly maxClockSkewMs: number
  private readonly trustedWallNow: SignedProviderWallClock
  private readonly busyTimeoutMs: number
  private lastWallMs: number | undefined
  private transactionActive = false
  private verifierPolicyConfigured = false
  private closed = false

  constructor(options: SqliteSignedProviderChallengeStoreOptions) {
    assertSupportedNodeRuntime()
    if (!path.isAbsolute(options.databasePath) || options.databasePath.includes('\u0000')) {
      throw new Error('Shared challenge database path must be absolute')
    }
    this.audience = safeIdentifier('audience').parse(options.audience)
    this.verifierInstanceId = safeIdentifier('verifier instance ID').parse(options.verifierInstanceId)
    this.scopeId = sha256(JSON.stringify({
      schemaVersion: 1,
      audience: this.audience,
      verifierInstanceId: this.verifierInstanceId
    }))
    this.busyTimeoutMs = z.number().int().min(0).max(30_000)
      .parse(options.busyTimeoutMs ?? 5_000)
    this.rateLimitWindowMs = z.number().int().min(100).max(3_600_000)
      .parse(options.rateLimitWindowMs ?? 60_000)
    this.maxIssuesPerWindow = z.number().int().min(1).max(10_000)
      .parse(options.maxIssuesPerKeyProviderPerWindow ?? 64)
    this.maxInvalidAttemptsPerWindow = z.number().int().min(1).max(10_000)
      .parse(options.maxInvalidAttemptsPerKeyProviderPerWindow ?? 64)
    this.maxRateLimitSubjects = z.number().int().min(1).max(1_024)
      .parse(options.maxRateLimitSubjectsPerScope ?? 64)
    this.maxScopes = z.number().int().min(1).max(4_096).parse(options.maxScopes ?? 256)
    this.scopeRetentionMs = z.number().int().min(100).max(86_400_000)
      .parse(options.scopeRetentionMs ?? 3_600_000)
    this.maxClockSkewMs = z.number().int().min(1).max(86_400_000)
      .parse(options.maxClockSkewMs ?? 60_000)
    this.trustedWallNow = options.trustedWallNowMs ?? Date.now
    this.prepareDatabasePath(options.databasePath)
    this.database = new DatabaseSync(options.databasePath, {
      timeout: this.busyTimeoutMs,
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true
    })
    try {
      if (typeof (this.database as unknown as { isTransaction?: unknown }).isTransaction !== 'boolean') {
        throw new Error('Node.js SQLite transaction state capability is unavailable')
      }
      this.initialize()
      this.validateStorePolicy()
      this.validateExistingScopePolicy()
    } catch (error) {
      this.database.close()
      this.closed = true
      throw error
    }
  }

  configureVerifierPolicy(
    maxPendingInput: number,
    maxInvalidAttemptsInput: number,
    trustStoreSha256Input: string,
    wallClock: SignedProviderWallClock
  ): void {
    this.ensureOpen()
    const maxPending = z.number().int().min(1).max(MAX_PENDING_CHALLENGES).parse(maxPendingInput)
    const maxInvalidAttempts = z.number().int().min(1).max(64).parse(maxInvalidAttemptsInput)
    const trustStoreSha256 = z.string().regex(SHA256_PATTERN).parse(trustStoreSha256Input)
    this.immediateTransaction(() => {
      const wallNowMs = safeWallNow(wallClock())
      this.validateTrustedClock(wallNowMs)
      const existing = this.database.prepare(`SELECT 1 AS present
        FROM signed_provider_scopes WHERE scope_id = ?`).get(this.scopeId)
      const retired = this.database.prepare(`SELECT 1 AS present
        FROM signed_provider_retired_scopes WHERE scope_id = ?`).get(this.scopeId)
      if (retired) throw new Error('Shared challenge verifier scope is retired')
      if (!existing) {
        this.enforceScopeCapacity()
        this.database.prepare(`INSERT INTO signed_provider_scopes
          (scope_id, audience, verifier_instance_id, sequence, last_wall_ms,
           rate_limit_window_ms, max_issues_per_window, max_invalid_attempts_per_window,
           max_rate_limit_subjects, max_pending, max_invalid_attempts, trust_store_sha256)
          VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(
            this.scopeId,
            this.audience,
            this.verifierInstanceId,
            wallNowMs,
            this.rateLimitWindowMs,
            this.maxIssuesPerWindow,
            this.maxInvalidAttemptsPerWindow,
            this.maxRateLimitSubjects,
            maxPending,
            maxInvalidAttempts,
            trustStoreSha256
          )
      }
      this.readScope()
      this.pinScopeLimit('max_pending', maxPending)
      this.pinScopeLimit('max_invalid_attempts', maxInvalidAttempts)
      this.pinTrustStore(trustStoreSha256)
    })
    this.verifierPolicyConfigured = true
  }

  issue(input: {
    readonly wallNowMs: SignedProviderWallClock
    readonly maxPending: number
    readonly build: (sequence: number, wallNowMs: number) => StoredSignedProviderChallengeInput
  }): StoredSignedProviderChallenge {
    this.ensureOpen()
    const maxPending = z.number().int().min(1).max(MAX_PENDING_CHALLENGES).parse(input.maxPending)
    return this.wallClockTransaction(input.wallNowMs, wallNow => {
      this.database.prepare(`DELETE FROM signed_provider_challenges
        WHERE scope_id = ? AND expires_at_ms <= ?`).run(this.scopeId, wallNow)
      const count = this.database.prepare(`SELECT COUNT(*) AS count
        FROM signed_provider_challenges WHERE scope_id = ?`).get(this.scopeId) as { count: number }
      if (count.count >= maxPending) throw new Error('Signed provider challenge capacity exhausted')
      const scope = this.database.prepare(`SELECT sequence FROM signed_provider_scopes
        WHERE scope_id = ?`).get(this.scopeId) as SequenceRow | undefined
      if (!scope || !Number.isSafeInteger(scope.sequence) || scope.sequence < 0) {
        throw new Error('Shared challenge sequence state is invalid')
      }
      if (scope.sequence >= Number.MAX_SAFE_INTEGER) throw new Error('Challenge sequence exhausted')
      const nextSequence = scope.sequence + 1
      const stored = parseStored(
        input.build(nextSequence, wallNow),
        this.audience,
        this.verifierInstanceId,
        nextSequence
      )
      if (stored.challenge.issuedAtMs !== wallNow) {
        throw new Error('Challenge issue time does not match locked store clock')
      }
      this.recordRateLimit(stored.challenge, wallNow, 'issue')
      this.database.prepare(`UPDATE signed_provider_scopes SET sequence = ? WHERE scope_id = ?`)
        .run(nextSequence, this.scopeId)
      this.database.prepare(`INSERT INTO signed_provider_challenges
        (challenge_id, scope_id, sequence, challenge_json, binding_json,
         issued_at_ms, expires_at_ms, invalid_attempts)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)`)
        .run(
          stored.challenge.challengeId,
          this.scopeId,
          nextSequence,
          JSON.stringify(stored.challenge),
          JSON.stringify(stored.expectedBinding),
          stored.challenge.issuedAtMs,
          stored.challenge.expiresAtMs
        )
      return Object.freeze({ ...stored, invalidAttempts: 0 })
    }, () => this.pinScopeLimit('max_pending', maxPending))
  }

  load(
    challengeIdInput: string,
    wallClock: SignedProviderWallClock
  ): StoredSignedProviderChallenge | undefined {
    this.ensureOpen()
    const challengeId = z.string().regex(SHA256_PATTERN).parse(challengeIdInput)
    return this.wallClockTransaction(
      wallClock,
      wallNow => this.loadCurrent(challengeId, wallNow)
    )
  }

  recordInvalidAttempt(
    challengeIdInput: string,
    wallClock: SignedProviderWallClock,
    maxInvalidAttemptsInput: number
  ): 'retained' | 'burned' | 'unavailable' {
    this.ensureOpen()
    const challengeId = z.string().regex(SHA256_PATTERN).parse(challengeIdInput)
    const maxInvalidAttempts = z.number().int().min(1).max(64).parse(maxInvalidAttemptsInput)
    return this.wallClockTransaction(wallClock, wallNow => {
      const stored = this.loadCurrent(challengeId, wallNow)
      if (!stored) return 'unavailable'
      this.recordRateLimit(stored.challenge, wallNow, 'invalid')
      const nextAttempts = stored.invalidAttempts + 1
      if (nextAttempts >= maxInvalidAttempts) {
        const deleted = this.database.prepare(`DELETE FROM signed_provider_challenges
          WHERE challenge_id = ? AND scope_id = ? AND invalid_attempts = ?`)
          .run(challengeId, this.scopeId, stored.invalidAttempts)
        if (Number(deleted.changes) !== 1) throw new Error('Shared invalid-attempt burn lost ownership')
        return 'burned'
      }
      const updated = this.database.prepare(`UPDATE signed_provider_challenges
        SET invalid_attempts = ?
        WHERE challenge_id = ? AND scope_id = ? AND invalid_attempts = ?`)
        .run(nextAttempts, challengeId, this.scopeId, stored.invalidAttempts)
      if (Number(updated.changes) !== 1) throw new Error('Shared invalid-attempt update lost ownership')
      return 'retained'
    }, () => this.pinScopeLimit('max_invalid_attempts', maxInvalidAttempts))
  }

  consume(
    challengeIdInput: string,
    wallClock: SignedProviderWallClock
  ): StoredSignedProviderChallenge | undefined {
    this.ensureOpen()
    const challengeId = z.string().regex(SHA256_PATTERN).parse(challengeIdInput)
    return this.wallClockTransaction(wallClock, wallNow => {
      const stored = this.loadCurrent(challengeId, wallNow)
      if (!stored) return undefined
      const result = this.database.prepare(`DELETE FROM signed_provider_challenges
        WHERE challenge_id = ? AND scope_id = ? AND expires_at_ms > ?`)
        .run(challengeId, this.scopeId, wallNow)
      if (Number(result.changes) !== 1) {
        throw new Error('Shared challenge atomic consume lost ownership')
      }
      return stored
    })
  }

  close(): void {
    if (this.closed) return
    this.database.close()
    this.closed = true
  }

  private loadCurrent(
    challengeId: string,
    wallNowMs: number
  ): StoredSignedProviderChallenge | undefined {
    const row = this.database.prepare(`SELECT challenge_json, binding_json, invalid_attempts
      FROM signed_provider_challenges
      WHERE challenge_id = ? AND scope_id = ? AND expires_at_ms > ?`)
      .get(challengeId, this.scopeId, wallNowMs) as ChallengeRow | undefined
    if (!row) return undefined
    if (!Number.isSafeInteger(row.invalid_attempts) || row.invalid_attempts < 0) {
      throw new Error('Stored challenge invalid-attempt state is corrupt')
    }
    let rawChallenge: unknown
    let rawBinding: unknown
    try {
      rawChallenge = JSON.parse(row.challenge_json)
      rawBinding = JSON.parse(row.binding_json)
    } catch {
      throw new Error('Stored challenge JSON is corrupt')
    }
    const stored = parseStored(
      {
        challenge: rawChallenge as SignedProviderClaimChallenge,
        expectedBinding: rawBinding as ArtifactTargetBinding
      },
      this.audience,
      this.verifierInstanceId
    )
    if (stored.challenge.challengeId !== challengeId) throw new Error('Stored challenge key is corrupt')
    return Object.freeze({ ...stored, invalidAttempts: row.invalid_attempts })
  }

  private recordRateLimit(
    challenge: SignedProviderClaimChallenge,
    wallNowMs: number,
    kind: 'issue' | 'invalid'
  ): void {
    const subjectId = sha256(JSON.stringify({
      keyId: challenge.keyId,
      provider: challenge.provider
    }))
    const windowStart = Math.floor(wallNowMs / this.rateLimitWindowMs) * this.rateLimitWindowMs
    const row = this.database.prepare(`SELECT window_start_ms, issue_count, invalid_attempt_count
      FROM signed_provider_rate_limits WHERE scope_id = ? AND subject_id = ?`)
      .get(this.scopeId, subjectId) as RateLimitRow | undefined
    if (!row) {
      const count = this.database.prepare(`SELECT COUNT(*) AS count
        FROM signed_provider_rate_limits WHERE scope_id = ?`).get(this.scopeId) as { count: number }
      if (!Number.isSafeInteger(count.count) || count.count < 0) {
        throw new Error('Shared rate-limit subject count is corrupt')
      }
      if (count.count >= this.maxRateLimitSubjects) {
        throw new Error('Shared rate-limit subject capacity exhausted')
      }
    }
    let issueCount = 0
    let invalidAttemptCount = 0
    if (row && row.window_start_ms === windowStart) {
      if (
        !Number.isSafeInteger(row.issue_count) || row.issue_count < 0
        || !Number.isSafeInteger(row.invalid_attempt_count) || row.invalid_attempt_count < 0
      ) throw new Error('Shared rate-limit state is corrupt')
      issueCount = row.issue_count
      invalidAttemptCount = row.invalid_attempt_count
    }
    if (kind === 'issue') {
      if (issueCount >= this.maxIssuesPerWindow) {
        throw new Error('Signed provider challenge issue rate-limit exceeded')
      }
      issueCount += 1
    } else {
      if (invalidAttemptCount >= this.maxInvalidAttemptsPerWindow) {
        throw new Error('Signed provider invalid-attempt rate-limit exceeded')
      }
      invalidAttemptCount += 1
    }
    this.database.prepare(`INSERT INTO signed_provider_rate_limits
      (scope_id, subject_id, window_start_ms, issue_count, invalid_attempt_count)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(scope_id, subject_id) DO UPDATE SET
        window_start_ms = excluded.window_start_ms,
        issue_count = excluded.issue_count,
        invalid_attempt_count = excluded.invalid_attempt_count`)
      .run(this.scopeId, subjectId, windowStart, issueCount, invalidAttemptCount)
  }

  private prepareDatabasePath(databasePath: string): void {
    const parentPath = path.dirname(databasePath)
    const parent = lstatSync(parentPath)
    if (!parent.isDirectory() || parent.isSymbolicLink()) {
      throw new Error('Shared challenge database parent must be a private regular directory')
    }
    if (process.platform !== 'win32') {
      const uid = process.getuid?.()
      if (uid === undefined || parent.uid !== uid || (parent.mode & PRIVATE_DIRECTORY_FORBIDDEN_MODE) !== 0) {
        throw new Error('Shared challenge database parent permissions or owner are not private')
      }
    }
    let existing
    try {
      existing = lstatSync(databasePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (!existing) {
      const descriptor = openSync(databasePath, 'wx+', PRIVATE_FILE_MODE)
      closeSync(descriptor)
      return
    }
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw new Error('Shared challenge database must be a regular non-symlink file')
    }
    if (process.platform !== 'win32') {
      const uid = process.getuid?.()
      if (
        uid === undefined
        || existing.uid !== uid
        || (existing.mode & 0o777) !== PRIVATE_FILE_MODE
      ) throw new Error('Shared challenge database permissions or owner are not private')
    }
  }

  private initialize(): void {
    this.immediateTransaction(() => {
      const version = this.database.prepare('PRAGMA user_version').get() as { user_version: number }
      if (version.user_version !== 0 && version.user_version !== STORE_SCHEMA_VERSION) {
        throw new Error('Unsupported shared challenge store schema version')
      }
      if (version.user_version === 0) {
        this.database.exec(`
          CREATE TABLE signed_provider_store_policy (
            singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
            max_scopes INTEGER NOT NULL CHECK(max_scopes BETWEEN 1 AND 4096),
            scope_retention_ms INTEGER NOT NULL CHECK(scope_retention_ms BETWEEN 100 AND 86400000),
            max_clock_skew_ms INTEGER NOT NULL CHECK(max_clock_skew_ms BETWEEN 1 AND 86400000)
          ) STRICT;
          CREATE TABLE signed_provider_retired_scopes (
            scope_id TEXT PRIMARY KEY,
            retired_at_ms INTEGER NOT NULL CHECK(retired_at_ms >= 0)
          ) STRICT;
          CREATE TABLE signed_provider_scopes (
            scope_id TEXT PRIMARY KEY,
            audience TEXT NOT NULL,
            verifier_instance_id TEXT NOT NULL,
            sequence INTEGER NOT NULL CHECK(sequence >= 0),
            last_wall_ms INTEGER NOT NULL CHECK(last_wall_ms >= 0),
            rate_limit_window_ms INTEGER NOT NULL CHECK(rate_limit_window_ms > 0),
            max_issues_per_window INTEGER NOT NULL CHECK(max_issues_per_window > 0),
            max_invalid_attempts_per_window INTEGER NOT NULL
              CHECK(max_invalid_attempts_per_window > 0),
            max_rate_limit_subjects INTEGER NOT NULL
              CHECK(max_rate_limit_subjects BETWEEN 1 AND 1024),
            max_pending INTEGER CHECK(max_pending IS NULL OR max_pending BETWEEN 1 AND 1024),
            max_invalid_attempts INTEGER
              CHECK(max_invalid_attempts IS NULL OR max_invalid_attempts BETWEEN 1 AND 64),
            trust_store_sha256 TEXT
              CHECK(trust_store_sha256 IS NULL OR length(trust_store_sha256) = 64)
          ) STRICT;
          CREATE TABLE signed_provider_challenges (
            challenge_id TEXT PRIMARY KEY,
            scope_id TEXT NOT NULL REFERENCES signed_provider_scopes(scope_id) ON DELETE CASCADE,
            sequence INTEGER NOT NULL CHECK(sequence > 0),
            challenge_json TEXT NOT NULL,
            binding_json TEXT NOT NULL,
            issued_at_ms INTEGER NOT NULL CHECK(issued_at_ms >= 0),
            expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms > issued_at_ms),
            invalid_attempts INTEGER NOT NULL DEFAULT 0 CHECK(invalid_attempts >= 0),
            UNIQUE(scope_id, sequence)
          ) STRICT;
          CREATE INDEX signed_provider_challenges_expiry
            ON signed_provider_challenges(scope_id, expires_at_ms);
          CREATE TABLE signed_provider_rate_limits (
            scope_id TEXT NOT NULL REFERENCES signed_provider_scopes(scope_id) ON DELETE CASCADE,
            subject_id TEXT NOT NULL,
            window_start_ms INTEGER NOT NULL CHECK(window_start_ms >= 0),
            issue_count INTEGER NOT NULL CHECK(issue_count >= 0),
            invalid_attempt_count INTEGER NOT NULL CHECK(invalid_attempt_count >= 0),
            PRIMARY KEY(scope_id, subject_id)
          ) STRICT;
          PRAGMA user_version = ${STORE_SCHEMA_VERSION};
        `)
      }
    })
    const journalMode = this.database.prepare('PRAGMA journal_mode = WAL').get() as {
      journal_mode: string
    }
    this.database.exec('PRAGMA synchronous = FULL')
    const synchronous = this.database.prepare('PRAGMA synchronous').get() as {
      synchronous: number
    }
    const busyTimeout = this.database.prepare('PRAGMA busy_timeout').get() as {
      timeout: number
    }
    if (
      journalMode.journal_mode.toLowerCase() !== 'wal'
      || synchronous.synchronous !== 2
      || busyTimeout.timeout !== this.busyTimeoutMs
    ) throw new Error('Shared challenge database runtime policy is unavailable')
  }

  private immediateTransaction<T>(operation: () => T): T {
    if (this.transactionActive) throw new Error('Reentrant shared challenge transaction rejected')
    this.transactionActive = true
    try {
      this.database.exec('BEGIN IMMEDIATE')
      const result = operation()
      this.database.exec('COMMIT')
      return result
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK')
      throw error
    } finally {
      this.transactionActive = false
    }
  }

  private wallClockTransaction<T>(
    wallClock: SignedProviderWallClock,
    operation: (wallNowMs: number) => T,
    preflight?: () => void
  ): T {
    if (this.transactionActive) throw new Error('Reentrant shared challenge transaction rejected')
    this.transactionActive = true
    let businessError: unknown
    try {
      this.database.exec('BEGIN IMMEDIATE')
      const wallNowMs = safeWallNow(wallClock())
      this.validateTrustedClock(wallNowMs)
      if (this.lastWallMs !== undefined && wallNowMs < this.lastWallMs) {
        throw new Error('Store wall clock moved backwards')
      }
      const existingClock = this.database.prepare(`SELECT last_wall_ms
        FROM signed_provider_scopes WHERE scope_id = ?`).get(this.scopeId) as {
        last_wall_ms: number
      } | undefined
      const retired = this.database.prepare(`SELECT 1 AS present
        FROM signed_provider_retired_scopes WHERE scope_id = ?`).get(this.scopeId)
      if (retired) throw new Error('Shared challenge verifier scope is retired')
      if (this.verifierPolicyConfigured && !existingClock) {
        throw new Error('Shared challenge verifier scope was reclaimed and is retired')
      }
      this.lastWallMs = wallNowMs
      this.pruneGlobalState(wallNowMs)
      this.enforceScopeCapacity()
      this.database.prepare(`INSERT INTO signed_provider_scopes
        (scope_id, audience, verifier_instance_id, sequence, last_wall_ms,
         rate_limit_window_ms, max_issues_per_window, max_invalid_attempts_per_window,
         max_rate_limit_subjects)
        VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?) ON CONFLICT(scope_id) DO NOTHING`)
        .run(
          this.scopeId,
          this.audience,
          this.verifierInstanceId,
          wallNowMs,
          this.rateLimitWindowMs,
          this.maxIssuesPerWindow,
          this.maxInvalidAttemptsPerWindow,
          this.maxRateLimitSubjects
        )
      const scope = this.readScope()
      if (wallNowMs < scope.last_wall_ms) {
        throw new Error('Shared operation wall clock is stale')
      }
      if (wallNowMs > scope.last_wall_ms) {
        this.database.prepare(`UPDATE signed_provider_scopes
          SET last_wall_ms = ? WHERE scope_id = ?`).run(wallNowMs, this.scopeId)
      }
      preflight?.()
      this.database.exec('SAVEPOINT signed_provider_business')
      let result: T | undefined
      let businessFailed = false
      try {
        result = operation(wallNowMs)
        this.database.exec('RELEASE signed_provider_business')
      } catch (error) {
        businessFailed = true
        businessError = error
        this.database.exec('ROLLBACK TO signed_provider_business')
        this.database.exec('RELEASE signed_provider_business')
      }
      this.database.exec('COMMIT')
      if (businessFailed) throw businessError
      return result as T
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK')
      throw error
    } finally {
      this.transactionActive = false
    }
  }

  private validateTrustedClock(wallNowMs: number): void {
    const trustedWallNowMs = safeWallNow(this.trustedWallNow())
    if (Math.abs(wallNowMs - trustedWallNowMs) > this.maxClockSkewMs) {
      throw new Error('Store wall clock skew exceeds trusted clock policy')
    }
  }

  private readScope(): ScopeRow {
    const scope = this.database.prepare(`SELECT audience, verifier_instance_id, sequence, last_wall_ms,
        rate_limit_window_ms, max_issues_per_window, max_invalid_attempts_per_window,
        max_rate_limit_subjects, max_pending, max_invalid_attempts, trust_store_sha256
      FROM signed_provider_scopes WHERE scope_id = ?`)
      .get(this.scopeId) as ScopeRow | undefined
    if (
      !scope
      || scope.audience !== this.audience
      || scope.verifier_instance_id !== this.verifierInstanceId
      || !Number.isSafeInteger(scope.sequence) || scope.sequence < 0
      || !Number.isSafeInteger(scope.last_wall_ms) || scope.last_wall_ms < 0
      || scope.rate_limit_window_ms !== this.rateLimitWindowMs
      || scope.max_issues_per_window !== this.maxIssuesPerWindow
      || scope.max_invalid_attempts_per_window !== this.maxInvalidAttemptsPerWindow
      || scope.max_rate_limit_subjects !== this.maxRateLimitSubjects
      || (scope.max_pending !== null
        && (!Number.isSafeInteger(scope.max_pending) || scope.max_pending < 1))
      || (scope.max_invalid_attempts !== null
        && (!Number.isSafeInteger(scope.max_invalid_attempts) || scope.max_invalid_attempts < 1))
      || (scope.trust_store_sha256 !== null && !SHA256_PATTERN.test(scope.trust_store_sha256))
    ) throw new Error('Shared challenge scope state is corrupt')
    return scope
  }

  private validateStorePolicy(): void {
    this.immediateTransaction(() => {
      this.database.prepare(`INSERT INTO signed_provider_store_policy
        (singleton, max_scopes, scope_retention_ms, max_clock_skew_ms) VALUES (1, ?, ?, ?)
        ON CONFLICT(singleton) DO NOTHING`).run(
          this.maxScopes,
          this.scopeRetentionMs,
          this.maxClockSkewMs
        )
      const policy = this.database.prepare(`SELECT max_scopes, scope_retention_ms, max_clock_skew_ms
        FROM signed_provider_store_policy WHERE singleton = 1`).get() as {
        max_scopes: number
        scope_retention_ms: number
        max_clock_skew_ms: number
      } | undefined
      if (
        !policy
        || policy.max_scopes !== this.maxScopes
        || policy.scope_retention_ms !== this.scopeRetentionMs
        || policy.max_clock_skew_ms !== this.maxClockSkewMs
      ) throw new Error('Shared challenge global retention policy mismatch')
    })
  }

  private pruneGlobalState(wallNowMs: number): void {
    this.database.prepare(`DELETE FROM signed_provider_challenges
      WHERE expires_at_ms <= ?`).run(wallNowMs)
    const retentionCutoff = Math.max(0, wallNowMs - this.scopeRetentionMs)
    const retiredCount = this.database.prepare(`SELECT COUNT(*) AS count
      FROM signed_provider_retired_scopes`).get() as { count: number }
    if (!Number.isSafeInteger(retiredCount.count) || retiredCount.count < 0) {
      throw new Error('Shared challenge retired-scope count is corrupt')
    }
    const availableRetiredSlots = Math.max(0, this.maxScopes - retiredCount.count)
    if (availableRetiredSlots > 0) {
      this.database.prepare(`INSERT INTO signed_provider_retired_scopes (scope_id, retired_at_ms)
        SELECT scope_id, ? FROM signed_provider_scopes
        WHERE scope_id <> ? AND last_wall_ms <= ?
          AND NOT EXISTS (
            SELECT 1 FROM signed_provider_challenges
            WHERE signed_provider_challenges.scope_id = signed_provider_scopes.scope_id
          )
        ORDER BY last_wall_ms, scope_id LIMIT ?`).run(
          wallNowMs,
          this.scopeId,
          retentionCutoff,
          availableRetiredSlots
        )
    }
    this.database.prepare(`DELETE FROM signed_provider_scopes
      WHERE scope_id <> ? AND last_wall_ms <= ?
        AND NOT EXISTS (
          SELECT 1 FROM signed_provider_challenges
          WHERE signed_provider_challenges.scope_id = signed_provider_scopes.scope_id
        )
        AND EXISTS (
          SELECT 1 FROM signed_provider_retired_scopes
          WHERE signed_provider_retired_scopes.scope_id = signed_provider_scopes.scope_id
        )`).run(this.scopeId, retentionCutoff)
  }

  private enforceScopeCapacity(): void {
    const existing = this.database.prepare(`SELECT 1 AS present
      FROM signed_provider_scopes WHERE scope_id = ?`).get(this.scopeId)
    if (existing) return
    const count = this.database.prepare(`SELECT COUNT(*) AS count
      FROM signed_provider_scopes`).get() as { count: number }
    if (!Number.isSafeInteger(count.count) || count.count < 0) {
      throw new Error('Shared challenge global scope count is corrupt')
    }
    if (count.count >= this.maxScopes) throw new Error('Shared challenge scope capacity exhausted')
  }

  private validateExistingScopePolicy(): void {
    const scope = this.database.prepare(`SELECT rate_limit_window_ms, max_issues_per_window,
        max_invalid_attempts_per_window, max_rate_limit_subjects
      FROM signed_provider_scopes WHERE scope_id = ?`)
      .get(this.scopeId) as Pick<
        ScopeRow,
        'rate_limit_window_ms' | 'max_issues_per_window' | 'max_invalid_attempts_per_window'
        | 'max_rate_limit_subjects'
      > | undefined
    if (scope && (
      scope.rate_limit_window_ms !== this.rateLimitWindowMs
      || scope.max_issues_per_window !== this.maxIssuesPerWindow
      || scope.max_invalid_attempts_per_window !== this.maxInvalidAttemptsPerWindow
      || scope.max_rate_limit_subjects !== this.maxRateLimitSubjects
    )) throw new Error('Shared challenge rate-limit policy does not match existing scope')
  }

  private pinScopeLimit(
    column: 'max_pending' | 'max_invalid_attempts',
    value: number
  ): void {
    if (column !== 'max_pending' && column !== 'max_invalid_attempts') {
      throw new Error('Unsupported shared challenge policy column')
    }
    const row = this.database.prepare(`SELECT ${column} AS value
      FROM signed_provider_scopes WHERE scope_id = ?`).get(this.scopeId) as {
      value: number | null
    } | undefined
    if (!row) throw new Error('Shared challenge scope state is unavailable')
    if (row.value === null) {
      this.database.prepare(`UPDATE signed_provider_scopes SET ${column} = ?
        WHERE scope_id = ? AND ${column} IS NULL`).run(value, this.scopeId)
      return
    }
    if (row.value !== value) throw new Error(`Shared challenge ${column} policy mismatch`)
  }

  private pinTrustStore(trustStoreSha256: string): void {
    const row = this.database.prepare(`SELECT trust_store_sha256 AS value
      FROM signed_provider_scopes WHERE scope_id = ?`).get(this.scopeId) as {
      value: string | null
    } | undefined
    if (!row) throw new Error('Shared challenge scope state is unavailable')
    if (row.value === null) {
      this.database.prepare(`UPDATE signed_provider_scopes SET trust_store_sha256 = ?
        WHERE scope_id = ? AND trust_store_sha256 IS NULL`).run(trustStoreSha256, this.scopeId)
      return
    }
    if (row.value !== trustStoreSha256) {
      throw new Error('Shared challenge trust-store policy mismatch')
    }
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error('Shared challenge store is closed')
  }
}
