import type { CompatibilityMatrixResult, CompatibilityTargetResult } from './compatibility-matrix.js'

export interface CompatibilityReport {
  kind: 'compatibility'
  verdict: CompatibilityMatrixResult['verdict']
  project: string
  fixture: string
  summary: CompatibilityMatrixResult['summary']
  targets: Array<Pick<CompatibilityTargetResult, 'targetId' | 'minecraftVersion' | 'paperVersion' | 'verdict' | 'message' | 'evidence'>>
}

const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key)/i
const MAX_TARGETS = 32

export function buildCompatibilityReport(matrix: CompatibilityMatrixResult): CompatibilityReport {
  if (!['PASS', 'FAIL', 'INCONCLUSIVE'].includes(matrix.verdict)) throw new Error('Invalid compatibility report verdict')
  if (!Array.isArray(matrix.targets) || matrix.targets.length === 0 || matrix.targets.length > MAX_TARGETS) {
    throw new Error('Compatibility report targets exceed bounded limit')
  }
  const targets = matrix.targets.map(target => {
    const reportTarget = {
      targetId: target.targetId,
      minecraftVersion: target.minecraftVersion,
      paperVersion: target.paperVersion,
      verdict: target.verdict,
      message: target.message,
      evidence: { ...target.evidence }
    }
    if (CREDENTIAL_PATTERN.test(JSON.stringify(reportTarget))) throw new Error('Credential-like compatibility report rejected')
    return reportTarget
  })
  const summary = {
    total: targets.length,
    pass: targets.filter(target => target.verdict === 'PASS').length,
    fail: targets.filter(target => target.verdict === 'FAIL').length,
    inconclusive: targets.filter(target => target.verdict === 'INCONCLUSIVE').length
  }
  return {
    kind: 'compatibility', verdict: summary.fail > 0 ? 'FAIL' : summary.inconclusive > 0 ? 'INCONCLUSIVE' : 'PASS',
    project: matrix.project, fixture: matrix.fixture, summary, targets
  }
}

void CREDENTIAL_PATTERN
