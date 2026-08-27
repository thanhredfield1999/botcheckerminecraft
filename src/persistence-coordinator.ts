import {
  evaluatePersistenceExecution,
  type PersistenceExecutionResult
} from './qa-execution.js'
import type {
  PersistenceRestartEvidence,
  PersistenceSnapshot
} from './persistence-contract.js'

export type PersistenceCoordinatorState = 'created' | 'before-recorded' | 'restart-recorded' | 'after-recorded'

const ID_PATTERN = /^[a-zA-Z0-9._:-]{1,128}$/
const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key)/i

export class PersistenceExecutionCoordinator {
  private state: PersistenceCoordinatorState = 'created'
  private beforeSnapshot?: PersistenceSnapshot
  private afterSnapshot?: PersistenceSnapshot
  private restartEvidence?: PersistenceRestartEvidence
  private beforeRunId?: string
  private afterRunId?: string

  constructor(private readonly executionId: string) {
    validateId(executionId, 'execution ID')
  }

  recordBefore(snapshot: PersistenceSnapshot): string {
    if (this.beforeSnapshot) throw new Error('Before snapshot already recorded')
    this.beforeSnapshot = cloneSnapshot(snapshot)
    this.beforeRunId = `before-${this.executionId}`
    this.state = 'before-recorded'
    return this.beforeRunId
  }

  recordExternalRestart(evidence: PersistenceRestartEvidence): void {
    if (this.state !== 'before-recorded') throw new Error('Before snapshot required before external restart')
    if (!evidence.authorized) throw new Error('External restart must be authorized')
    if (!evidence.observed) throw new Error('External restart must be observed')
    this.restartEvidence = { ...evidence }
    this.state = 'restart-recorded'
  }

  recordAfter(snapshot: PersistenceSnapshot): string {
    if (this.state !== 'restart-recorded') throw new Error('Authorized observed restart required before after snapshot')
    if (this.afterSnapshot) throw new Error('After snapshot already recorded')
    this.afterSnapshot = cloneSnapshot(snapshot)
    this.afterRunId = `after-${this.executionId}`
    this.state = 'after-recorded'
    return this.afterRunId
  }

  evaluate(): PersistenceExecutionResult {
    if (!this.beforeSnapshot || !this.beforeRunId) {
      return this.inconclusive('INCONCLUSIVE_SNAPSHOT: before snapshot is missing')
    }
    if (!this.restartEvidence) {
      return this.inconclusive('INCONCLUSIVE_RESTART_BOUNDARY: external restart evidence is missing')
    }
    if (!this.afterSnapshot || !this.afterRunId) {
      return this.inconclusive('INCONCLUSIVE_SNAPSHOT: after-restart snapshot is missing')
    }
    return evaluatePersistenceExecution({
      executionId: this.executionId,
      beforeRunId: this.beforeRunId,
      afterRunId: this.afterRunId,
      persistence: {
        before: this.beforeSnapshot,
        after: this.afterSnapshot,
        restart: this.restartEvidence
      }
    })
  }

  get currentState(): PersistenceCoordinatorState {
    return this.state
  }

  private inconclusive(message: string): PersistenceExecutionResult {
    return {
      verdict: 'INCONCLUSIVE',
      message,
      evidence: {
        ...(this.beforeSnapshot ? { key: this.beforeSnapshot.key, before: this.beforeSnapshot.state } : {}),
        ...(this.restartEvidence ? { restartEvidenceId: this.restartEvidence.evidenceId } : {})
      },
      execution: {
        executionId: this.executionId,
        beforeRunId: this.beforeRunId ?? 'unassigned-before-run',
        afterRunId: this.afterRunId ?? 'unassigned-after-run'
      }
    }
  }
}

function validateId(value: string, label: string): void {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new Error(`Invalid ${label}`)
  if (CREDENTIAL_PATTERN.test(value)) throw new Error(`Credential-like ${label} rejected`)
}

function cloneSnapshot(snapshot: PersistenceSnapshot): PersistenceSnapshot {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('Invalid persistence snapshot')
  return {
    key: snapshot.key,
    state: JSON.parse(JSON.stringify(snapshot.state)) as Record<string, unknown>,
    observedAt: snapshot.observedAt
  }
}
