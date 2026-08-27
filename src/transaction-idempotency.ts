import type { TransactionObservation, TransactionState, TransactionVerdict } from './transaction-contract.js'

export interface TransactionAttemptsInput {
  transactionId: string
  priceMinor: number
  itemKey: string
  quantity: number
  before: TransactionState
  attempts: TransactionObservation[]
}

export interface TransactionAttemptsEvaluation {
  verdict: TransactionVerdict
  message: string
  evidence: {
    transactionId: string
    attemptCount: number
    duplicateMutation: boolean
    firstBalanceDeltaMinor?: number
    firstItemDelta?: number
  }
}

const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key)/i
const MAX_ATTEMPTS = 16
const MAX_EVIDENCE_BYTES = 8_192

export function evaluateTransactionAttempts(input: TransactionAttemptsInput): TransactionAttemptsEvaluation {
  validateInput(input)
  const evidence: TransactionAttemptsEvaluation['evidence'] = {
    transactionId: input.transactionId,
    attemptCount: input.attempts.length,
    duplicateMutation: false as boolean
  }
  if (input.attempts.some(attempt => !attempt)) {
    return { verdict: 'INCONCLUSIVE', message: 'INCONCLUSIVE_IDEMPOTENCY_EVIDENCE: transaction attempt observation missing', evidence }
  }
  if (input.attempts.length < 1) return { verdict: 'INCONCLUSIVE', message: 'INCONCLUSIVE_IDEMPOTENCY_EVIDENCE: transaction attempts missing', evidence }
  const firstAttempt = input.attempts[0]
  if (!firstAttempt) return { verdict: 'INCONCLUSIVE', message: 'INCONCLUSIVE_IDEMPOTENCY_EVIDENCE: first transaction attempt missing', evidence }
  evidence.firstBalanceDeltaMinor = firstAttempt.after.balanceMinor - input.before.balanceMinor
  evidence.firstItemDelta = firstAttempt.after.itemQuantity - input.before.itemQuantity
  const first = input.attempts[0]
  const expectedBalance = input.before.balanceMinor - input.priceMinor
  const expectedItems = input.before.itemQuantity + input.quantity
  if (!first.accepted || first.after.balanceMinor !== expectedBalance || first.after.itemQuantity !== expectedItems) {
    return { verdict: 'FAIL', message: 'Initial transaction attempt did not produce expected result', evidence }
  }
  for (const attempt of input.attempts.slice(1)) {
    if (attempt.accepted && (attempt.after.balanceMinor !== first.after.balanceMinor || attempt.after.itemQuantity !== first.after.itemQuantity)) {
      evidence.duplicateMutation = true
      return { verdict: 'FAIL', message: 'Duplicate transaction attempt caused additional mutation', evidence }
    }
    if (attempt.after.balanceMinor !== first.after.balanceMinor || attempt.after.itemQuantity !== first.after.itemQuantity) {
      evidence.duplicateMutation = true
      return { verdict: 'FAIL', message: 'Duplicate transaction attempt changed final state', evidence }
    }
  }
  return { verdict: 'PASS', message: 'Duplicate transaction attempts were idempotent', evidence }
}

function validateInput(input: TransactionAttemptsInput): void {
  if (!input || typeof input !== 'object') throw new Error('Invalid transaction attempts input')
  validateText(input.transactionId, 'transaction ID')
  validateText(input.itemKey, 'item key')
  if (!Number.isInteger(input.priceMinor) || input.priceMinor < 0) throw new Error('Invalid transaction price amount')
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new Error('Invalid transaction quantity')
  validateState(input.before, 'before')
  if (!Array.isArray(input.attempts) || input.attempts.length > MAX_ATTEMPTS) throw new Error('Transaction attempts exceed bounded limit')
  for (const attempt of input.attempts) {
    if (!attempt || typeof attempt !== 'object') continue
    validateState(attempt.after, 'attempt after')
    const serialized = JSON.stringify(attempt.evidence)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_EVIDENCE_BYTES) throw new Error('Transaction attempt evidence exceeds bounded payload')
    if (CREDENTIAL_PATTERN.test(serialized)) throw new Error('Credential-like transaction attempt evidence rejected')
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
