import Fastify from 'fastify'
import { readdir } from 'node:fs/promises'
import { z } from 'zod'
import { config } from './config.js'
import { loadScenario, type Scenario } from './scenario.js'
import { TestRun } from './runner.js'
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
}

interface ServerOptions {
  queueCapacity?: number
  scenarioLoader?: (directory: string, name: string) => Promise<Scenario>
  runFactory?: (
    scenario: Scenario,
    resolvedPlan?: Readonly<ResolvedAuthorizedPlan>
  ) => ManagedRun
  providerRegistry?: ProviderRegistry
  capabilityManifestCollector?: () => CapabilityManifest
  targetBindingFile?: string
  targetBindingLoader?: (file: string) => ArtifactTargetBinding
  logger?: boolean
}

export function createServer(options: ServerOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true })
  const runs = new Map<string, ManagedRun>()
  const queue = new RunQueue(options.queueCapacity ?? config.queueCapacity)
  const scenarioLoader = options.scenarioLoader ?? loadScenario
  const providerRegistry = options.providerRegistry
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
    return new TestRun(scenario, config.minecraft, config.reportDir, {
      protocolDiagnosticsEnabled: config.protocolDiagnosticsEnabled,
      sourceRevision: capabilityManifest.git.commit,
      capabilityManifest,
      ...(targetBinding ? { targetBinding } : {}),
      ...(resolvedPlan ? { authorizedPlan: resolvedPlan } : {})
    })
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
    const scenario = await scenarioLoader(config.scenarioDir, scenarioName)
    if (resolvedPlan && scenario.name !== resolvedPlan.scenario) {
      return reply.code(400).send({ error: 'Authorized plan is invalid' })
    }
    const run = runFactory(scenario, resolvedPlan)
    try {
      queue.enqueue({ id: run.id, run: () => run.start(), cancel: () => run.cancel() })
    } catch (error) {
      return reply.code(429).send({ error: error instanceof Error ? error.message : String(error) })
    }
    runs.set(run.id, run)
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

  app.setErrorHandler((error, _request, reply) => {
    const status = error instanceof z.ZodError ? 400 : 500
    const message = error instanceof Error ? error.message : String(error)
    void reply.code(status).send({ error: message })
  })

  return app
}
