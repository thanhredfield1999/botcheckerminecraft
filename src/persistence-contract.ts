export interface PersistenceSnapshot {
  key: string
  state: Record<string, unknown>
  observedAt: string
}

export interface PersistenceRestartEvidence {
  authorized: boolean
  observed: boolean
  evidenceId: string
}

export interface PersistenceEvaluationInput {
  before: PersistenceSnapshot
  after?: PersistenceSnapshot
  restart: PersistenceRestartEvidence
}

export type PersistenceVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE'

export interface PersistenceEvaluation {
  verdict: PersistenceVerdict
  message: string
  evidence: {
    key?: string
    before?: Record<string, unknown>
    after?: Record<string, unknown>
    restartEvidenceId?: string
    changedKeys?: string[]
  }
}

const MAX_KEY_LENGTH = 128
const MAX_STATE_BYTES = 16_384
const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key)/i

export function evaluatePersistence(input: PersistenceEvaluationInput): PersistenceEvaluation {
  validateSnapshot(input.before, 'before')
  validateRestart(input.restart)

  if (!input.restart.authorized || !input.restart.observed) {
    return {
      verdict: 'INCONCLUSIVE',
      message: 'INCONCLUSIVE_RESTART_BOUNDARY: authorized restart boundary is not proven',
      evidence: { key: input.before.key, before: input.before.state, restartEvidenceId: input.restart.evidenceId }
    }
  }

  if (!input.after) {
    return {
      verdict: 'INCONCLUSIVE',
      message: 'INCONCLUSIVE_SNAPSHOT: after-restart snapshot is missing',
      evidence: { key: input.before.key, before: input.before.state, restartEvidenceId: input.restart.evidenceId }
    }
  }

  const after = input.after
  validateSnapshot(after, 'after')
  if (after.key !== input.before.key) {
    return {
      verdict: 'FAIL',
      message: 'Persisted state key changed after authorized restart',
      evidence: {
        key: input.before.key,
        before: input.before.state,
        after: after.state,
        restartEvidenceId: input.restart.evidenceId,
        changedKeys: ['key']
      }
    }
  }

  const changedKeys = Object.keys({ ...input.before.state, ...after.state })
    .filter(key => !deepEqual(input.before.state[key], after.state[key]))
    .sort()
  if (changedKeys.length > 0) {
    return {
      verdict: 'FAIL',
      message: 'Persisted state changed after authorized restart',
      evidence: {
        key: input.before.key,
        before: input.before.state,
        after: after.state,
        restartEvidenceId: input.restart.evidenceId,
        changedKeys
      }
    }
  }

  return {
    verdict: 'PASS',
    message: 'Persistence state matched after authorized restart',
    evidence: {
      key: input.before.key,
      before: input.before.state,
      after: after.state,
      restartEvidenceId: input.restart.evidenceId
    }
  }
}

function validateRestart(restart: PersistenceRestartEvidence): void {
  if (typeof restart.evidenceId !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(restart.evidenceId)) {
    throw new Error('Invalid restart evidence ID')
  }
}

function validateSnapshot(snapshot: PersistenceSnapshot, label: string): void {
  if (!snapshot || typeof snapshot !== 'object') throw new Error(`Invalid ${label} snapshot`)
  if (typeof snapshot.key !== 'string' || snapshot.key.trim().length === 0 || snapshot.key.length > MAX_KEY_LENGTH) {
    throw new Error(`Invalid ${label} persistence key`)
  }
  if (CREDENTIAL_PATTERN.test(snapshot.key)) throw new Error(`Credential-like ${label} persistence key rejected`)
  if (!snapshot.state || typeof snapshot.state !== 'object' || Array.isArray(snapshot.state)) {
    throw new Error(`Invalid ${label} persistence state`)
  }
  const serialized = JSON.stringify(snapshot.state)
  if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > MAX_STATE_BYTES) {
    throw new Error(`${label} persistence state exceeds bounded payload`)
  }
  if (CREDENTIAL_PATTERN.test(serialized)) throw new Error(`Credential-like ${label} persistence state rejected`)
  if (typeof snapshot.observedAt !== 'string' || Number.isNaN(Date.parse(snapshot.observedAt))) {
    throw new Error(`Invalid ${label} observation timestamp`)
  }
}

function deepEqual(first: unknown, second: unknown): boolean {
  return JSON.stringify(first) === JSON.stringify(second)
}
