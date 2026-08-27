import { evaluatePermissionCell, type PermissionCellInput, type PermissionEvaluation } from './permission-contract.js'

export interface PermissionMatrixInput {
  project: string
  fixture: string
  cells: PermissionCellInput[]
}

export interface PermissionMatrixResult {
  verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'
  project: string
  fixture: string
  summary: { total: number; pass: number; fail: number; inconclusive: number }
  cells: Array<PermissionEvaluation & { role: string; action: string }>
}

export function evaluatePermissionMatrix(input: PermissionMatrixInput): PermissionMatrixResult {
  validateMetadata(input)
  const seen = new Set<string>()
  for (const cell of input.cells) {
    const identity = `${cell.role}\u0000${cell.action}`
    if (seen.has(identity)) throw new Error(`Duplicate permission matrix cell: ${cell.role}/${cell.action}`)
    seen.add(identity)
  }

  const cells = input.cells.map(cell => ({
    ...evaluatePermissionCell(cell),
    role: cell.role,
    action: cell.action
  }))
  const summary = {
    total: cells.length,
    pass: cells.filter(cell => cell.verdict === 'PASS').length,
    fail: cells.filter(cell => cell.verdict === 'FAIL').length,
    inconclusive: cells.filter(cell => cell.verdict === 'INCONCLUSIVE').length
  }
  const verdict = summary.fail > 0 ? 'FAIL' : summary.inconclusive > 0 ? 'INCONCLUSIVE' : 'PASS'
  return { verdict, project: input.project, fixture: input.fixture, summary, cells }
}

function validateMetadata(input: PermissionMatrixInput): void {
  if (!input || typeof input !== 'object') throw new Error('Invalid permission matrix')
  if (typeof input.project !== 'string' || input.project.trim().length === 0 || input.project.length > 128) {
    throw new Error('Invalid permission matrix project')
  }
  if (typeof input.fixture !== 'string' || input.fixture.trim().length === 0 || input.fixture.length > 128) {
    throw new Error('Invalid permission matrix fixture')
  }
  if (!Array.isArray(input.cells) || input.cells.length === 0 || input.cells.length > 64) {
    throw new Error('Permission matrix must contain at least one bounded cell')
  }
}
