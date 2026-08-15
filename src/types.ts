export type RunStatus = 'queued' | 'connecting' | 'running' | 'passed' | 'failed' | 'cancelled'

export interface GuiItemSnapshot {
  slot: number
  material: string
  displayName: string
  customName?: string
  lore: string[]
  count: number
  components?: unknown
  nbt?: unknown
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
  startedAt: string
  durationMs: number
  message: string
  evidence?: unknown
}

export interface TestReport {
  runId: string
  scenario: string
  status: RunStatus
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
