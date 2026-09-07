import { evaluatePermissionPlan, type PermissionPlanInput, type PermissionPlanResult } from './permission-plan.js'
import type { PermissionObservation } from './permission-contract.js'
import { evaluateNegativePlan, type NegativePlanInput, type NegativePlanResult } from './negative-plan.js'
import type { NegativeObservation } from './negative-contract.js'

export type PermissionPlanExecutor = (cell: PermissionPlanInput['cells'][number]) => Promise<PermissionObservation>
export type NegativePlanExecutor = (current: NegativePlanInput['cases'][number]) => Promise<NegativeObservation>

export async function runPermissionPlan(input: PermissionPlanInput, execute: PermissionPlanExecutor): Promise<PermissionPlanResult> {
  if (typeof execute !== 'function') throw new Error('Permission plan executor is required')
  const cells: PermissionPlanInput['cells'] = []
  const failures = new Set<string>()
  for (const cell of input.cells) {
    if (cell.authorization.length === 0) { cells.push(cell); continue }
    try { cells.push({ ...cell, observed: await execute(cell) }) }
    catch { failures.add(`${cell.accountRef}\u0000${cell.action}`); cells.push(cell) }
  }
  const result = evaluatePermissionPlan({ ...input, cells })
  for (const cell of result.cells) {
    if (failures.has(`${cell.accountRef}\u0000${cell.evidence.action}`)) {
      cell.verdict = 'INCONCLUSIVE'
      cell.message = 'INCONCLUSIVE_PROVIDER: permission executor failed'
    }
  }
  return { ...result, summary: summaryOf(result.cells), verdict: verdictOf(result.cells) }
}

export async function runNegativePlan(input: NegativePlanInput, execute: NegativePlanExecutor): Promise<NegativePlanResult> {
  if (typeof execute !== 'function') throw new Error('Negative plan executor is required')
  const cases: NegativePlanInput['cases'] = []
  const failures = new Set<string>()
  for (const current of input.cases) {
    if (current.authorization.length === 0) { cases.push(current); continue }
    try { cases.push({ ...current, observed: await execute(current) }) }
    catch { failures.add(`${current.accountRef}\u0000${current.caseId}`); cases.push(current) }
  }
  const result = evaluateNegativePlan({ ...input, cases })
  for (const current of result.cases) {
    if (failures.has(`${current.accountRef}\u0000${current.evidence.caseId}`)) {
      current.verdict = 'INCONCLUSIVE'
      current.message = 'INCONCLUSIVE_PROVIDER: negative executor failed'
    }
  }
  return { ...result, summary: summaryOf(result.cases), verdict: verdictOf(result.cases) }
}

function verdictOf(cells: Array<{ verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE' }>): 'PASS' | 'FAIL' | 'INCONCLUSIVE' {
  return cells.some(cell => cell.verdict === 'FAIL') ? 'FAIL' : cells.some(cell => cell.verdict === 'INCONCLUSIVE') ? 'INCONCLUSIVE' : 'PASS'
}

function summaryOf(cells: Array<{ verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE' }>): { total: number; pass: number; fail: number; inconclusive: number } {
  return {
    total: cells.length,
    pass: cells.filter(cell => cell.verdict === 'PASS').length,
    fail: cells.filter(cell => cell.verdict === 'FAIL').length,
    inconclusive: cells.filter(cell => cell.verdict === 'INCONCLUSIVE').length
  }
}
