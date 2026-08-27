import { evaluateTransaction, type TransactionInput, type TransactionObservation, type TransactionState, type TransactionEvaluation } from './transaction-contract.js'

export type TransactionExecutor = (request: TransactionInput, before: TransactionState) => Promise<TransactionObservation>

export interface TransactionRunnerInput {
  transaction: Omit<TransactionInput, 'before' | 'observed'>
  before: () => Promise<TransactionState>
  execute: TransactionExecutor
}

export async function runTransaction(input: TransactionRunnerInput): Promise<TransactionEvaluation> {
  if (typeof input.execute !== 'function') throw new Error('Transaction executor is required')
  let before: TransactionState
  try {
    before = await input.before()
  } catch (error) {
    return inconclusive('INCONCLUSIVE_TRANSACTION_EVIDENCE: before state provider failed', error)
  }
  let observed: TransactionObservation
  try {
    observed = await input.execute(input.transaction, before)
  } catch (error) {
    return inconclusive('INCONCLUSIVE_PROVIDER: transaction executor failed', error)
  }
  try {
    return evaluateTransaction({ ...input.transaction, before, observed })
  } catch (error) {
    return inconclusive('INCONCLUSIVE_TRANSACTION_EVIDENCE: observation validation failed', error)
  }
}

function inconclusive(message: string, error: unknown): TransactionEvaluation {
  const detail = error instanceof Error ? error.message.slice(0, 128) : 'provider failed'
  return {
    verdict: 'INCONCLUSIVE',
    message: `${message}: ${detail}`,
    evidence: { transactionId: 'unassigned-transaction', expected: 'complete' }
  }
}
