import type { QaPlanKind } from './qa-plan-report.js'
import type { MultiAccountRunnerResult } from './multi-account-runner.js'
import { containsCredentialMaterial } from './failure-envelope.js'

export type MultiAccountReportKind = QaPlanKind

export interface MultiAccountQaPlan {
  kind: MultiAccountReportKind
  verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'
  project: string
  fixture: string
  accounts: string[]
  summary: { total: number; pass: number; fail: number; inconclusive: number }
  cells: Array<{
    accountRef: string
    role: string
    action?: string
    caseId?: string
    verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'
    message: string
    authorizationCount: number
    mutationCount?: number
  }>
}

export function buildMultiAccountQaPlan(
  result: MultiAccountRunnerResult,
  kind: MultiAccountReportKind
): MultiAccountQaPlan {
  if (!['permission', 'negative-security'].includes(kind)) throw new Error('Invalid multi-account report kind')
  if (result.accounts.length !== result.plan.accounts.length) throw new Error('Multi-account report does not match plan')
  const planRefs = new Set(result.plan.accounts.map(account => account.accountRef))
  if (new Set(result.accounts.map(account => account.accountRef)).size !== result.accounts.length) {
    throw new Error('Multi-account report contains duplicate account')
  }
  for (const account of result.accounts) {
    if (!planRefs.has(account.accountRef)) throw new Error(`Account missing from plan: ${account.accountRef}`)
    if (typeof account.message !== 'string' || account.message.length === 0 || account.message.length > 256) {
      throw new Error('Invalid multi-account report message')
    }
    if (containsCredentialMaterial(account.message)) throw new Error('Credential-like multi-account report message rejected')
    if (account.evidence !== undefined) {
      const serialized = JSON.stringify(account.evidence)
      if (Buffer.byteLength(serialized, 'utf8') > 8_192) throw new Error('Multi-account report evidence exceeds bounded payload')
      if (/(password|passwd|secret|token|credential|api[_-]?key)/i.test(serialized)) {
        throw new Error('Credential-like multi-account report evidence rejected')
      }
    }
  }
  const cells = result.accounts.map(account => ({
    accountRef: account.accountRef,
    role: account.role,
    verdict: account.verdict,
    message: account.message,
    authorizationCount: result.plan.verdict === 'PASS' ? result.plan.authorization.length : 0,
    mutationCount: mutationCount(account.evidence)
  }))
  const summary = {
    total: cells.length,
    pass: cells.filter(cell => cell.verdict === 'PASS').length,
    fail: cells.filter(cell => cell.verdict === 'FAIL').length,
    inconclusive: cells.filter(cell => cell.verdict === 'INCONCLUSIVE').length
  }
  return {
    kind,
    verdict: summary.fail > 0 ? 'FAIL' : summary.inconclusive > 0 ? 'INCONCLUSIVE' : 'PASS',
    project: result.plan.project,
    fixture: result.plan.fixture,
    accounts: [...new Set(cells.map(cell => cell.accountRef))].sort(),
    summary,
    cells
  }
}

function mutationCount(evidence: Record<string, unknown> | undefined): number | undefined {
  const value = evidence?.mutationCount
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

 const _qaPlanKindCheck: QaPlanKind | undefined = undefined
void _qaPlanKindCheck
