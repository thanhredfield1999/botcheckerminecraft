import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateGameplayJourney } from '../src/gameplay-contract.js'
import { evaluateMultiClientRun } from '../src/multi-client-contract.js'
import { buildGameplayReport, buildMultiClientReport } from '../src/journey-reports.js'
import { runMultiClient } from '../src/multi-client-runner.js'

test('journey reports giữ aggregate verdict và bounded evidence', () => {
  const gameplay = buildGameplayReport(evaluateGameplayJourney({ journeyId: 'flow', expectedSteps: ['open'], observedSteps: [{ id: 'open', status: 'passed', evidence: {} }] }), 'Plugin', 'fixture')
  const clients = buildMultiClientReport(evaluateMultiClientRun({ runId: 'run', clients: [{ clientId: 'a', status: 'passed', evidence: {} }] }), 'Plugin', 'fixture')
  assert.equal(gameplay.kind, 'gameplay')
  assert.equal(clients.kind, 'multi-client')
  assert.equal(gameplay.verdict, 'PASS')
  assert.equal(clients.verdict, 'PASS')
})

test('journey reports reject sensitive evidence', () => {
  const result = evaluateGameplayJourney({ journeyId: 'flow', expectedSteps: ['open'], observedSteps: [{ id: 'open', status: 'passed', evidence: {} }] })
  assert.throws(() => buildGameplayReport({ ...result, evidence: { ...result.evidence, journeyId: 'token-flow' } }, 'Plugin', 'fixture'), /credential/i)
})

test('multi-client summary bảo toàn structured provider counterexample', async () => {
  const result = await runMultiClient({
    runId: 'run-summary-failure', clientIds: ['client-a'],
    observe: async () => { throw new RangeError('observer sample outside bounded window') }
  })
  const report = buildMultiClientReport(result, 'ItemGuard', 'controlled-fixture')

  assert.equal(report.verdict, 'INCONCLUSIVE')
  assert.deepEqual(report.evidence.failures, [{
    clientId: 'client-a',
    failure: {
      code: 'INCONCLUSIVE_OBSERVER',
      phase: 'observe-client',
      provider: 'minecraft-client',
      causeClass: 'RangeError',
      boundedDetail: 'observer sample outside bounded window',
      artifactRefs: [],
      retryable: true,
      trustBoundary: 'external-provider'
    }
  }])
})

void assert
