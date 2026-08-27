export type GameplayVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE'

export interface GameplayStepObservation {
  id: string
  status: 'passed' | 'failed' | 'skipped'
  evidence: Record<string, unknown>
}

export interface GameplayJourneyInput {
  journeyId: string
  expectedSteps: string[]
  observedSteps: GameplayStepObservation[]
}

export interface GameplayEvaluation {
  verdict: GameplayVerdict
  message: string
  evidence: { journeyId: string; expectedSteps: string[]; observedSteps: string[]; failedStep?: string }
}

const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key)/i
const MAX_STEPS = 64
const MAX_EVIDENCE_BYTES = 8_192

export function evaluateGameplayJourney(input: GameplayJourneyInput): GameplayEvaluation {
  validateInput(input)
  const evidence = { journeyId: input.journeyId, expectedSteps: [...input.expectedSteps], observedSteps: input.observedSteps.map(step => step.id) }
  if (input.observedSteps.length < input.expectedSteps.length) return { verdict: 'INCONCLUSIVE', message: 'INCONCLUSIVE_GAMEPLAY_EVIDENCE: one or more expected steps were not observed', evidence }
  for (let index = 0; index < input.expectedSteps.length; index += 1) {
    const expected = input.expectedSteps[index]
    const observed = input.observedSteps[index]
    if (!observed || observed.id !== expected || observed.status !== 'passed') return { verdict: 'FAIL', message: `Gameplay journey step failed or was out of order: ${expected}`, evidence: { ...evidence, failedStep: expected } }
  }
  return { verdict: 'PASS', message: 'Gameplay journey completed in expected order', evidence }
}

function validateInput(input: GameplayJourneyInput): void {
  validateText(input.journeyId, 'journey ID')
  if (!Array.isArray(input.expectedSteps) || input.expectedSteps.length === 0 || input.expectedSteps.length > MAX_STEPS) throw new Error('Invalid expected gameplay steps')
  if (!Array.isArray(input.observedSteps) || input.observedSteps.length > MAX_STEPS) throw new Error('Invalid observed gameplay steps')
  for (const step of input.expectedSteps) validateText(step, 'expected gameplay step')
  for (const step of input.observedSteps) {
    if (!step || typeof step !== 'object') throw new Error('Invalid gameplay observation')
    validateText(step.id, 'observed gameplay step')
    if (!['passed', 'failed', 'skipped'].includes(step.status)) throw new Error('Invalid gameplay step status')
    const serialized = JSON.stringify(step.evidence)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_EVIDENCE_BYTES) throw new Error('Gameplay evidence exceeds bounded payload')
    if (CREDENTIAL_PATTERN.test(serialized)) throw new Error('Credential-like gameplay evidence rejected')
  }
}

function validateText(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 128) throw new Error(`Invalid ${label}`)
  if (CREDENTIAL_PATTERN.test(value)) throw new Error(`Credential-like ${label} rejected`)
}

void CREDENTIAL_PATTERN
