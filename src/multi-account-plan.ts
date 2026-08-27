export interface MultiAccountPlanAccount {
  accountRef: string
  role: string
  order: number
}

export interface MultiAccountPlanInput {
  project: string
  fixture: string
  authorization: string[]
  accounts: MultiAccountPlanAccount[]
  maxConcurrent?: number
}

export interface MultiAccountPlanResult {
  verdict: 'PASS' | 'INCONCLUSIVE'
  project: string
  fixture: string
  authorization: string[]
  maxConcurrent: 1
  accounts: Array<MultiAccountPlanAccount & { status: 'READY' | 'INCONCLUSIVE' }>
}

const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key)/i
const MAX_ACCOUNTS = 16

export function buildMultiAccountPlan(input: MultiAccountPlanInput): MultiAccountPlanResult {
  validateText(input.project, 'project')
  validateText(input.fixture, 'fixture')
  if (!Array.isArray(input.authorization) || input.authorization.length > 8) throw new Error('Authorization must be bounded')
  for (const value of input.authorization) validateText(value, 'authorization')
  if (!Array.isArray(input.accounts) || input.accounts.length === 0 || input.accounts.length > MAX_ACCOUNTS) {
    throw new Error('Multi-account plan must contain 1-16 bounded accounts')
  }
  if (input.maxConcurrent !== undefined && input.maxConcurrent !== 1) {
    throw new Error('Multi-account plan is sequential; maxConcurrent must be 1')
  }
  const sorted = [...input.accounts].sort((left, right) => left.order - right.order)
  const seenRefs = new Set<string>()
  const seenOrders = new Set<number>()
  for (const account of sorted) {
    validateText(account.accountRef, 'account reference')
    validateText(account.role, 'role')
    if (CREDENTIAL_PATTERN.test(account.accountRef)) throw new Error('Credential-like account reference rejected')
    if (!Number.isInteger(account.order) || account.order < 1 || account.order > MAX_ACCOUNTS) throw new Error('Invalid account order')
    if (seenRefs.has(account.accountRef)) throw new Error(`Duplicate account reference: ${account.accountRef}`)
    if (seenOrders.has(account.order)) throw new Error(`Duplicate account order: ${account.order}`)
    seenRefs.add(account.accountRef)
    seenOrders.add(account.order)
  }
  const ready = input.authorization.length > 0
  return {
    verdict: ready ? 'PASS' : 'INCONCLUSIVE',
    project: input.project,
    fixture: input.fixture,
    authorization: [...input.authorization],
    maxConcurrent: 1,
    accounts: sorted.map(account => ({ ...account, status: ready ? 'READY' : 'INCONCLUSIVE' }))
  }
}

function validateText(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 128) throw new Error(`Invalid ${label}`)
  if (CREDENTIAL_PATTERN.test(value)) throw new Error(`Credential-like ${label} rejected`)
}
