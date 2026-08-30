import type { CapabilityManifest } from './capability-manifest.js'
import type { ArtifactTargetBinding } from './target-binding.js'

export type RunStatus = 'queued' | 'connecting' | 'running' | 'passed' | 'failed' | 'cancelled'
export type Verdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE'

export type EvidenceBinding =
  | { evidenceGrade: 'development-unbound'; releaseEligible: false }
  | {
      evidenceGrade: 'artifact-bound'
      releaseEligible: false
      targetBinding: ArtifactTargetBinding
      targetBindingSha256: string
    }

export interface SignedProviderEvidenceReference {
  schemaVersion: 1
  kind: 'signed-provider-observation-bound-envelope'
  artifactFileName: string
  artifactSha256: string
  verificationScope: 'SIGNATURE_ONLY_NON_RELEASE'
  signatureVerified: false
  freshnessEstablished: false
  replayChecked: false
  nonceConsumed: false
  releaseEligible: false
}

export interface RunManifest {
  schemaVersion: 1
  evidence: EvidenceBinding
  runner: { name: string; version: string; sourceRevision?: string }
  capability?: CapabilityManifest
  scenario: { name: string; sha256: string }
  signedProviderEvidence?: SignedProviderEvidenceReference
  authorizedPlan?: Readonly<{
    schemaVersion: 1
    scenario: string
    providers: ReadonlyArray<Readonly<{
      schemaVersion: 1
      kind: 'minecraft-client' | 'paper-process' | 'server-probe' | 'filesystem-snapshot' | 'sqlite-readonly' | 'log-observer' | 'vision-frame'
      id: string
      version: string
      instanceId?: string
      capabilities: readonly string[]
      authorization: Readonly<{ id: string; scope: readonly string[] }>
      targetRoot: string
      mutationClass: 'observe-only' | 'read-only' | 'client-session' | 'isolated-process-lifecycle'
    }>>
  }>
  qa?: {
    project: string
    fixture: string
    accountRole: string
    authorization: string[]
    phase?: 'persistence' | 'permission' | 'negative-security'
    execution?: {
      executionId: string
      beforeRunId: string
      afterRunId: string
      side: 'before' | 'after'
    }
  }
  persistence?: {
    kind: 'persistence'
    verdict: Verdict
    project: string
    fixture: string
    execution: { executionId: string; beforeRunId: string; afterRunId: string }
    evidence: { key?: string; restartEvidenceId?: string; changedKeys?: string[]; message: string }
  }
  compatibility?: {
    kind: 'compatibility'
    verdict: Verdict
    project: string
    fixture: string
    summary: { total: number; pass: number; fail: number; inconclusive: number }
    targets: Array<{
      targetId: string
      minecraftVersion: string
      paperVersion: string
      verdict: Verdict
      message: string
      evidence: Record<string, unknown>
    }>
  }
  transaction?: {
    kind: 'transaction'
    verdict: Verdict
    project: string
    fixture: string
    evidence: {
      transactionId: string
      expected: 'complete' | 'reject'
      accepted?: boolean
      balanceDeltaMinor?: number
      itemDelta?: number
      message: string
    }
  }
  crashRecovery?: {
    kind: 'crash-recovery'
    verdict: Verdict
    project: string
    fixture: string
    evidence: {
      executionId: string
      crashEvidenceId?: string
      recoveryEvidenceId?: string
      exitCode?: number
      message: string
    }
  }
  gui?: {
    kind: 'gui'
    verdict: Verdict
    project: string
    fixture: string
    evidence: Record<string, unknown>
  }
  gameplay?: {
    kind: 'gameplay'
    verdict: Verdict
    project: string
    fixture: string
    evidence: Record<string, unknown>
  }
  multiClient?: {
    kind: 'multi-client'
    verdict: Verdict
    project: string
    fixture: string
    evidence: Record<string, unknown>
  }
  qaPlan?: {
    kind: 'permission' | 'negative-security'
    verdict: Verdict
    project: string
    fixture: string
    accounts: string[]
    summary: { total: number; pass: number; fail: number; inconclusive: number }
    cells: Array<{
      accountRef: string
      role?: string
      action?: string
      caseId?: string
      verdict: Verdict
      message: string
      authorizationCount: number
      mutationCount?: number
    }>
  }
  target: { host: string; port: number; configuredVersion?: string }
  observed: {
    negotiatedVersion?: string
    protocolVersion?: string | number
    serverWorld?: string
    dimension?: string
  }
}

export interface GuiItemSnapshot {
  slot: number
  section: 'top' | 'player'
  material: string
  displayName: string
  customName?: string
  lore: string[]
  count: number
}

export interface GuiSnapshot {
  id: number
  type: string
  title: string
  topSlotCount: number
  totalSlotCount: number
  inventoryStart: number
  /** Compatibility alias for totalSlotCount. */
  slotCount: number
  items: GuiItemSnapshot[]
}

export interface TimelineEvent {
  at: string
  elapsedMs: number
  type: string
  summary: string
  data?: unknown
}

export interface StepResult {
  id: string
  action: string
  status: 'passed' | 'failed' | 'skipped'
  verdict: Verdict
  startedAt: string
  durationMs: number
  message: string
  evidence?: unknown
}

export interface TestReport {
  runId: string
  scenario: string
  status: RunStatus
  verdict: Verdict
  manifest: RunManifest
  startedAt: string
  finishedAt?: string
  durationMs: number
  summary: {
    total: number
    passed: number
    failed: number
    skipped: number
  }
  steps: StepResult[]
  issues: Array<{ severity: 'high' | 'medium' | 'low'; stepId: string; message: string }>
  timeline: TimelineEvent[]
  telemetry?: {
    type: string
    schemaVersion: number
    inputSha256: string
    eventCount: number
    totalRecorded: number
    capacity: number
    issueCount: number
  }
}
