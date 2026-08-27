export type QaPlanKind = 'permission' | 'negative-security'
export type QaPlanVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE'

export interface QaPlanCellReport {
  accountRef: string
  role?: string
  action?: string
  caseId?: string
  verdict: QaPlanVerdict
  message: string
  authorizationCount: number
  mutationCount?: number
}

export interface QaPlanReportInput {
  kind: QaPlanKind
  verdict: QaPlanVerdict
  project: string
  fixture: string
  accounts: string[]
  summary: { total: number; pass: number; fail: number; inconclusive: number }
  cells: QaPlanCellReport[]
}

const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key)/i
const MAX_TEXT = 128
const MAX_CELLS = 64

export function buildQaPlanReport(input: QaPlanReportInput): QaPlanReportInput {
  validateText(input.project, 'project')
  validateText(input.fixture, 'fixture')
  if (!['permission', 'negative-security'].includes(input.kind)) throw new Error('Invalid QA plan kind')
  if (!['PASS', 'FAIL', 'INCONCLUSIVE'].includes(input.verdict)) throw new Error('Invalid QA plan verdict')
  if (!Array.isArray(input.accounts) || input.accounts.length > MAX_CELLS) throw new Error('QA plan accounts exceed bounded limit')
  if (!Array.isArray(input.cells) || input.cells.length > MAX_CELLS) throw new Error('QA plan cells exceed bounded limit')
  for (const account of input.accounts) validateText(account, 'account reference')
  for (const cell of input.cells) {
    validateText(cell.accountRef, 'cell account reference')
    validateText(cell.message, 'cell message')
    if (cell.role !== undefined) validateText(cell.role, 'role')
    if (cell.action !== undefined) validateText(cell.action, 'action')
    if (cell.caseId !== undefined) validateText(cell.caseId, 'case ID')
    if (!Number.isInteger(cell.authorizationCount) || cell.authorizationCount < 0 || cell.authorizationCount > 8) {
      throw new Error('QA plan authorization count is invalid')
    }
    if (cell.mutationCount !== undefined && (!Number.isInteger(cell.mutationCount) || cell.mutationCount < 0)) {
      throw new Error('QA plan mutation count is invalid')
    }
  }
  if (input.summary.total !== input.cells.length || input.summary.total > MAX_CELLS) {
    throw new Error('QA plan summary does not match bounded cells')
  }
  const serialized = JSON.stringify(input)
  if (CREDENTIAL_PATTERN.test(serialized)) throw new Error('Credential-like QA plan report rejected')
  return {
    kind: input.kind,
    verdict: input.verdict,
    project: input.project,
    fixture: input.fixture,
    accounts: [...input.accounts].sort(),
    summary: { ...input.summary },
    cells: input.cells.map(cell => ({ ...cell }))
  }
}

function validateText(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_TEXT) {
    throw new Error(`Invalid QA plan ${label}`)
  }
  if (CREDENTIAL_PATTERN.test(value)) throw new Error(`Credential-like QA plan ${label} rejected`)
}
