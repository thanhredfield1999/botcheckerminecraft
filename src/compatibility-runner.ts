import { evaluateCompatibilityMatrix, type CompatibilityMatrixResult, type CompatibilityObservation, type CompatibilityTargetInput } from './compatibility-matrix.js'

export interface CompatibilityRunnerInput {
  project: string
  fixture: string
  targets: Omit<CompatibilityTargetInput, 'observed'>[]
  observe: (target: Omit<CompatibilityTargetInput, 'observed'>) => Promise<CompatibilityObservation>
}

export async function runCompatibilityMatrix(input: CompatibilityRunnerInput): Promise<CompatibilityMatrixResult> {
  const targets: CompatibilityTargetInput[] = []
  for (const target of input.targets) {
    try {
      targets.push({ ...target, observed: await input.observe(target) })
    } catch {
      targets.push({ ...target })
    }
  }
  try {
    return evaluateCompatibilityMatrix({ project: input.project, fixture: input.fixture, targets })
  } catch {
    return {
      verdict: 'INCONCLUSIVE', project: input.project, fixture: input.fixture,
      summary: { total: targets.length, pass: 0, fail: 0, inconclusive: targets.length },
      targets: targets.map(target => ({
        targetId: target.targetId, minecraftVersion: target.minecraftVersion, paperVersion: target.paperVersion,
        verdict: 'INCONCLUSIVE', message: 'INCONCLUSIVE_COMPATIBILITY_PROVIDER: target observation unavailable',
        evidence: { expectedProtocol: String(target.expectedProtocol) }
      }))
    }
  }
}

void evaluateCompatibilityMatrix
