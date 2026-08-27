import { evaluateMultiClientRun, type MultiClientEvaluation, type MultiClientObservation } from './multi-client-contract.js'
import { failureEnvelope } from './failure-envelope.js'

export interface MultiClientRunnerInput {
  runId: string
  clientIds: string[]
  observe: (clientId: string) => Promise<MultiClientObservation>
}

export async function runMultiClient(input: MultiClientRunnerInput): Promise<MultiClientEvaluation> {
  const observations: MultiClientObservation[] = []
  for (const clientId of input.clientIds) {
    try {
      const observation = await input.observe(clientId)
      try {
        if (observation.clientId !== clientId) throw new Error('Provider returned mismatched client ID')
        evaluateMultiClientRun({ runId: input.runId, clients: [observation] })
        observations.push(observation)
      } catch (error) {
        if (observation.clientId === clientId && observation.status !== 'passed') {
          const withoutMalformedEvidence = { ...observation, evidence: {} }
          try {
            evaluateMultiClientRun({ runId: input.runId, clients: [withoutMalformedEvidence] })
            observations.push(withoutMalformedEvidence)
            continue
          } catch {
            // Invalid status/failure metadata must remain inconclusive.
          }
        }
        observations.push({
          clientId,
          status: 'skipped',
          evidence: {},
          failure: failureEnvelope({
            code: 'INCONCLUSIVE_OBSERVER',
            phase: 'validate-evidence',
            provider: 'multi-client-contract',
            error,
            retryable: false,
            trustBoundary: 'local-runtime'
          })
        })
      }
    } catch (error) {
      observations.push({
        clientId,
        status: 'skipped',
        evidence: {},
        failure: failureEnvelope({
          code: 'INCONCLUSIVE_OBSERVER',
          phase: 'observe-client',
          provider: 'minecraft-client',
          error,
          retryable: true,
          trustBoundary: 'external-provider'
        })
      })
    }
  }
  try {
    return evaluateMultiClientRun({ runId: input.runId, clients: observations })
  } catch (error) {
    const failure = failureEnvelope({
      code: 'INCONCLUSIVE_OBSERVER',
      phase: 'validate-evidence',
      provider: 'multi-client-contract',
      error,
      retryable: false,
      trustBoundary: 'local-runtime'
    })
    const preserved = observations.flatMap(observation => {
      if (observation.failure) return [{ clientId: observation.clientId, failure: observation.failure }]
      if (observation.status === 'skipped') return [{
        clientId: observation.clientId,
        failure: failureEnvelope({
          code: 'INCONCLUSIVE_OBSERVER',
          phase: 'observe-client',
          provider: 'multi-client-observer',
          error: new Error('Client observation unavailable without structured failure'),
          retryable: true,
          trustBoundary: 'external-provider'
        })
      }]
      if (observation.status !== 'failed') return []
      return [{
        clientId: observation.clientId,
        failure: failureEnvelope({
          code: 'FAIL_PRODUCT',
          phase: 'observe-client',
          provider: 'multi-client-observer',
          error: new Error('Client observation reported failed without structured failure'),
          retryable: false,
          trustBoundary: 'external-provider'
        })
      }]
    })
    const failures = [...preserved, { clientId: 'aggregate', failure }]
    const hasProductFailure = failures.some(entry => entry.failure.code.startsWith('FAIL_'))
    return {
      verdict: hasProductFailure ? 'FAIL' : 'INCONCLUSIVE',
      message: hasProductFailure
        ? 'One or more client observations failed; aggregate validation also failed'
        : 'INCONCLUSIVE_OBSERVER: provider observation validation failed',
      evidence: {
        runId: input.runId,
        clientIds: observations.map(client => client.clientId),
        pass: observations.filter(client => client.status === 'passed').length,
        fail: observations.filter(client => client.status === 'failed').length,
        inconclusive: observations.filter(client => client.status === 'skipped').length,
        failures
      }
    }
  }
}

void evaluateMultiClientRun
