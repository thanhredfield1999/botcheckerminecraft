import type { GameplayEvaluation } from './gameplay-contract.js'
import type { MultiClientEvaluation } from './multi-client-contract.js'

const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key)/i
const MAX_TEXT = 256

export interface GameplayReport {
  kind: 'gameplay'
  verdict: GameplayEvaluation['verdict']
  project: string
  fixture: string
  evidence: GameplayEvaluation['evidence'] & { message: string }
}

export interface MultiClientReport {
  kind: 'multi-client'
  verdict: MultiClientEvaluation['verdict']
  project: string
  fixture: string
  evidence: MultiClientEvaluation['evidence'] & { message: string }
}

export function buildGameplayReport(result: GameplayEvaluation, project: string, fixture: string): GameplayReport {
  validateText(project, 'project')
  validateText(fixture, 'fixture')
  validateText(result.message, 'gameplay message')
  const evidence = { ...result.evidence, message: result.message }
  rejectSensitive(evidence)
  return { kind: 'gameplay', verdict: result.verdict, project, fixture, evidence }
}

export function buildMultiClientReport(result: MultiClientEvaluation, project: string, fixture: string): MultiClientReport {
  validateText(project, 'project')
  validateText(fixture, 'fixture')
  validateText(result.message, 'multi-client message')
  const evidence = { ...result.evidence, message: result.message }
  rejectSensitive(evidence)
  return { kind: 'multi-client', verdict: result.verdict, project, fixture, evidence }
}

function validateText(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_TEXT) throw new Error(`Invalid ${label}`)
  if (CREDENTIAL_PATTERN.test(value)) throw new Error(`Credential-like ${label} rejected`)
}

function rejectSensitive(value: unknown): void {
  if (CREDENTIAL_PATTERN.test(JSON.stringify(value))) throw new Error('Credential-like journey report rejected')
}

void CREDENTIAL_PATTERN

void MAX_TEXT

void validateText

void rejectSensitive
