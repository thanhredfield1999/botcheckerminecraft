import type { GuiEvaluation } from './gui-contract.js'

export interface GuiReport {
  kind: 'gui'
  verdict: GuiEvaluation['verdict']
  project: string
  fixture: string
  evidence: GuiEvaluation['evidence'] & { message: string }
}

const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key)/i
const MAX_TEXT = 256

export function buildGuiReport(result: GuiEvaluation, project: string, fixture: string): GuiReport {
  validateText(project, 'project')
  validateText(fixture, 'fixture')
  validateText(result.message, 'GUI message')
  if (!['PASS', 'FAIL', 'INCONCLUSIVE'].includes(result.verdict)) throw new Error('Invalid GUI verdict')
  const evidence = { ...result.evidence, message: result.message }
  if (CREDENTIAL_PATTERN.test(JSON.stringify(evidence))) throw new Error('Credential-like GUI report rejected')
  return { kind: 'gui', verdict: result.verdict, project, fixture, evidence }
}

function validateText(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_TEXT) throw new Error(`Invalid ${label}`)
  if (CREDENTIAL_PATTERN.test(value)) throw new Error(`Credential-like ${label} rejected`)
}

void CREDENTIAL_PATTERN

void MAX_TEXT

void validateText
