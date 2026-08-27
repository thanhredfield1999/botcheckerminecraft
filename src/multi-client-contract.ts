import { failureEnvelope, validateFailureEnvelope, type FailureEnvelope } from './failure-envelope.js'

export type MultiClientVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE'

export interface MultiClientObservation {
  clientId: string
  status: 'passed' | 'failed' | 'skipped'
  evidence: Record<string, unknown>
  failure?: FailureEnvelope
}

export interface MultiClientInput {
  runId: string
  clients: MultiClientObservation[]
}

export interface MultiClientEvaluation {
  verdict: MultiClientVerdict
  message: string
  evidence: {
    runId: string
    clientIds: string[]
    pass: number
    fail: number
    inconclusive: number
    failures: Array<{ clientId: string; failure: FailureEnvelope }>
  }
}

const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key)/i
const MAX_CLIENTS = 16
const MAX_EVIDENCE_BYTES = 8_192

export function evaluateMultiClientRun(input: MultiClientInput): MultiClientEvaluation {
  validateInput(input)
  const pass = input.clients.filter(client => client.status === 'passed').length
  const fail = input.clients.filter(client => client.status === 'failed').length
  const inconclusive = input.clients.filter(client => client.status === 'skipped').length
  const failures = input.clients.flatMap(client => {
    if (client.status === 'passed') return []
    const failure = client.failure ?? (client.status === 'failed'
      ? failureEnvelope({
          code: 'FAIL_PRODUCT', phase: 'observe-client', provider: 'multi-client-observer',
          error: new Error('Client observation reported failed without structured failure'),
          retryable: false, trustBoundary: 'external-provider'
        })
      : failureEnvelope({
          code: 'INCONCLUSIVE_OBSERVER', phase: 'observe-client', provider: 'multi-client-observer',
          error: new Error('Client observation unavailable without structured failure'),
          retryable: true, trustBoundary: 'external-provider'
        }))
    return [{ clientId: client.clientId, failure }]
  })
  const evidence = {
    runId: input.runId,
    clientIds: input.clients.map(client => client.clientId),
    pass,
    fail,
    inconclusive,
    failures
  }
  if (fail > 0) return { verdict: 'FAIL', message: 'One or more client observations failed', evidence }
  if (input.clients.length === 0 || inconclusive > 0) {
    return {
      verdict: 'INCONCLUSIVE',
      message: 'INCONCLUSIVE_OBSERVER: one or more client observations unavailable',
      evidence
    }
  }
  return { verdict: 'PASS', message: 'All client observations passed', evidence }
}

function validateInput(input: MultiClientInput): void {
  if (!input || typeof input !== 'object') throw new Error('Invalid multi-client input')
  validateText(input.runId, 'multi-client run ID')
  if (!Array.isArray(input.clients) || input.clients.length > MAX_CLIENTS) throw new Error('Multi-client set exceeds bounded limit')
  const ids = new Set<string>()
  for (const client of input.clients) {
    if (!client || typeof client !== 'object') throw new Error('Invalid multi-client observation')
    validateText(client.clientId, 'client ID')
    if (ids.has(client.clientId)) throw new Error('Duplicate client ID')
    ids.add(client.clientId)
    if (!['passed', 'failed', 'skipped'].includes(client.status)) throw new Error('Invalid client status')
    if (client.failure !== undefined) validateFailureEnvelope(client.failure)
    if (client.status === 'passed' && client.failure !== undefined) throw new Error('Passed client cannot carry failure envelope')
    if (client.status === 'failed' && client.failure?.code.startsWith('INCONCLUSIVE_')) {
      throw new Error('Failed client requires FAIL_* failure code')
    }
    if (client.status === 'skipped' && client.failure?.code.startsWith('FAIL_')) {
      throw new Error('Skipped client requires INCONCLUSIVE_* failure code')
    }
    const serialized = JSON.stringify(client.evidence)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_EVIDENCE_BYTES) throw new Error('Multi-client evidence exceeds bounded payload')
    if (CREDENTIAL_PATTERN.test(serialized)) throw new Error('Credential-like multi-client evidence rejected')
  }
}

function validateText(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 128) throw new Error(`Invalid ${label}`)
  if (CREDENTIAL_PATTERN.test(value)) throw new Error(`Credential-like ${label} rejected`)
}

void CREDENTIAL_PATTERN
