export type PermissionExpectation = 'allow' | 'deny'
export type PermissionVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE'

export interface PermissionObservation {
  allowed: boolean
  stateBefore: Record<string, unknown>
  stateAfter: Record<string, unknown>
}

export interface PermissionCellInput {
  role: string
  action: string
  expected: PermissionExpectation
  observed?: PermissionObservation
  stateChange?: Record<string, 'changed' | 'unchanged'>
}

export interface PermissionEvaluation {
  verdict: PermissionVerdict
  message: string
  evidence: {
    role: string
    action: string
    expected: PermissionExpectation
    observedAllowed?: boolean
    changedKeys?: string[]
    authorization?: string[]
  }
}

const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key)/i

export function evaluatePermissionCell(input: PermissionCellInput): PermissionEvaluation {
  validateText(input.role, 'role')
  validateText(input.action, 'action')
  if (CREDENTIAL_PATTERN.test(input.role) || CREDENTIAL_PATTERN.test(input.action)) {
    throw new Error('Credential-like permission evidence rejected')
  }

  const evidence = {
    role: input.role,
    action: input.action,
    expected: input.expected,
    ...(input.observed ? { observedAllowed: input.observed.allowed } : {})
  }
  if (!input.observed) {
    return {
      verdict: 'INCONCLUSIVE',
      message: 'INCONCLUSIVE_PERMISSION_OBSERVATION: permission response or state snapshot missing',
      evidence
    }
  }

  const changedKeys = changedStateKeys(input.observed.stateBefore, input.observed.stateAfter)
  const resultEvidence = { ...evidence, ...(changedKeys.length ? { changedKeys } : {}) }
  const allowedExpected = input.expected === 'allow'
  if (input.observed.allowed !== allowedExpected) {
    return {
      verdict: 'FAIL',
      message: `Expected permission ${input.expected}, observed ${input.observed.allowed ? 'allow' : 'deny'}`,
      evidence: resultEvidence
    }
  }

  if (input.expected === 'deny' && changedKeys.length > 0) {
    return {
      verdict: 'FAIL',
      message: 'Permission deny mutated protected state',
      evidence: resultEvidence
    }
  }

  if (input.stateChange) {
    const expectedChanged = Object.entries(input.stateChange)
      .filter(([, expectation]) => expectation === 'changed')
      .map(([key]) => key)
    const expectedUnchanged = Object.entries(input.stateChange)
      .filter(([, expectation]) => expectation === 'unchanged')
      .map(([key]) => key)
    const missingChanges = expectedChanged.filter(key => !changedKeys.includes(key))
    const unexpectedChanges = expectedUnchanged.filter(key => changedKeys.includes(key))
    if (missingChanges.length || unexpectedChanges.length) {
      return {
        verdict: 'FAIL',
        message: 'Permission allow state invariant did not match expectation',
        evidence: { ...resultEvidence, changedKeys: [...new Set([...changedKeys, ...missingChanges, ...unexpectedChanges])].sort() }
      }
    }
  }

  return {
    verdict: 'PASS',
    message: input.expected === 'allow'
      ? 'Permission allow matched and state invariant held'
      : 'Permission deny matched and state invariant held',
    evidence: resultEvidence
  }
}

function validateText(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 128) {
    throw new Error(`Invalid permission ${label}`)
  }
}

function changedStateKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys({ ...before, ...after })
    .filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort()
}
