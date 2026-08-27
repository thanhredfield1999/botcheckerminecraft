import { buildMultiAccountPlan, type MultiAccountPlanInput, type MultiAccountPlanResult } from './multi-account-plan.js'
import { containsCredentialMaterial, sanitizeCredentialText } from './failure-envelope.js'

export interface MultiAccountExecutionResult {
  verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'
  message: string
  evidence?: Record<string, unknown>
}

export interface MultiAccountRunnerResult {
  verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'
  plan: MultiAccountPlanResult
  accounts: Array<{
    accountRef: string
    role: string
    order: number
    verdict: MultiAccountExecutionResult['verdict']
    message: string
    evidence?: Record<string, unknown>
  }>
}

export type MultiAccountExecutor = (account: {
  accountRef: string
  role: string
  order: number
}) => Promise<MultiAccountExecutionResult>

export async function runMultiAccountPlan(
  input: MultiAccountPlanInput,
  execute: MultiAccountExecutor
): Promise<MultiAccountRunnerResult> {
  if (typeof execute !== 'function') throw new Error('Multi-account executor is required')
  const plan = buildMultiAccountPlan(input)
  if (plan.verdict === 'INCONCLUSIVE') {
    return {
      verdict: 'INCONCLUSIVE',
      plan,
      accounts: plan.accounts.map(account => ({
        accountRef: account.accountRef,
        role: account.role,
        order: account.order,
        verdict: 'INCONCLUSIVE',
        message: 'Authorization missing; account execution not started'
      }))
    }
  }

  const accounts: MultiAccountRunnerResult['accounts'] = []
  for (const account of plan.accounts) {
    try {
      const result = await execute({ accountRef: account.accountRef, role: account.role, order: account.order })
      validateExecutionResult(result)
      accounts.push({ ...account, verdict: result.verdict, message: result.message, evidence: result.evidence })
    } catch (error) {
      accounts.push({
        ...account,
        verdict: 'INCONCLUSIVE',
        message: error instanceof Error
          ? sanitizeCredentialText(`INCONCLUSIVE_EXECUTION: ${error.message}`)
          : 'INCONCLUSIVE_EXECUTION: executor failed'
      })
    }
  }
  return {
    verdict: accounts.some(account => account.verdict === 'FAIL')
      ? 'FAIL'
      : accounts.some(account => account.verdict === 'INCONCLUSIVE') ? 'INCONCLUSIVE' : 'PASS',
    plan,
    accounts
  }
}

function validateExecutionResult(result: MultiAccountExecutionResult): void {
  if (!result || !['PASS', 'FAIL', 'INCONCLUSIVE'].includes(result.verdict)) throw new Error('Invalid account execution verdict')
  if (typeof result.message !== 'string' || result.message.length === 0 || result.message.length > 256) {
    throw new Error('Invalid account execution message')
  }
  if (containsCredentialMaterial(result.message)) throw new Error('Credential-like account execution message rejected')
  if (result.evidence !== undefined) {
    const serialized = JSON.stringify(result.evidence)
    if (Buffer.byteLength(serialized, 'utf8') > 8_192) throw new Error('Account execution evidence exceeds bounded payload')
    if (/(password|passwd|secret|token|credential|api[_-]?key)/i.test(serialized)) {
      throw new Error('Credential-like account execution evidence rejected')
    }
  }
}
