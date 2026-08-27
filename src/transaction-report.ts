import type { TransactionEvaluation } from './transaction-contract.js'

export interface TransactionReport {
  kind: 'transaction'
  verdict: TransactionEvaluation['verdict']
  project: string
  fixture: string
  evidence: {
    transactionId: string
    expected: 'complete' | 'reject'
    accepted?: boolean
    balanceDeltaMinor?: number
    itemDelta?: number
    message: string
  }
}

const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key)/i
const MAX_TEXT = 256

export function buildTransactionReport(
  result: TransactionEvaluation,
  project: string,
  fixture: string
): TransactionReport {
  validateText(project, 'project')
  validateText(fixture, 'fixture')
  if (!['PASS', 'FAIL', 'INCONCLUSIVE'].includes(result.verdict)) throw new Error('Invalid transaction report verdict')
  validateText(result.message, 'transaction message')
  validateText(result.evidence.transactionId, 'transaction ID')
  if (!['complete', 'reject'].includes(result.evidence.expected)) throw new Error('Invalid transaction expectation')
  const evidence: TransactionReport['evidence'] = {
    transactionId: result.evidence.transactionId,
    expected: result.evidence.expected,
    ...(result.evidence.accepted !== undefined ? { accepted: result.evidence.accepted } : {}),
    ...(result.evidence.balanceDeltaMinor !== undefined ? { balanceDeltaMinor: result.evidence.balanceDeltaMinor } : {}),
    ...(result.evidence.itemDelta !== undefined ? { itemDelta: result.evidence.itemDelta } : {}),
    message: result.message
  }
  if (CREDENTIAL_PATTERN.test(JSON.stringify(evidence))) throw new Error('Credential-like transaction report rejected')
  return { kind: 'transaction', verdict: result.verdict, project, fixture, evidence }
}

function validateText(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_TEXT) throw new Error(`Invalid ${label}`)
  if (CREDENTIAL_PATTERN.test(value)) throw new Error(`Credential-like ${label} rejected`)
}

void CREDENTIAL_PATTERN
