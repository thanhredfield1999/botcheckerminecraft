import { evaluateCrashRecovery, type CrashEvidence, type CrashRecoveryEvaluation, type RecoveryEvidence } from './crash-recovery-contract.js'

export interface CrashRecoveryRunnerInput {
  executionId: string
  crash: () => Promise<CrashEvidence>
  recovery: () => Promise<RecoveryEvidence>
}

export async function runCrashRecovery(input: CrashRecoveryRunnerInput): Promise<CrashRecoveryEvaluation> {
  let crash: CrashEvidence
  try {
    crash = await input.crash()
  } catch (error) {
    return inconclusive(input.executionId, 'INCONCLUSIVE_CRASH_BOUNDARY: external crash provider failed', error)
  }
  if (!crash.authorized || !crash.observed) {
    return evaluateCrashRecovery({ executionId: input.executionId, crash })
  }
  let recovery: RecoveryEvidence
  try {
    recovery = await input.recovery()
  } catch (error) {
    return inconclusive(input.executionId, 'INCONCLUSIVE_RECOVERY_PROVIDER: external recovery provider failed', error)
  }
  try {
    return evaluateCrashRecovery({ executionId: input.executionId, crash, recovery })
  } catch (error) {
    return inconclusive(input.executionId, 'INCONCLUSIVE_CRASH_RECOVERY_EVIDENCE: validation failed', error)
  }
}

function inconclusive(executionId: string, message: string, error: unknown): CrashRecoveryEvaluation {
  const detail = error instanceof Error ? error.message.slice(0, 128) : 'provider failed'
  return { verdict: 'INCONCLUSIVE', message: `${message}: ${detail}`, evidence: { executionId } }
}
