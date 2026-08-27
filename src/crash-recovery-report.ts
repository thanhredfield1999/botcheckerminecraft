import type { CrashRecoveryEvaluation } from './crash-recovery-contract.js'

export interface CrashRecoveryReport {
  kind: 'crash-recovery'
  verdict: CrashRecoveryEvaluation['verdict']
  project: string
  fixture: string
  evidence: CrashRecoveryEvaluation['evidence'] & { message: string }
}

const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key)/i
const ID_PATTERN = /^[a-zA-Z0-9._:-]{1,128}$/
const MAX_TEXT = 256

export function buildCrashRecoveryReport(result: CrashRecoveryEvaluation, project: string, fixture: string): CrashRecoveryReport {
  validateText(project, 'project')
  validateText(fixture, 'fixture')
  validateText(result.message, 'crash recovery message')
  validateId(result.evidence.executionId, 'execution ID')
  if (result.evidence.crashEvidenceId !== undefined) validateId(result.evidence.crashEvidenceId, 'crash evidence ID')
  if (result.evidence.recoveryEvidenceId !== undefined) validateId(result.evidence.recoveryEvidenceId, 'recovery evidence ID')
  if (result.evidence.exitCode !== undefined && (!Number.isInteger(result.evidence.exitCode) || result.evidence.exitCode < 0 || result.evidence.exitCode > 255)) throw new Error('Invalid crash exit code')
  const evidence = { ...result.evidence, message: result.message }
  if (CREDENTIAL_PATTERN.test(JSON.stringify(evidence))) throw new Error('Credential-like crash recovery report rejected')
  return { kind: 'crash-recovery', verdict: result.verdict, project, fixture, evidence }
}

function validateText(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_TEXT) throw new Error(`Invalid ${label}`)
  if (CREDENTIAL_PATTERN.test(value)) throw new Error(`Credential-like ${label} rejected`)
}

function validateId(value: string, label: string): void {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new Error(`Invalid ${label}`)
  if (CREDENTIAL_PATTERN.test(value)) throw new Error(`Credential-like ${label} rejected`)
}
