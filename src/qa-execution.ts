import { evaluatePersistence, type PersistenceEvaluation, type PersistenceEvaluationInput } from './persistence-contract.js'

export interface PersistenceExecutionInput {
  executionId: string
  beforeRunId: string
  afterRunId: string
  persistence: PersistenceEvaluationInput
}

export interface PersistenceExecutionResult extends PersistenceEvaluation {
  execution: {
    executionId: string
    beforeRunId: string
    afterRunId: string
  }
}

const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key)/i
const RUN_ID_PATTERN = /^[a-zA-Z0-9._:-]{1,128}$/

export function evaluatePersistenceExecution(input: PersistenceExecutionInput): PersistenceExecutionResult {
  validateRunId(input.executionId, 'execution ID')
  validateRunId(input.beforeRunId, 'before run ID')
  validateRunId(input.afterRunId, 'after run ID')
  if (input.beforeRunId === input.afterRunId) {
    return {
      verdict: 'INCONCLUSIVE',
      message: 'INCONCLUSIVE_EXECUTION_CONTEXT: before and after runs must be distinct',
      evidence: { key: input.persistence.before.key },
      execution: executionMetadata(input)
    }
  }

  const result = evaluatePersistence(input.persistence)
  return { ...result, execution: executionMetadata(input) }
}

function executionMetadata(input: PersistenceExecutionInput): PersistenceExecutionResult['execution'] {
  return {
    executionId: input.executionId,
    beforeRunId: input.beforeRunId,
    afterRunId: input.afterRunId
  }
}

function validateRunId(value: string, label: string): void {
  if (typeof value !== 'string' || !RUN_ID_PATTERN.test(value)) throw new Error(`Invalid ${label}`)
  if (CREDENTIAL_PATTERN.test(value)) throw new Error(`Credential-like ${label} rejected`)
}
