import { createHash, randomUUID } from 'node:crypto'
import { open } from 'node:fs/promises'
import runnerPackage from '../package.json' with { type: 'json' }
import {
  analyzeLivingNpcTelemetry,
  parseLivingNpcTelemetryString,
  telemetryToTimelineEvents,
  type LivingNpcTelemetryAnalysisOptions,
  type LivingNpcTelemetryEvidence,
  type LivingNpcTelemetryParseOptions,
  type LivingNpcTelemetrySnapshot
} from './livingnpc-telemetry.js'
import type { RunManifest, StepResult, TestReport, Verdict } from './types.js'
import { evidenceBinding } from './target-binding.js'

const DEFAULT_REPORT_MAX_BYTES = 1_048_576

export interface LivingNpcTelemetryReportOptions
  extends LivingNpcTelemetryParseOptions, LivingNpcTelemetryAnalysisOptions {
  runId?: string
  sourceRevision?: string
}

export interface LivingNpcTelemetryReportMetadata {
  type: 'livingnpc-telemetry-report'
  schemaVersion: 1
  inputSha256: string
  eventCount: number
  totalRecorded: number
  capacity: number
  issueCount: number
}

export interface LivingNpcTelemetryTestReport extends TestReport {
  telemetry: LivingNpcTelemetryReportMetadata
}

export async function buildLivingNpcTelemetryReportFromFile(
  file: string,
  options: LivingNpcTelemetryReportOptions = {}
): Promise<LivingNpcTelemetryTestReport> {
  const payload = await readBoundedTextFile(file, options.maxBytes ?? DEFAULT_REPORT_MAX_BYTES)
  return buildLivingNpcTelemetryReportFromString(payload, options)
}

export function buildLivingNpcTelemetryReportFromString(
  payload: string,
  options: LivingNpcTelemetryReportOptions = {}
): LivingNpcTelemetryTestReport {
  const snapshot = parseLivingNpcTelemetryString(payload, options)
  return buildLivingNpcTelemetryReport(snapshot, payload, options)
}

export function buildLivingNpcTelemetryReport(
  snapshot: LivingNpcTelemetrySnapshot,
  payload: string,
  options: LivingNpcTelemetryReportOptions = {}
): LivingNpcTelemetryTestReport {
  const timeline = telemetryToTimelineEvents(snapshot)
  const evidence = analyzeLivingNpcTelemetry(snapshot, options)
  const steps = evidence.map(evidenceToStep)
  const verdict = reportVerdict(evidence)
  const status = verdict === 'PASS' ? 'passed' : 'failed'
  const startedAt = timeline[0]?.at ?? new Date(0).toISOString()
  const finishedAt = timeline.at(-1)?.at ?? startedAt
  const durationMs = timeline.at(-1)?.elapsedMs ?? 0
  const runId = options.runId ?? randomUUID()

  return {
    runId,
    scenario: 'livingnpc-telemetry',
    status,
    verdict,
    manifest: manifest(snapshot, options),
    startedAt,
    finishedAt,
    durationMs,
    summary: {
      total: steps.length,
      passed: steps.filter(step => step.status === 'passed').length,
      failed: steps.filter(step => step.status === 'failed').length,
      skipped: steps.filter(step => step.status === 'skipped').length
    },
    steps,
    issues: evidence.map(item => ({
      severity: item.severity,
      stepId: evidenceStepId(item),
      message: item.message
    })),
    timeline,
    telemetry: {
      type: 'livingnpc-telemetry-report',
      schemaVersion: 1,
      inputSha256: createHash('sha256').update(payload).digest('hex'),
      eventCount: snapshot.events.length,
      totalRecorded: snapshot.totalRecorded,
      capacity: snapshot.capacity,
      issueCount: evidence.length
    }
  }
}

function evidenceToStep(item: LivingNpcTelemetryEvidence): StepResult {
  return {
    id: evidenceStepId(item),
    action: 'analyze_livingnpc_telemetry',
    status: 'failed',
    verdict: item.verdict,
    startedAt: evidenceStartedAt(item),
    durationMs: 0,
    message: item.message,
    evidence: item
  }
}

function evidenceStepId(item: LivingNpcTelemetryEvidence): string {
  switch (item.code) {
    case 'LIVINGNPC_ROLE_MISMATCH':
    case 'LIVINGNPC_STUCK_PATH_ABSENT':
      return `livingnpc.telemetry.event.${item.eventIndex}`
    case 'LIVINGNPC_SEMANTIC_TARGET_COLLISION':
      return `livingnpc.telemetry.semantic-target.${item.eventIndexes.join('-')}`
  }
}

function evidenceStartedAt(item: LivingNpcTelemetryEvidence): string {
  return new Date(item.timestampMillis).toISOString()
}

function reportVerdict(evidence: LivingNpcTelemetryEvidence[]): Verdict {
  if (evidence.some(item => item.verdict === 'FAIL')) return 'FAIL'
  if (evidence.some(item => item.verdict === 'INCONCLUSIVE')) return 'INCONCLUSIVE'
  return 'PASS'
}

function manifest(snapshot: LivingNpcTelemetrySnapshot, options: LivingNpcTelemetryReportOptions): RunManifest {
  const sourceRevision = (options.sourceRevision ?? process.env.GIT_COMMIT)?.trim() || undefined
  const worlds = [...new Set(snapshot.events.map(event => event.world))].sort()
  return {
    schemaVersion: 1,
    evidence: evidenceBinding(),
    runner: {
      name: runnerPackage.name,
      version: runnerPackage.version,
      ...(sourceRevision ? { sourceRevision } : {})
    },
    scenario: {
      name: 'livingnpc-telemetry',
      sha256: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
    },
    target: {
      host: 'livingnpc-telemetry',
      port: 0,
      auth: 'offline'
    },
    observed: {
      serverWorld: worlds.length === 1 ? worlds[0] : worlds.length > 1 ? worlds.join(',') : undefined
    }
  }
}

async function readBoundedTextFile(file: string, maxBytes: number): Promise<string> {
  const handle = await open(file, 'r')
  try {
    const buffer = Buffer.alloc(maxBytes + 1)
    const { bytesRead } = await handle.read(buffer, 0, maxBytes + 1, 0)
    if (bytesRead > maxBytes) throw new Error(`LivingNPC telemetry payload too large: ${bytesRead} > ${maxBytes}`)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}
