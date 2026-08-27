import { PersistenceExecutionCoordinator } from './persistence-coordinator.js'
import type { PersistenceRestartEvidence, PersistenceSnapshot } from './persistence-contract.js'
import type { PersistenceExecutionResult } from './qa-execution.js'

export interface PersistenceRunnerInput {
  executionId: string
  before: () => Promise<PersistenceSnapshot>
  restart: () => Promise<PersistenceRestartEvidence>
  after: () => Promise<PersistenceSnapshot>
}

export async function runPersistenceExecution(input: PersistenceRunnerInput): Promise<PersistenceExecutionResult> {
  const coordinator = new PersistenceExecutionCoordinator(input.executionId)
  try {
    coordinator.recordBefore(await input.before())
  } catch (error) {
    return inconclusive('INCONCLUSIVE_SNAPSHOT: before snapshot provider failed', error)
  }
  try {
    coordinator.recordExternalRestart(await input.restart())
  } catch (error) {
    return inconclusive('INCONCLUSIVE_RESTART_BOUNDARY: external restart provider failed', error, coordinator)
  }
  try {
    coordinator.recordAfter(await input.after())
  } catch (error) {
    return inconclusive('INCONCLUSIVE_SNAPSHOT: after snapshot provider failed', error, coordinator)
  }
  return coordinator.evaluate()
}

function inconclusive(message: string, error: unknown, coordinator?: PersistenceExecutionCoordinator): PersistenceExecutionResult {
  const detail = error instanceof Error ? error.message.slice(0, 128) : 'provider failed'
  const result = coordinator?.evaluate() ?? {
    verdict: 'INCONCLUSIVE' as const,
    message,
    evidence: {},
    execution: { executionId: 'unassigned', beforeRunId: 'unassigned-before-run', afterRunId: 'unassigned-after-run' }
  }
  return { ...result, verdict: 'INCONCLUSIVE', message: `${message}: ${detail}` }
}
