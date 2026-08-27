export type CrashRecoveryVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE'

export interface CrashEvidence {
  authorized: boolean
  observed: boolean
  evidenceId: string
  exitCode: number
}

export interface RecoveryEvidence {
  observed: boolean
  ready: boolean
  evidenceId: string
}

export interface CrashRecoveryInput {
  executionId: string
  crash: CrashEvidence
  recovery?: RecoveryEvidence
}

export interface CrashRecoveryEvaluation {
  verdict: CrashRecoveryVerdict
  message: string
  evidence: {
    executionId: string
    crashEvidenceId?: string
    recoveryEvidenceId?: string
    exitCode?: number
  }
}

const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key)/i
const ID_PATTERN = /^[a-zA-Z0-9._:-]{1,128}$/

export function evaluateCrashRecovery(input: CrashRecoveryInput): CrashRecoveryEvaluation {
  validateInput(input)
  const baseEvidence = { executionId: input.executionId }
  if (!input.crash.authorized || !input.crash.observed) {
    return { verdict: 'INCONCLUSIVE', message: 'INCONCLUSIVE_CRASH_BOUNDARY: authorized crash boundary is not proven', evidence: { ...baseEvidence, crashEvidenceId: input.crash.evidenceId } }
  }
  if (!input.recovery || !input.recovery.observed) {
    return { verdict: 'INCONCLUSIVE', message: 'INCONCLUSIVE_RECOVERY_EVIDENCE: recovery observation is missing', evidence: { ...baseEvidence, crashEvidenceId: input.crash.evidenceId, exitCode: input.crash.exitCode } }
  }
  const evidence = { ...baseEvidence, crashEvidenceId: input.crash.evidenceId, recoveryEvidenceId: input.recovery.evidenceId, exitCode: input.crash.exitCode }
  if (!input.recovery.ready) return { verdict: 'FAIL', message: 'Runtime did not become ready after authorized crash', evidence }
  return { verdict: 'PASS', message: 'Runtime recovered and became ready after authorized crash', evidence }
}

function validateInput(input: CrashRecoveryInput): void {
  if (!input || typeof input !== 'object') throw new Error('Invalid crash recovery input')
  validateId(input.executionId, 'execution ID')
  if (!input.crash || typeof input.crash !== 'object') throw new Error('Invalid crash evidence')
  validateId(input.crash.evidenceId, 'crash evidence ID')
  if (!Number.isInteger(input.crash.exitCode) || input.crash.exitCode < 0 || input.crash.exitCode > 255) throw new Error('Invalid crash exit code')
  if (input.recovery) {
    if (typeof input.recovery !== 'object') throw new Error('Invalid recovery evidence')
    validateId(input.recovery.evidenceId, 'recovery evidence ID')
  }
}

function validateId(value: string, label: string): void {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new Error(`Invalid ${label}`)
  if (CREDENTIAL_PATTERN.test(value)) throw new Error(`Credential-like ${label} rejected`)
}

void CREDENTIAL_PATTERN
