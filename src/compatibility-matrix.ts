export type CompatibilityVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE'

export interface CompatibilityObservation {
  negotiatedVersion?: string
  protocolVersion?: string | number
  pluginPresent?: boolean
  scenarioPassed?: boolean
}

export interface CompatibilityTargetInput {
  targetId: string
  minecraftVersion: string
  paperVersion: string
  expectedProtocol: string | number
  observed?: CompatibilityObservation
}

export interface CompatibilityMatrixInput {
  project: string
  fixture: string
  targets: CompatibilityTargetInput[]
}

export interface CompatibilityTargetResult {
  targetId: string
  minecraftVersion: string
  paperVersion: string
  verdict: CompatibilityVerdict
  message: string
  evidence: {
    expectedProtocol: string
    negotiatedVersion?: string
    observedProtocol?: string
    pluginPresent?: boolean
    scenarioPassed?: boolean
  }
}

export interface CompatibilityMatrixResult {
  verdict: CompatibilityVerdict
  project: string
  fixture: string
  summary: { total: number; pass: number; fail: number; inconclusive: number }
  targets: CompatibilityTargetResult[]
}

const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key)/i
const MAX_TARGETS = 32
const MAX_TEXT = 128

export function evaluateCompatibilityMatrix(input: CompatibilityMatrixInput): CompatibilityMatrixResult {
  validateText(input.project, 'project')
  validateText(input.fixture, 'fixture')
  if (!Array.isArray(input.targets) || input.targets.length === 0 || input.targets.length > MAX_TARGETS) {
    throw new Error('Compatibility matrix must contain bounded targets')
  }
  const seen = new Set<string>()
  const targets = input.targets.map(target => {
    validateTarget(target)
    if (seen.has(target.targetId)) throw new Error(`Duplicate compatibility target: ${target.targetId}`)
    seen.add(target.targetId)
    return evaluateTarget(target)
  })
  const summary = {
    total: targets.length,
    pass: targets.filter(target => target.verdict === 'PASS').length,
    fail: targets.filter(target => target.verdict === 'FAIL').length,
    inconclusive: targets.filter(target => target.verdict === 'INCONCLUSIVE').length
  }
  return {
    verdict: summary.fail > 0 ? 'FAIL' : summary.inconclusive > 0 ? 'INCONCLUSIVE' : 'PASS',
    project: input.project,
    fixture: input.fixture,
    summary,
    targets
  }
}

function evaluateTarget(target: CompatibilityTargetInput): CompatibilityTargetResult {
  const evidence: CompatibilityTargetResult['evidence'] = {
    expectedProtocol: String(target.expectedProtocol),
    ...(target.observed?.negotiatedVersion !== undefined ? { negotiatedVersion: target.observed.negotiatedVersion } : {}),
    ...(target.observed?.protocolVersion !== undefined ? { observedProtocol: String(target.observed.protocolVersion) } : {}),
    ...(target.observed?.pluginPresent !== undefined ? { pluginPresent: target.observed.pluginPresent } : {}),
    ...(target.observed?.scenarioPassed !== undefined ? { scenarioPassed: target.observed.scenarioPassed } : {})
  }
  if (!target.observed) return result(target, 'INCONCLUSIVE', 'INCONCLUSIVE_COMPATIBILITY_EVIDENCE: runtime observation missing', evidence)
  if (target.observed.negotiatedVersion === undefined || target.observed.protocolVersion === undefined || target.observed.pluginPresent === undefined || target.observed.scenarioPassed === undefined) {
    return result(target, 'INCONCLUSIVE', 'INCONCLUSIVE_COMPATIBILITY_EVIDENCE: runtime observation incomplete', evidence)
  }
  if (String(target.observed.protocolVersion) !== String(target.expectedProtocol) || !target.observed.pluginPresent || !target.observed.scenarioPassed) {
    return result(target, 'FAIL', 'Compatibility target failed protocol, plugin presence or scenario expectation', evidence)
  }
  return result(target, 'PASS', 'Compatibility target matched protocol, plugin presence and scenario expectation', evidence)
}

function result(target: CompatibilityTargetInput, verdict: CompatibilityVerdict, message: string, evidence: CompatibilityTargetResult['evidence']): CompatibilityTargetResult {
  return { targetId: target.targetId, minecraftVersion: target.minecraftVersion, paperVersion: target.paperVersion, verdict, message, evidence }
}

function validateTarget(target: CompatibilityTargetInput): void {
  validateText(target.targetId, 'target ID')
  validateText(target.minecraftVersion, 'Minecraft version')
  validateText(target.paperVersion, 'Paper version')
  validateText(String(target.expectedProtocol), 'expected protocol')
  if (target.observed) {
    if (target.observed.negotiatedVersion !== undefined) validateText(target.observed.negotiatedVersion, 'negotiated version')
    if (target.observed.protocolVersion !== undefined) validateText(String(target.observed.protocolVersion), 'observed protocol')
  }
}

function validateText(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_TEXT) throw new Error(`Invalid compatibility ${label}`)
  if (CREDENTIAL_PATTERN.test(value)) throw new Error(`Credential-like compatibility ${label} rejected`)
}

void CREDENTIAL_PATTERN
