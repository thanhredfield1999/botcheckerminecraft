import type { PersistenceExecutionResult } from './qa-execution.js'

export interface PersistenceQaReport {
  kind: 'persistence'
  verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'
  project: string
  fixture: string
  execution: PersistenceExecutionResult['execution']
  evidence: {
    key?: string
    restartEvidenceId?: string
    changedKeys?: string[]
    message: string
  }
}

const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key)/i
const ID_PATTERN = /^[a-zA-Z0-9._:-]{1,128}$/
const MAX_TEXT = 256

export function buildPersistenceQaReport(
  result: PersistenceExecutionResult,
  project: string,
  fixture: string
): PersistenceQaReport {
  validateText(project, 'project')
  validateText(fixture, 'fixture')
  if (!['PASS', 'FAIL', 'INCONCLUSIVE'].includes(result.verdict)) throw new Error('Invalid persistence verdict')
  validateText(result.message, 'persistence message')
  validateId(result.execution.executionId, 'execution ID')
  validateId(result.execution.beforeRunId, 'before run ID')
  validateId(result.execution.afterRunId, 'after run ID')
  if (result.evidence.key !== undefined) validateText(result.evidence.key, 'persistence key')
  if (result.evidence.restartEvidenceId !== undefined) validateId(result.evidence.restartEvidenceId, 'restart evidence ID')
  if (result.evidence.changedKeys !== undefined && result.evidence.changedKeys.length > 64) {
    throw new Error('Persistence changed keys exceed bounded limit')
  }
  const evidence = {
    ...(result.evidence.key !== undefined ? { key: result.evidence.key } : {}),
    ...(result.evidence.restartEvidenceId !== undefined ? { restartEvidenceId: result.evidence.restartEvidenceId } : {}),
    ...(result.evidence.changedKeys !== undefined ? { changedKeys: [...result.evidence.changedKeys] } : {}),
    message: result.message
  }
  if (CREDENTIAL_PATTERN.test(JSON.stringify(evidence))) throw new Error('Credential-like persistence report rejected')
  return { kind: 'persistence', verdict: result.verdict, project, fixture, execution: { ...result.execution }, evidence }
}

function validateText(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_TEXT) throw new Error(`Invalid ${label}`)
  if (CREDENTIAL_PATTERN.test(value)) throw new Error(`Credential-like ${label} rejected`)
}

function validateId(value: string, label: string): void {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new Error(`Invalid ${label}`)
  if (CREDENTIAL_PATTERN.test(value)) throw new Error(`Credential-like ${label} rejected`)
}

void CREDENTIAL_PATTERN
