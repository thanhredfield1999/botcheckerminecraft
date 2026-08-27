import { evaluateGameplayJourney, type GameplayEvaluation, type GameplayStepObservation } from './gameplay-contract.js'

export interface GameplayRunnerInput {
  journeyId: string
  expectedSteps: string[]
  observe: (stepId: string) => Promise<GameplayStepObservation>
}

export async function runGameplayJourney(input: GameplayRunnerInput): Promise<GameplayEvaluation> {
  const observed: GameplayStepObservation[] = []
  for (const stepId of input.expectedSteps) {
    try { observed.push(await input.observe(stepId)) }
    catch (error) {
      const detail = error instanceof Error ? error.message.slice(0, 128) : 'provider failed'
      return { verdict: 'INCONCLUSIVE', message: `INCONCLUSIVE_GAMEPLAY_PROVIDER: ${detail}`, evidence: { journeyId: input.journeyId, expectedSteps: [...input.expectedSteps], observedSteps: observed.map(step => step.id) } }
    }
  }
  try { return evaluateGameplayJourney({ journeyId: input.journeyId, expectedSteps: input.expectedSteps, observedSteps: observed }) }
  catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 128) : 'validation failed'
    return { verdict: 'INCONCLUSIVE', message: `INCONCLUSIVE_GAMEPLAY_EVIDENCE: ${detail}`, evidence: { journeyId: input.journeyId, expectedSteps: [...input.expectedSteps], observedSteps: observed.map(step => step.id) } }
  }
}
