import { evaluatePermissionCell, type PermissionCellInput, type PermissionEvaluation } from './permission-contract.js'

export interface PermissionPlanCell extends PermissionCellInput {
  accountRef: string
  authorization: string[]
}

export interface PermissionPlanInput {
  project: string
  fixture: string
  cells: PermissionPlanCell[]
}

export interface PermissionPlanResult {
  verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'
  project: string
  fixture: string
  accounts: string[]
  summary: { total: number; pass: number; fail: number; inconclusive: number }
  cells: Array<PermissionEvaluation & { accountRef: string }>
}

const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key)/i

export function evaluatePermissionPlan(input: PermissionPlanInput): PermissionPlanResult {
  validatePlan(input)
  const seen = new Set<string>()
  for (const cell of input.cells) {
    const identity = `${cell.accountRef}\u0000${cell.action}`
    if (seen.has(identity)) throw new Error(`Duplicate permission plan cell: ${cell.accountRef}/${cell.action}`)
    seen.add(identity)
  }

  const cells = input.cells.map(cell => {
    if (cell.authorization.length === 0) {
      return {
        verdict: 'INCONCLUSIVE' as const,
        message: 'INCONCLUSIVE_AUTHORIZATION: permission test authorization is missing',
        evidence: { role: cell.role, action: cell.action, expected: cell.expected },
        accountRef: cell.accountRef
      }
    }
    return { ...evaluatePermissionCell(cell), accountRef: cell.accountRef }
  })
  const summary = {
    total: cells.length,
    pass: cells.filter(cell => cell.verdict === 'PASS').length,
    fail: cells.filter(cell => cell.verdict === 'FAIL').length,
    inconclusive: cells.filter(cell => cell.verdict === 'INCONCLUSIVE').length
  }
  return {
    verdict: summary.fail > 0 ? 'FAIL' : summary.inconclusive > 0 ? 'INCONCLUSIVE' : 'PASS',
    project: input.project,
    fixture: input.fixture,
    accounts: [...new Set(input.cells.map(cell => cell.accountRef))].sort(),
    summary,
    cells
  }
}

function validatePlan(input: PermissionPlanInput): void {
  if (!input || typeof input !== 'object') throw new Error('Invalid permission plan')
  validateText(input.project, 'plan project')
  validateText(input.fixture, 'plan fixture')
  if (!Array.isArray(input.cells) || input.cells.length === 0 || input.cells.length > 64) {
    throw new Error('Permission plan must contain at least one bounded cell and no more than 64 cells')
  }
  for (const cell of input.cells) {
    validateText(cell.accountRef, 'account reference')
    if (CREDENTIAL_PATTERN.test(cell.accountRef)) throw new Error('Credential-like account reference rejected')
    if (!Array.isArray(cell.authorization) || cell.authorization.length > 8) {
      throw new Error('Permission cell authorization must be bounded')
    }
    for (const authorization of cell.authorization) validateText(authorization, 'authorization')
  }
}

function validateText(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 128) {
    throw new Error(`Invalid ${label}`)
  }
  if (CREDENTIAL_PATTERN.test(value)) throw new Error(`Credential-like ${label} rejected`)
}
