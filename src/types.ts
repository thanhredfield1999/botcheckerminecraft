export type RunStatus = 'queued' | 'connecting' | 'running' | 'passed' | 'failed' | 'cancelled'
export type Verdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE'

export interface RunManifest {
  schemaVersion: 1
  runner: { name: string; version: string; sourceRevision?: string }
  scenario: { name: string; sha256: string }
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
}
