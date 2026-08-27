import {
  evaluateNegativeCase,
  type NegativeCaseInput,
  type NegativeEvaluation
} from './negative-contract.js'

export interface NegativePlanCase extends NegativeCaseInput {
  accountRef: string
  authorization: string[]
}

export interface NegativePlanInput {
  project: string
  fixture: string
  cases: NegativePlanCase[]
}

export interface NegativePlanResult {
  verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'
  project: string
  fixture: string
  accounts: string[]
  summary: { total: number; pass: number; fail: number; inconclusive: number }
  cases: Array<NegativeEvaluation & { accountRef: string }>
}

const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key)/i

export function evaluateNegativePlan(input: NegativePlanInput): NegativePlanResult {
  validatePlan(input)
  const seen = new Set<string>()
  for (const current of input.cases) {
    const identity = `${current.accountRef}\u0000${current.caseId}`
    if (seen.has(identity)) throw new Error(`Duplicate negative plan case: ${current.accountRef}/${current.caseId}`)
    seen.add(identity)
  }

  const cases = input.cases.map(current => {
    if (current.authorization.length === 0) {
      return {
        verdict: 'INCONCLUSIVE' as const,
        message: 'INCONCLUSIVE_AUTHORIZATION: negative test authorization is missing',
        evidence: { caseId: current.caseId, expected: current.expected },
        accountRef: current.accountRef
      }
    }
    return { ...evaluateNegativeCase(current), accountRef: current.accountRef }
  })
  const summary = {
    total: cases.length,
    pass: cases.filter(current => current.verdict === 'PASS').length,
    fail: cases.filter(current => current.verdict === 'FAIL').length,
    inconclusive: cases.filter(current => current.verdict === 'INCONCLUSIVE').length
  }
  return {
    verdict: summary.fail > 0 ? 'FAIL' : summary.inconclusive > 0 ? 'INCONCLUSIVE' : 'PASS',
    project: input.project,
    fixture: input.fixture,
    accounts: [...new Set(input.cases.map(current => current.accountRef))].sort(),
    summary,
    cases
  }
}

function validatePlan(input: NegativePlanInput): void {
  if (!input || typeof input !== 'object') throw new Error('Invalid negative plan')
  validateText(input.project, 'plan project')
  validateText(input.fixture, 'plan fixture')
  if (!Array.isArray(input.cases) || input.cases.length === 0 || input.cases.length > 64) {
    throw new Error('Negative plan must contain at least one bounded case and no more than 64 cases')
  }
  for (const current of input.cases) {
    validateText(current.accountRef, 'account reference')
    if (CREDENTIAL_PATTERN.test(current.accountRef)) throw new Error('Credential-like account reference rejected')
    if (!Array.isArray(current.authorization) || current.authorization.length > 8) {
      throw new Error('Negative case authorization must be bounded')
    }
    for (const authorization of current.authorization) validateText(authorization, 'authorization')
  }
}

function validateText(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 128) {
    throw new Error(`Invalid ${label}`)
  }
  if (CREDENTIAL_PATTERN.test(value)) throw new Error(`Credential-like ${label} rejected`)
}
