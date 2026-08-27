export type NegativeExpectation = 'reject' | 'no-mutation'
export type NegativeVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE'

export interface NegativeObservation {
  rejected: boolean
  mutationCount: number
  evidence: Record<string, unknown>
}

export interface NegativeCaseInput {
  caseId: string
  expected: NegativeExpectation
  observed?: NegativeObservation
}

export interface NegativeEvaluation {
  verdict: NegativeVerdict
  message: string
  evidence: {
    caseId: string
    expected: NegativeExpectation
    rejected?: boolean
    mutationCount?: number
  }
}

const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key)/i
const MAX_EVIDENCE_BYTES = 8_192

export function evaluateNegativeCase(input: NegativeCaseInput): NegativeEvaluation {
  validateCaseId(input.caseId)
  if (!['reject', 'no-mutation'].includes(input.expected)) throw new Error('Invalid negative expectation')
  const baseEvidence = { caseId: input.caseId, expected: input.expected }
  if (!input.observed) {
    return {
      verdict: 'INCONCLUSIVE',
      message: 'INCONCLUSIVE_NEGATIVE_EVIDENCE: observed rejection and mutation state missing',
      evidence: baseEvidence
    }
  }
  if (!Number.isInteger(input.observed.mutationCount) || input.observed.mutationCount < 0) {
    throw new Error('Invalid mutation count')
  }
  const serializedEvidence = JSON.stringify(input.observed.evidence)
  if (Buffer.byteLength(serializedEvidence, 'utf8') > MAX_EVIDENCE_BYTES) {
    throw new Error('Negative evidence exceeds bounded payload')
  }
  if (CREDENTIAL_PATTERN.test(serializedEvidence)) throw new Error('Credential-like negative evidence rejected')

  const evidence = {
    ...baseEvidence,
    rejected: input.observed.rejected,
    mutationCount: input.observed.mutationCount
  }
  if (input.expected === 'reject' && !input.observed.rejected) {
    return {
      verdict: 'FAIL',
      message: 'Negative request was accepted instead of rejected',
      evidence
    }
  }
  if (input.observed.mutationCount !== 0) {
    return {
      verdict: 'FAIL',
      message: 'Negative request caused state mutation',
      evidence
    }
  }
  return {
    verdict: 'PASS',
    message: input.expected === 'reject'
      ? 'Negative case rejected safely with no mutation'
      : 'Negative case completed with no mutation',
    evidence
  }
}

function validateCaseId(caseId: string): void {
  if (typeof caseId !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(caseId)) {
    throw new Error('Invalid negative case ID')
  }
  if (CREDENTIAL_PATTERN.test(caseId)) throw new Error('Credential-like negative case ID rejected')
}
