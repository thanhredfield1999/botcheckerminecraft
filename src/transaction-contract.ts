export type TransactionExpectation = 'complete' | 'reject'
export type TransactionVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE'

export interface TransactionState {
  balanceMinor: number
  itemQuantity: number
}

export interface TransactionObservation {
  accepted: boolean
  after: TransactionState
  evidence: Record<string, unknown>
}

export interface TransactionInput {
  transactionId: string
  expected: TransactionExpectation
  priceMinor: number
  itemKey: string
  quantity: number
  before?: TransactionState
  observed?: TransactionObservation
}

export interface TransactionEvaluation {
  verdict: TransactionVerdict
  message: string
  evidence: {
    transactionId: string
    expected: TransactionExpectation
    accepted?: boolean
    balanceDeltaMinor?: number
    itemDelta?: number
  }
}

const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key)/i
const MAX_EVIDENCE_BYTES = 8_192

export function evaluateTransaction(input: TransactionInput): TransactionEvaluation {
  validateInput(input)
  const baseEvidence = { transactionId: input.transactionId, expected: input.expected }
  if (!input.before || !input.observed) {
    return { verdict: 'INCONCLUSIVE', message: 'INCONCLUSIVE_TRANSACTION_EVIDENCE: before state or observed result missing', evidence: baseEvidence }
  }
  validateState(input.before, 'before')
  validateState(input.observed.after, 'after')
  const balanceDeltaMinor = input.observed.after.balanceMinor - input.before.balanceMinor
  const itemDelta = input.observed.after.itemQuantity - input.before.itemQuantity
  const evidence = { ...baseEvidence, accepted: input.observed.accepted, balanceDeltaMinor, itemDelta }
  if (input.expected === 'reject') {
    if (input.observed.accepted) return { verdict: 'FAIL', message: 'Rejected transaction was accepted', evidence }
    if (balanceDeltaMinor !== 0 || itemDelta !== 0) return { verdict: 'FAIL', message: 'Rejected transaction mutated balance or inventory', evidence }
    return { verdict: 'PASS', message: 'Transaction was rejected without mutation', evidence }
  }
  if (!input.observed.accepted) return { verdict: 'FAIL', message: 'Expected transaction was rejected', evidence }
  if (balanceDeltaMinor !== -input.priceMinor) return { verdict: 'FAIL', message: 'Transaction balance delta did not match price', evidence }
  if (itemDelta !== input.quantity) return { verdict: 'FAIL', message: 'Transaction item delta did not match quantity', evidence }
  return { verdict: 'PASS', message: 'Transaction completed with expected balance and inventory deltas', evidence }
}

function validateInput(input: TransactionInput): void {
  if (!input || typeof input !== 'object') throw new Error('Invalid transaction input')
  validateText(input.transactionId, 'transaction ID')
  validateText(input.itemKey, 'item key')
  if (!['complete', 'reject'].includes(input.expected)) throw new Error('Invalid transaction expectation')
  if (!Number.isInteger(input.priceMinor) || input.priceMinor < 0) throw new Error('Invalid transaction price amount')
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new Error('Invalid transaction quantity')
  if (input.observed) {
    const serialized = JSON.stringify(input.observed.evidence)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_EVIDENCE_BYTES) throw new Error('Transaction evidence exceeds bounded payload')
    if (CREDENTIAL_PATTERN.test(serialized)) throw new Error('Credential-like transaction evidence rejected')
  }
}

function validateState(state: TransactionState, label: string): void {
  if (!Number.isInteger(state.balanceMinor) || state.balanceMinor < 0) throw new Error(`Invalid ${label} balance`)
  if (!Number.isInteger(state.itemQuantity) || state.itemQuantity < 0) throw new Error(`Invalid ${label} item quantity`)
}

function validateText(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 128) throw new Error(`Invalid transaction ${label}`)
  if (CREDENTIAL_PATTERN.test(value)) throw new Error(`Credential-like transaction ${label} rejected`)
}

void CREDENTIAL_PATTERN
