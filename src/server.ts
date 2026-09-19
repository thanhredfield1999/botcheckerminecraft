import Fastify from 'fastify'
import { timingSafeEqual } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { z } from 'zod'
import { config } from './config.js'
import { loadScenario, type Scenario } from './scenario.js'
import { TestRun, type TestRunDependencies } from './runner.js'
import { createVisionEvaluator } from './vision-evaluator.js'
import { RunQueue } from './queue.js'
import type { RunStatus } from './types.js'
import { runtimeCapabilityManifest, type CapabilityManifest } from './capability-manifest.js'
import {
  assertProviderRegistryResolution,
  InvalidAuthorizedPlanError,
  ProviderAdmissionError,
  type ProviderRegistry,
  type ResolvedAuthorizedPlan
} from './provider-registry.js'
import {
  loadArtifactTargetBindingFile,
  type ArtifactTargetBinding
} from './target-binding.js'

const createRunSchema = z.strictObject({ scenario: z.string().regex(/^[a-zA-Z0-9_-]+$/) })
const createAuthorizedRunSchema = z.strictObject({ authorizedPlan: z.unknown() })

interface ManagedRun {
  readonly id: string
  status: RunStatus
  start(): Promise<void>
  cancel(): void
  persistCancelled(): Promise<void>
  view(): unknown
  report(): unknown
  attachQaPlan?(kind: 'permission' | 'negative-security', result: unknown): void
}

interface QaPlanEntry {
  readonly accountRef: string
  readonly verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'
  readonly message: string
  readonly evidence?: unknown
}

interface QaPlanExecutor {
  readonly kind: 'permission' | 'negative-security'
  run(scenario: Scenario): Promise<{
    verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'
    project: string
    fixture: string
    accounts: readonly string[]
    summary: { total: number; pass: number; fail: number; inconclusive: number }
    cells?: readonly QaPlanEntry[]
    cases?: readonly QaPlanEntry[]
  }>
}

interface ServerOptions {
  queueCapacity?: number
  maxRetainedRuns?: number
  apiCredential?: string
  scenarioLoader?: (directory: string, name: string) => Promise<Scenario>
  runFactory?: (
    scenario: Scenario,
    resolvedPlan?: Readonly<ResolvedAuthorizedPlan>
  ) => ManagedRun
  providerRegistry?: ProviderRegistry
  qaPlanExecutor?: QaPlanExecutor
  capabilityManifestCollector?: () => CapabilityManifest
  targetBindingFile?: string
  targetBindingLoader?: (file: string) => ArtifactTargetBinding
  logger?: boolean
}

class ScenarioNotFoundError extends Error {}

function credentialMatches(expected: string, provided: string | undefined): boolean {
  if (provided === undefined) return false
  const expectedBytes = Buffer.from(expected, 'utf8')
  const providedBytes = Buffer.from(provided, 'utf8')
  // So sánh constant-time; độ dài khác vẫn phải tiêu tốn cùng lượng công việc.
  const padded = Buffer.alloc(expectedBytes.byteLength)
  providedBytes.copy(padded, 0, 0, Math.min(providedBytes.byteLength, padded.byteLength))
  return timingSafeEqual(expectedBytes, padded) && providedBytes.byteLength === expectedBytes.byteLength
}

export function createServer(options: ServerOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true })
  const runs = new Map<string, ManagedRun>()
  const queue = new RunQueue(options.queueCapacity ?? config.queueCapacity)
  const maxRetainedRuns = options.maxRetainedRuns ?? config.maxRetainedRuns
  const apiCredential = options.apiCredential ?? config.apiCredential
  const scenarioLoader = options.scenarioLoader ?? loadScenario
  const providerRegistry = options.providerRegistry
  const qaPlanExecutor = options.qaPlanExecutor
  const capabilityManifest = options.runFactory
    ? undefined
    : (options.capabilityManifestCollector ?? runtimeCapabilityManifest)()
  const targetBindingFile = options.targetBindingFile ?? config.targetBindingFile
  const targetBinding = options.runFactory || !targetBindingFile
    ? undefined
    : (options.targetBindingLoader ?? loadArtifactTargetBindingFile)(targetBindingFile)
  const runFactory = options.runFactory ?? ((
    scenario: Scenario,
    resolvedPlan?: Readonly<ResolvedAuthorizedPlan>
  ) => {
    if (!capabilityManifest) throw new Error('Capability manifest unavailable')
    // Vision evaluator: chỉ bật khi cấu hình đủ; API key đọc từ env lúc chạy,
    // không bao giờ đi qua HTTP/report/repo.
    let visionEvaluator: TestRunDependencies['visionEvaluator'] | undefined
    let visionApiKey: string | undefined
    if (config.vision.baseUrl && config.vision.model) {
      try {
        visionEvaluator = createVisionEvaluator({
          config: {
            apiKeyEnvVariable: config.vision.apiKeyEnvVariable,
            baseUrl: config.vision.baseUrl,
            model: config.vision.model,
            timeoutMs: config.vision.timeoutMs,
            maxResponseBytes: config.vision.maxResponseBytes
          }
        })
        visionApiKey = process.env[config.vision.apiKeyEnvVariable]
      } catch {
        // Cấu hình sai -> không wire evaluator; assert_vision sẽ INCONCLUSIVE.
        visionEvaluator = undefined
        visionApiKey = undefined
      }
    }
    return new TestRun(scenario, config.minecraft, config.reportDir, {
      protocolDiagnosticsEnabled: config.protocolDiagnosticsEnabled,
      sourceRevision: capabilityManifest.git.commit,
      capabilityManifest,
      ...(visionEvaluator ? { visionEvaluator, visionApiKey } : {}),
      ...(targetBinding ? { targetBinding } : {}),
      ...(resolvedPlan ? { authorizedPlan: resolvedPlan } : {})
    })
  })

  const evictFinishedRuns = (): void => {
    // Map giữ thứ tự chèn: evict run đã kết thúc, cũ nhất trước.
    for (const [id, run] of runs) {
      if (runs.size <= maxRetainedRuns) return
      if (['queued', 'connecting', 'running'].includes(run.status)) continue
      runs.delete(id)
    }
  }

  app.addHook('onRequest', async (request, reply) => {
    if (!apiCredential || !request.url.startsWith('/api/')) return
    const header = request.headers.authorization
    const provided = typeof header === 'string' && header.startsWith('Bearer ')
      ? header.slice('Bearer '.length)
      : undefined
    if (!credentialMatches(apiCredential, provided)) {
      await reply.code(401).send({ error: 'Unauthorized' })
    }
  })

  app.get('/health', async () => ({ ok: true, queue: queue.snapshot() }))

  app.get('/api/scenarios', async () => {
    const files = await readdir(config.scenarioDir).catch(() => [])
    return { scenarios: files.filter(file => file.endsWith('.json')).map(file => file.slice(0, -5)) }
  })

  app.post('/api/runs', async (request, reply) => {
    let scenarioName: string
    let resolvedPlan: Readonly<ResolvedAuthorizedPlan> | undefined
    if (providerRegistry) {
      try {
        const body = createAuthorizedRunSchema.parse(request.body)
        resolvedPlan = providerRegistry.resolve(body.authorizedPlan)
        assertProviderRegistryResolution(providerRegistry, resolvedPlan)
      } catch (error) {
        if (error instanceof ProviderAdmissionError) {
          return reply.code(409).send({ failure: error.failure })
        }
        if (error instanceof InvalidAuthorizedPlanError || error instanceof z.ZodError) {
          return reply.code(400).send({ error: 'Authorized plan is invalid' })
        }
        return reply.code(500).send({ error: 'Provider registry failed' })
      }
      scenarioName = resolvedPlan.scenario
    } else {
      scenarioName = createRunSchema.parse(request.body).scenario
    }
    let scenario: Scenario
    try {
      scenario = await scenarioLoader(config.scenarioDir, scenarioName)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ScenarioNotFoundError()
      }
      throw error
    }
    if (resolvedPlan && scenario.name !== resolvedPlan.scenario) {
      return reply.code(400).send({ error: 'Authorized plan is invalid' })
    }
    const run = runFactory(scenario, resolvedPlan)
    try {
      queue.enqueue({
        id: run.id,
        run: async () => {
          // Producer QA chạy TRƯỚC scenario để kết quả thật đi vào manifest của
          // chính run này, thay vì chỉ tồn tại trong test (audit BC-010).
          if (qaPlanExecutor && typeof run.attachQaPlan === 'function') {
            const result = await qaPlanExecutor.run(scenario)
            run.attachQaPlan(qaPlanExecutor.kind, result)
          }
          await run.start()
        },
        cancel: () => run.cancel()
      })
    } catch (error) {
      return reply.code(429).send({ error: error instanceof Error ? error.message : String(error) })
    }
    runs.set(run.id, run)
    evictFinishedRuns()
    return reply.code(202).send({ runId: run.id, status: run.status })
  })

  app.get<{ Params: { id: string } }>('/api/runs/:id', async (request, reply) => {
    const run = runs.get(request.params.id)
    return run ? run.view() : reply.code(404).send({ error: 'Run not found' })
  })

  app.get<{ Params: { id: string } }>('/api/runs/:id/report', async (request, reply) => {
    const run = runs.get(request.params.id)
    return run ? run.report() : reply.code(404).send({ error: 'Run not found' })
  })

  app.post<{ Params: { id: string } }>('/api/runs/:id/cancel', async (request, reply) => {
    const run = runs.get(request.params.id)
    if (!run) return reply.code(404).send({ error: 'Run not found' })
    const wasQueued = run.status === 'queued'
    if (!queue.cancel(run.id)) return reply.code(409).send({ error: 'Run is no longer cancellable' })
    if (wasQueued) await run.persistCancelled()
    return { runId: run.id, status: run.status }
  })

  app.addHook('onClose', async () => {
    const queued = [...runs.values()].filter(run => run.status === 'queued')
    for (const run of queued) {
      if (queue.cancel(run.id)) await run.persistCancelled()
    }
    const active = [...runs.values()].find(run => ['connecting', 'running'].includes(run.status))
    if (active) queue.cancel(active.id)
    await queue.idle()
  })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ScenarioNotFoundError) {
      void reply.code(404).send({ error: 'Scenario not found' })
      return
    }
    if (error instanceof z.ZodError) {
      void reply.code(400).send({ error: 'Request is invalid' })
      return
    }
    // Chi tiết chỉ ghi phía server; body trả về không phản chiếu message.
    request.log.error({ err: error }, 'Unhandled route error')
    void reply.code(500).send({ error: 'Internal error' })
  })

  return app
}
