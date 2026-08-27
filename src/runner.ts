import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import runnerPackage from '../package.json' with { type: 'json' }
import mineflayer, { type Bot } from 'mineflayer'
import type { Entity } from 'prismarine-entity'
import { Vec3 } from 'vec3'
import type { Scenario, ScenarioStep } from './scenario.js'
import { boundedGuiItems, boundedGuiSnapshot, formatGuiSnapshot, itemSearchText, sanitizeGuiText, snapshotGui } from './snapshot.js'
import type { GuiSnapshot, RunManifest, RunStatus, StepResult, TestReport, TimelineEvent, Verdict } from './types.js'
import { RunLifecycle } from './lifecycle.js'
import { BotSession, waitForSpawn } from './bot-session.js'
import { CrossingTracker } from './crossing.js'
import { RouteOracle, fenceBlockMatches, fenceBlocksDirectPath } from './route-oracle.js'
import { renderRoutePixelMapHtml, type RoutePixelMapInput } from './route-pixel-map.js'
import { entityIdentityLabels, pinUniqueEntity, validateUniquePinnedEntity } from './entity-observer.js'
import { summarizeProtocolDecodeError } from './protocol-diagnostic.js'
import { buildMultiAccountQaPlan } from './multi-account-report.js'
import type { MultiAccountRunnerResult } from './multi-account-runner.js'
import { buildPersistenceQaReport } from './persistence-report.js'
import type { PersistenceExecutionResult } from './qa-execution.js'
import { buildCompatibilityReport } from './compatibility-report.js'
import type { CompatibilityMatrixResult } from './compatibility-matrix.js'
import { buildTransactionReport } from './transaction-report.js'
import type { TransactionEvaluation } from './transaction-contract.js'
import { buildCrashRecoveryReport } from './crash-recovery-report.js'
import type { CrashRecoveryEvaluation } from './crash-recovery-contract.js'
import { buildGuiReport } from './gui-report.js'
import type { GuiEvaluation } from './gui-contract.js'
import { buildGameplayReport, buildMultiClientReport } from './journey-reports.js'
import type { GameplayEvaluation } from './gameplay-contract.js'
import type { MultiClientEvaluation } from './multi-client-contract.js'
import type { CapabilityManifest } from './capability-manifest.js'
import { writeEvidenceBundle, type EvidenceBundleInput } from './evidence-bundle.js'
import { evidenceBinding, type ArtifactTargetBinding } from './target-binding.js'

const { goals, Movements, pathfinder } = createRequire(import.meta.url)('mineflayer-pathfinder') as typeof import('mineflayer-pathfinder')
const GIT_COMMIT_PATTERN = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/

interface MinecraftOptions {
  host: string
  port: number
  username: string
  auth: 'offline' | 'microsoft'
  version?: string
  password?: string
}

interface TestRunDependencies {
  createBot?: (options: MinecraftOptions) => Bot
  prepareNavigation?: (bot: Bot) => void
  connectTimeoutMs?: number
  disconnectTimeoutMs?: number
  protocolDiagnosticsEnabled?: boolean
  sourceRevision?: string
  capabilityManifest?: CapabilityManifest
  targetBinding?: ArtifactTargetBinding
  qaExecution?: {
    executionId: string
    beforeRunId: string
    afterRunId: string
    side: 'before' | 'after'
  }
  qaPlan?: RunManifest['qaPlan']
  multiAccountResult?: { result: MultiAccountRunnerResult; kind: 'permission' | 'negative-security' }
  persistenceResult?: { result: PersistenceExecutionResult; project: string; fixture: string }
  compatibilityResult?: CompatibilityMatrixResult
  transactionResult?: { result: TransactionEvaluation; project: string; fixture: string }
  crashRecoveryResult?: { result: CrashRecoveryEvaluation; project: string; fixture: string }
  guiResult?: { result: GuiEvaluation; project: string; fixture: string }
  gameplayResult?: { result: GameplayEvaluation; project: string; fixture: string }
  multiClientResult?: { result: MultiClientEvaluation; project: string; fixture: string }
}

function verdictForStep(status: StepResult['status'], message: string): Verdict {
  if (status === 'passed') return 'PASS'
  if (status === 'skipped' || message.startsWith('INCONCLUSIVE_')) return 'INCONCLUSIVE'
  return 'FAIL'
}

function normalizedSearchText(value: string): string {
  return value.normalize('NFC').toLocaleLowerCase()
}

type WorldAwareBot = Bot & {
  _getDimensionName?: () => unknown
}

function normalizedWorldName(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined
  return value.trim().replace(/^minecraft:/, '')
}

function observedServerWorld(bot: Bot): string | undefined {
  const worldAwareBot = bot as WorldAwareBot
  try {
    return normalizedWorldName(worldAwareBot._getDimensionName?.())
  } catch {
    return undefined
  }
}

function observedDimension(bot: Bot): string | undefined {
  return normalizedWorldName(bot.game?.dimension)
}

interface ObservedGateBlock {
  name: string
  facing?: string
  half?: string
  open?: boolean
}

function observedGateBlock(
  bot: Bot, gate: { x: number; y: number; z: number }
): ObservedGateBlock | undefined {
  try {
    const block = bot.blockAt(new Vec3(gate.x, gate.y, gate.z), false)
    if (!block) return undefined
    const properties = block.getProperties()
    return {
      name: block.name,
      facing: typeof properties.facing === 'string' ? properties.facing : undefined,
      half: typeof properties.half === 'string' ? properties.half : undefined,
      open: typeof properties.open === 'boolean' ? properties.open : undefined
    }
  } catch {
    return undefined
  }
}

export interface RunView {
  runId: string
  scenario: string
  status: RunStatus
  currentStep?: string
  startedAt: string
  finishedAt?: string
  position?: { x: number; y: number; z: number }
  health?: number
  food?: number
  gui: GuiSnapshot | null
  steps: StepResult[]
  lastEvents: TimelineEvent[]
  error?: string
}

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) {
    reject(signal.reason ?? new Error('Operation cancelled'))
    return
  }
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort)
    resolve()
  }, ms)
  const onAbort = () => {
    clearTimeout(timer)
    reject(signal?.reason ?? new Error('Operation cancelled'))
  }
  signal?.addEventListener('abort', onAbort, { once: true })
})

export class TestRun {
  readonly id = randomUUID()
  readonly startedAt = new Date()
  status: RunStatus = 'queued'
  currentStep?: string
  finishedAt?: Date
  error?: string
  bot?: Bot
  gui: GuiSnapshot | null = null
  readonly events: TimelineEvent[] = []
  readonly steps: StepResult[] = []
  private readonly lifecycle = new RunLifecycle()
  private session?: BotSession
  private cancelled = false
  private activeStepEvidence?: unknown
  private windowGeneration = 0
  private readonly completedStepWindowGenerations = new Map<string, number>()
  private readonly sourceRevision?: string
  private readonly evidenceBinding: RunManifest['evidence']

  constructor(
    readonly scenario: Scenario,
    private readonly minecraft: MinecraftOptions,
    private readonly reportDir: string,
    private readonly dependencies: TestRunDependencies = {}
  ) {
    const dependencyRevision = dependencies.sourceRevision?.trim()
    const sourceRevision = (dependencyRevision || process.env.GIT_COMMIT)?.trim().toLocaleLowerCase()
    const capabilityCommit = dependencies.capabilityManifest?.git.commit.toLocaleLowerCase()
    if (sourceRevision && !GIT_COMMIT_PATTERN.test(sourceRevision)) {
      throw new Error('sourceRevision must be an exact Git commit')
    }
    if (sourceRevision && capabilityCommit && sourceRevision !== capabilityCommit) {
      throw new Error('sourceRevision does not match capability manifest Git commit')
    }
    this.sourceRevision = sourceRevision
    this.evidenceBinding = evidenceBinding(dependencies.targetBinding)
  }

  private record(type: string, summary: string, data?: unknown): void {
    const event = { at: new Date().toISOString(), elapsedMs: Date.now() - this.startedAt.getTime(), type, summary, data }
    this.events.push(event)
    console.log(`[BotChecker ${this.id}] +${event.elapsedMs}ms ${type}: ${summary}`)
  }

  private recordText(source: string, message: string): void {
    const clean = message.trim()
    if (clean) this.record(source, clean)
  }

  private inspectGui(reason: string): GuiSnapshot {
    const gui = snapshotGui(this.requireBot())
    if (!gui) throw new Error('No GUI is open')
    const evidenceGui = boundedGuiSnapshot(gui)
    this.gui = evidenceGui
    const visual = formatGuiSnapshot(evidenceGui)
    this.record('gui_inspection', sanitizeGuiText(`${reason}: ${evidenceGui.title}`), { reason, visual, gui: evidenceGui })
    console.log(`[BotChecker ${this.id}] ${reason}\n${visual}`)
    return gui
  }

  private attach(session: BotSession): void {
    session.on('messagestr', message => this.recordText('chat', String(message)))
    session.on('actionBar', message => this.recordText('action_bar', String(message)))
    session.on('title', message => this.recordText('title', String(message)))
    session.on('windowOpen', () => {
      this.windowGeneration++
      const gui = this.inspectGui('GUI opened')
      this.record('gui_open', sanitizeGuiText(gui.title), { windowGeneration: this.windowGeneration, gui: boundedGuiSnapshot(gui) })
    })
    session.on('windowClose', window => {
      this.windowGeneration++
      this.record('gui_close', sanitizeGuiText(window.title), { windowGeneration: this.windowGeneration })
      this.gui = null
    })
    session.on('kicked', reason => {
      this.record('kicked', String(reason))
      this.lifecycle.cancel(`Kicked: ${String(reason)}`)
    })
    session.on('death', () => this.record('death', 'Bot died'))
    session.on('error', error => {
      const message = error instanceof Error ? error.message : String(error)
      const data = error instanceof Error
        ? { name: error.name, message, stack: error.stack?.slice(0, 4096) }
        : { name: typeof error, message }
      if (this.dependencies.protocolDiagnosticsEnabled) {
        Object.assign(data, { protocol: summarizeProtocolDecodeError(error) })
      }
      this.record('client_error', message, data)
      this.lifecycle.cancel(message)
    })
    session.on('end', reason => {
      const message = String(reason ?? 'unknown')
      this.record('connection_end', message)
      this.lifecycle.cancel(`Connection ended: ${message}`)
    })
  }

  async start(): Promise<void> {
    try {
      this.status = 'connecting'
      const connectionOptions = { ...this.minecraft }
      this.bot = (this.dependencies.createBot ?? mineflayer.createBot)(connectionOptions)
      if (!this.dependencies.prepareNavigation) this.bot.loadPlugin(pathfinder)
      this.session = new BotSession(this.bot, this.dependencies.disconnectTimeoutMs)
      this.attach(this.session)
      const spawned = waitForSpawn(this.bot, this.lifecycle.signal)
      await this.lifecycle.run(
        async signal => {
          await this.withTimeout(spawned, this.dependencies.connectTimeoutMs ?? 60_000, 'connect')
          const bot = this.bot!
          if (this.dependencies.prepareNavigation) this.dependencies.prepareNavigation(bot)
          else bot.pathfinder.setMovements(new Movements(bot))
          this.status = 'running'
          this.record('spawn', `Connected to ${this.minecraft.host}:${this.minecraft.port}`, {
            configuredVersion: this.minecraft.version,
            negotiatedVersion: bot.version,
            protocolVersion: bot.protocolVersion,
            dimension: bot.game?.dimension,
            position: this.position()
          })
          await this.withTimeout(this.executeScenario(), this.scenario.maxDurationMs, 'scenario')
        },
        () => this.session!.cleanup(this.cancelled ? 'Test cancelled' : 'Test finished')
      )
      if (!this.cancelled) this.status = this.steps.some(step => step.status === 'failed') ? 'failed' : 'passed'
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
      this.record('run_error', this.error)
      if (!this.cancelled) this.status = 'failed'
    } finally {
      this.finishedAt = new Date()
      await this.lifecycle.finish()
      await this.session?.cleanup(this.cancelled ? 'Test cancelled' : 'Test finished')
      await this.persistReport()
    }
  }

  cancel(): void {
    if (this.finishedAt) return
    this.cancelled = true
    this.status = 'cancelled'
    this.record('cancelled', 'Run cancelled through API')
    this.lifecycle.cancel('Run cancelled through API')
  }

  async persistCancelled(): Promise<void> {
    if (!this.finishedAt) this.finishedAt = new Date()
    await this.persistReport()
  }

  private async executeScenario(): Promise<void> {
    for (const step of this.scenario.steps) {
      if (this.cancelled) return
      this.currentStep = step.id
      const started = new Date()
      this.activeStepEvidence = undefined
      this.record('step_start', `${step.id}: ${step.action}`, step)
      const eventCursor = this.events.length
      const stepController = new AbortController()
      const abortFromRun = () => stepController.abort(this.lifecycle.signal.reason)
      if (this.lifecycle.signal.aborted) abortFromRun()
      else this.lifecycle.signal.addEventListener('abort', abortFromRun, { once: true })
      try {
        const evidence = await this.withTimeout(
          this.executeStep(step, stepController.signal, eventCursor),
          step.timeoutMs,
          step.id,
          timeout => stepController.abort(timeout)
        )
        this.steps.push({ id: step.id, action: step.action, status: 'passed', verdict: 'PASS', startedAt: started.toISOString(), durationMs: Date.now() - started.getTime(), message: 'Completed', evidence })
        this.record('step_passed', step.id, evidence)
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : String(error)
        const message = step.action === 'observe_crossing' && rawMessage === `Timeout: ${step.id}`
          ? `INCONCLUSIVE_TRACKING: timeout before crossing proof (${step.timeoutMs} ms)`
          : step.action === 'assert_state' && rawMessage === `Timeout: ${step.id}`
            ? this.assertStateEvidenceMessage()
            : rawMessage
        const status = step.optional ? 'skipped' : 'failed'
        const evidence = this.activeStepEvidence
        this.steps.push({ id: step.id, action: step.action, status, verdict: verdictForStep(status, message), startedAt: started.toISOString(), durationMs: Date.now() - started.getTime(), message, evidence })
        this.record(`step_${status}`, `${step.id}: ${message}`, evidence)
        if (!step.optional) return
      } finally {
        this.completedStepWindowGenerations.set(step.id, this.windowGeneration)
        this.lifecycle.signal.removeEventListener('abort', abortFromRun)
        this.activeStepEvidence = undefined
      }
    }
    this.currentStep = undefined
  }

  private async executeStep(step: ScenarioStep, signal: AbortSignal, eventCursor: number): Promise<unknown> {
    const bot = this.requireBot()
    switch (step.action) {
      case 'wait':
        await wait(step.durationMs, signal)
        return { waitedMs: step.durationMs }
      case 'chat':
        bot.chat(step.message)
        return { sent: step.message }
      case 'wait_for_text': {
        const predicates = (step.allOf ?? [step.text!]).map(normalizedSearchText)
        const found = await this.poll(() => {
          const relativeIndex = this.events.slice(eventCursor).findIndex(event => {
            const sourceMatches = step.source === 'any' || event.type === step.source
            const normalizedSummary = normalizedSearchText(event.summary)
            return sourceMatches && predicates.every(predicate => normalizedSummary.includes(predicate))
          })
          if (relativeIndex < 0) return undefined
          const eventIndex = eventCursor + relativeIndex
          return { eventIndex, event: this.events[eventIndex] }
        }, signal)
        return found
      }
      case 'wait_for_gui':
        return this.poll(() => {
          const gui = snapshotGui(bot)
          this.gui = gui ? boundedGuiSnapshot(gui) : null
          if (!gui) return undefined
          if (step.titleIncludes && !normalizedSearchText(gui.title).includes(normalizedSearchText(step.titleIncludes))) return undefined
          return boundedGuiSnapshot(this.inspectGui('GUI ready'))
        }, signal)
      case 'assert_gui': {
        const requiredGeneration = step.afterStep === undefined
          ? undefined
          : this.completedStepWindowGenerations.get(step.afterStep)
        if (step.afterStep !== undefined && requiredGeneration === undefined) {
          throw new Error(`GUI generation baseline not found for step: ${step.afterStep}`)
        }
        const matched = await this.poll(() => {
          const gui = snapshotGui(bot)
          if (!gui) return undefined
          if (requiredGeneration !== undefined && this.windowGeneration <= requiredGeneration) {
            this.activeStepEvidence = {
              reason: 'window generation did not advance',
              requiredGenerationGreaterThan: requiredGeneration,
              windowGeneration: this.windowGeneration,
              gui: boundedGuiSnapshot(gui)
            }
            return undefined
          }
          if (step.topSlotCount !== undefined && gui.topSlotCount !== step.topSlotCount) {
            this.activeStepEvidence = {
              reason: 'top slot count mismatch',
              expectedTopSlotCount: step.topSlotCount,
              gui: boundedGuiSnapshot(gui)
            }
            return undefined
          }
          if (step.titleIncludes && !normalizedSearchText(gui.title).includes(normalizedSearchText(step.titleIncludes))) {
            this.activeStepEvidence = { reason: 'title mismatch', gui: boundedGuiSnapshot(gui) }
            return undefined
          }
          const selectorEvaluations = step.items?.map(selector => {
            if (selector.slotEmpty) {
              const slotInRange = selector.slot! < gui.totalSlotCount
              const actualSection = selector.slot! < gui.inventoryStart ? 'top' : 'player'
              const occupied = gui.items.some(item => item.slot === selector.slot)
              return {
                matches: [] as GuiSnapshot['items'],
                expected: 0,
                satisfied: slotInRange && actualSection === selector.section && !occupied
              }
            }
            const matches = gui.items.filter(item => {
              const search = itemSearchText(item)
              return (selector.slot === undefined || item.slot === selector.slot)
                && item.section === selector.section
                && (!selector.material || normalizedSearchText(item.material) === normalizedSearchText(selector.material))
                && (!selector.nameIncludes || normalizedSearchText(search).includes(normalizedSearchText(selector.nameIncludes)))
                && (!selector.loreIncludes || normalizedSearchText(item.lore.join('\n')).includes(normalizedSearchText(selector.loreIncludes)))
                && (selector.count === undefined || item.count === selector.count)
            })
            const expected = selector.absent ? 0 : selector.exactly ?? 1
            return { matches, expected, satisfied: matches.length === expected }
          })
          if (selectorEvaluations?.some(evaluation => !evaluation.satisfied)) {
            this.activeStepEvidence = { reason: 'selector mismatch', gui: boundedGuiSnapshot(gui) }
            return undefined
          }
          const matchedItems = selectorEvaluations?.flatMap(evaluation => evaluation.matches) ?? []
          const slots = matchedItems.map(item => item.slot)
          if (new Set(slots).size !== slots.length) {
            this.activeStepEvidence = { reason: 'selector overlap', gui: boundedGuiSnapshot(gui) }
            return undefined
          }
          return {
            windowGeneration: this.windowGeneration,
            gui: boundedGuiSnapshot(gui),
            ...(selectorEvaluations ? {
              matchedItems: boundedGuiItems(matchedItems),
              selectorMatches: selectorEvaluations.map(evaluation => ({
                matchCount: evaluation.matches.length,
                expected: evaluation.expected,
                matchedItems: boundedGuiItems(evaluation.matches)
              }))
            } : {})
          }
        }, signal)
        const { gui, matchedItems, selectorMatches, windowGeneration } = matched
        this.gui = boundedGuiSnapshot(gui)
        this.record('gui_assertion', sanitizeGuiText(`GUI postcondition passed: ${gui.title}`), { windowGeneration, gui, matchedItems, selectorMatches })
        return { windowGeneration, gui, matchedItems, selectorMatches }
      }
      case 'click_gui': {
        const inspectedGeneration = this.windowGeneration
        const inspected = this.inspectGui(`Before click step ${step.id}`)
        await wait(step.inspectDelayMs, signal)
        let current = snapshotGui(bot)
        if (!current || current.id !== inspected.id || this.windowGeneration !== inspectedGeneration) {
          throw new Error('GUI changed or closed while BotChecker was reading it; click blocked')
        }
        if (JSON.stringify(current) !== JSON.stringify(inspected)) current = this.inspectGui(`GUI changed before click step ${step.id}; refreshed`)
        this.gui = boundedGuiSnapshot(current)
        const requestedSlotSection = step.slot === undefined
          ? undefined
          : step.slot < current.inventoryStart ? 'top' : 'player'
        if (step.slot !== undefined && (step.slot >= current.totalSlotCount || requestedSlotSection !== step.section)) {
          throw new Error(`Slot ${step.slot} is outside ${step.section} inventory; set section explicitly`)
        }
        const matchingItems = step.slot !== undefined
          ? current.items.filter(candidate => candidate.slot === step.slot && candidate.section === step.section)
          : current.items.filter(candidate => {
              // Giữ tương thích với scenario cũ: nameIncludes từng tìm cả trong lore.
              const search = normalizedSearchText(`${itemSearchText(candidate)}\n${candidate.lore.join('\n')}`)
              return candidate.section === step.section
                && (!step.nameIncludes || search.includes(normalizedSearchText(step.nameIncludes)))
                && (!step.loreIncludes || normalizedSearchText(candidate.lore.join('\n')).includes(normalizedSearchText(step.loreIncludes)))
            })
        if (step.slot === undefined && matchingItems.length > 1) {
          throw new Error(`${matchingItems.length} GUI items match selector; specify a unique selector or slot`)
        }
        const item = matchingItems[0]
        const slot = step.slot ?? item?.slot
        if (slot === undefined) throw new Error('GUI item not found')
        const evidenceItem = item ? boundedGuiItems([item])[0] : undefined
        this.record('gui_click_authorized', `Clicking slot ${slot} after inspection`, { button: step.button, item: evidenceItem, guiId: current.id, windowGeneration: inspectedGeneration })
        await bot.simpleClick[step.button === 'left' ? 'leftMouse' : 'rightMouse'](slot)
        return { clickedSlot: slot, item: evidenceItem, windowGeneration: inspectedGeneration }
      }
      case 'go_to':
        await this.travelTo(step.x, step.y, step.z, step.range, step.travel, signal)
        return this.position()
      case 'interact_entity': {
        if (step.x !== undefined && step.y !== undefined && step.z !== undefined) {
          await this.travelTo(
            step.x, step.y, step.z, Math.max(step.interactionRange, 2), step.travel, signal)
        }
        const pinned = step.requiredUuid === undefined
          ? undefined
          : pinUniqueEntity(
            Object.values(bot.entities), bot.entity.position,
            step.nameIncludes, step.maxDistance, true, step.requiredUuid)
        const entity = pinned?.entity ?? this.nearestEntity(step.nameIncludes, step.maxDistance)
        if (!entity) throw new Error(this.entityNotFoundMessage(step.nameIncludes, step.maxDistance))
        const initialDistance = entity.position.distanceTo(bot.entity.position)
        if (initialDistance > step.interactionRange) {
          await this.abortable(
            bot.pathfinder.goto(new goals.GoalFollow(entity, step.interactionRange)),
            signal,
            () => bot.pathfinder.stop()
          )
        }
        if (pinned) {
          validateUniquePinnedEntity(
            Object.values(bot.entities), bot.entity.position,
            step.nameIncludes, step.maxDistance, pinned.identity, entity, step.requiredUuid)
        }
        await bot.lookAt(entity.position.offset(0, entity.height / 2, 0), true)
        if (pinned) {
          validateUniquePinnedEntity(
            Object.values(bot.entities), bot.entity.position,
            step.nameIncludes, step.maxDistance, pinned.identity, entity, step.requiredUuid)
        }
        const finalDistance = entity.position.distanceTo(bot.entity.position)
        if (finalDistance > step.interactionRange) {
          throw new Error(`INCONCLUSIVE_TRACKING: ${step.nameIncludes} moved outside interaction range (${finalDistance.toFixed(2)} > ${step.interactionRange})`)
        }
        await bot.activateEntity(entity)
        this.record('entity_interaction', `Interacted with ${entity.displayName ?? entity.name ?? step.nameIncludes}`, this.withDefinedValues({ uuid: step.requiredUuid, initialDistance, finalDistance, position: entity.position }))
        const gui = step.waitForGui
          ? await this.poll(() => snapshotGui(bot) ?? undefined, signal)
          : undefined
        if (gui) this.inspectGui(`GUI opened by ${step.nameIncludes}`)
        return this.withDefinedValues({ entity: entity.displayName ?? entity.name, uuid: step.requiredUuid, position: entity.position, gui: gui ? boundedGuiSnapshot(gui) : undefined })
      }
      case 'equip': {
        const item = bot.inventory.items().find(candidate => `${candidate.name}\n${candidate.displayName}`.toLocaleLowerCase().includes(step.itemIncludes.toLocaleLowerCase()))
        if (!item) throw new Error(`Inventory item not found: ${step.itemIncludes}`)
        await bot.equip(item, step.destination)
        return { item: item.name, destination: step.destination }
      }
      case 'fish': {
        const before = this.inventoryCounts()
        for (let attempt = 0; attempt < step.attempts; attempt++) await bot.fish()
        const after = this.inventoryCounts()
        const beforeTotal = Object.values(before).reduce((sum, count) => sum + count, 0)
        const afterTotal = Object.values(after).reduce((sum, count) => sum + count, 0)
        if (afterTotal <= beforeTotal) {
          throw new Error(`Fishing completed ${step.attempts} attempt(s) with no inventory gain`)
        }
        return { before, after, attempts: step.attempts, inventoryGain: afterTotal - beforeTotal }
      }
      case 'plant': {
        const seed = bot.inventory.items().find(item => `${item.name}\n${item.displayName}`.toLocaleLowerCase().includes(step.seedIncludes.toLocaleLowerCase()))
        if (!seed) throw new Error(`Seed not found: ${step.seedIncludes}`)
        const soil = bot.findBlock({ matching: block => block.name === step.soil, maxDistance: 8 })
        if (!soil) throw new Error(`Nearby ${step.soil} not found`)
        const above = bot.blockAt(soil.position.offset(0, 1, 0))
        if (!above || above.name !== 'air') throw new Error('Space above soil is not empty')
        await this.abortable(
          bot.pathfinder.goto(new goals.GoalNear(soil.position.x, soil.position.y, soil.position.z, 2)),
          signal,
          () => bot.pathfinder.stop()
        )
        await bot.equip(seed, 'hand')
        await bot.placeBlock(soil, { x: 0, y: 1, z: 0 } as Vec3)
        const planted = await this.poll(() => {
          const block = bot.blockAt(soil.position.offset(0, 1, 0))
          return block && !['air', 'cave_air', 'void_air'].includes(block.name) ? block : undefined
        }, signal)
        return { seed: seed.name, soil: soil.position, plantedBlock: planted.name }
      }
      case 'assert_inventory': {
        const count = bot.inventory.items().filter(item => `${item.name}\n${item.displayName}`.toLocaleLowerCase().includes(step.itemIncludes.toLocaleLowerCase())).reduce((sum, item) => sum + item.count, 0)
        if (count < step.minimum) throw new Error(`Expected at least ${step.minimum} ${step.itemIncludes}, found ${count}`)
        return { count }
      }
      case 'assert_state': {
        return this.poll(() => {
          const observed = this.observedState(step)
          this.activeStepEvidence = observed
          return observed.failures.length === 0
            ? { health: observed.health, food: observed.food, gui: observed.gui }
            : undefined
        }, signal, 10)
      }
      case 'assert_nearby_entity': {
        const entity = await this.poll(
          () => step.requiredUuid === undefined
            ? this.nearestEntity(step.nameIncludes, step.maxDistance)
            : pinUniqueEntity(
              Object.values(this.requireBot().entities), this.requireBot().entity.position,
              step.nameIncludes, step.maxDistance, true, step.requiredUuid).entity,
          signal)
        const query = step.nameIncludes.toLocaleLowerCase()
        return this.withDefinedValues({
          entity: entityIdentityLabels(entity).find(label => label.toLocaleLowerCase().includes(query)),
          uuid: step.requiredUuid === undefined ? undefined : entity.uuid,
          distance: entity.position.distanceTo(bot.entity.position),
          position: { x: entity.position.x, y: entity.position.y, z: entity.position.z }
        })
      }
      case 'inspect_entities': {
        const entities = Object.values(bot.entities)
          .map(entity => ({ entity, distance: entity.position.distanceTo(bot.entity.position) }))
          .filter(candidate => candidate.distance <= step.maxDistance)
          .sort((first, second) => first.distance - second.distance || first.entity.id - second.entity.id)
        const players = Object.values(bot.players)
        return {
          entityCountInRange: entities.length,
          entities: entities.slice(0, step.limit).map(({ entity, distance }) => {
            const diagnostic = entity as Entity & { metadata?: unknown[]; username?: unknown }
            return this.withDefinedValues({
              id: entity.id,
              uuid: this.safeDiagnosticString(entity.uuid),
              name: this.safeDiagnosticString(entity.name),
              username: this.safeDiagnosticString(diagnostic.username),
              displayName: this.safeDiagnosticString(entity.displayName),
              type: this.safeDiagnosticString(entity.type),
              customName: this.safeCustomName(entity),
              distance,
              position: { x: entity.position.x, y: entity.position.y, z: entity.position.z },
              metadata: Array.isArray(diagnostic.metadata)
                ? diagnostic.metadata.slice(0, 32).map(value => this.safeDiagnosticString(value)).filter(value => value !== undefined)
                : []
            })
          }),
          playerCount: players.length,
          players: players.slice(0, step.limit).map(player => {
            const diagnostic = player as { username?: unknown; uuid?: unknown; displayName?: unknown; ping?: unknown }
            return this.withDefinedValues({
              username: this.safeDiagnosticString(diagnostic.username),
              uuid: this.safeDiagnosticString(diagnostic.uuid),
              displayName: this.safeDiagnosticString(diagnostic.displayName),
              ping: typeof diagnostic.ping === 'number' && Number.isFinite(diagnostic.ping) ? diagnostic.ping : undefined
            })
          })
        }
      }
      case 'observe_load': {
        const startedAt = Date.now()
        const samples: Array<{
          atMs: number
          position: { x: number; y: number; z: number }
          gui: string
          guiItems: number
          entityCountInRange: number
          entityTypes: Record<string, number>
          inventoryItems: number
          timelineEvents: number
        }> = []
        const sample = () => {
          const position = bot.entity.position
          const entities = Object.values(bot.entities)
            .map(entity => ({ entity, distance: entity.position.distanceTo(position) }))
            .filter(candidate => candidate.distance <= step.maxDistance)
            .sort((left, right) => left.distance - right.distance || left.entity.id - right.entity.id)
            .slice(0, step.maxEntities)
          const entityTypes: Record<string, number> = {}
          for (const { entity } of entities) {
            const type = this.safeDiagnosticString(entity.type) ?? 'unknown'
            entityTypes[type] = (entityTypes[type] ?? 0) + 1
          }
          const gui = snapshotGui(bot)
          samples.push({
            atMs: Date.now() - startedAt,
            position: { x: position.x, y: position.y, z: position.z },
            gui: bot.currentWindow ? 'open' : 'closed',
            guiItems: gui?.items.length ?? 0,
            entityCountInRange: entities.length,
            entityTypes,
            inventoryItems: Math.min(bot.inventory.items().length, step.maxInventoryItems),
            timelineEvents: this.events.length
          })
        }
        sample()
        while (Date.now() - startedAt < step.durationMs) {
          await wait(Math.min(step.sampleMs, step.durationMs - (Date.now() - startedAt)), signal)
          sample()
        }
        return { durationMs: Date.now() - startedAt, sampleMs: step.sampleMs, samples, mutation: 'none' }
      }
      case 'assert_position': {
        const position = bot.entity.position
        const distance = position.distanceTo({ x: step.x, y: step.y, z: step.z } as Vec3)
        if (distance > step.range) throw new Error(`Expected distance <= ${step.range}, found ${distance.toFixed(2)}`)
        return { distance, position: this.position() }
      }
      case 'observe_route': {
        const evidence = {
          verdict: 'INCONCLUSIVE' as 'INCONCLUSIVE' | 'PASS',
          route: { checkpoints: step.checkpoints, fences: step.fences, gates: step.gates },
          fenceEvidence: [] as Array<{ block: { x: number; y: number; z: number }; name?: string; valid: boolean }>,
          observations: [] as unknown[],
          routePixelMap: undefined as RoutePixelMapInput | undefined
        }
        this.activeStepEvidence = evidence
        const pinned = pinUniqueEntity(
          Object.values(bot.entities), bot.entity.position, step.nameIncludes, step.maxDistance, true, step.targetUuid)
        const oracle = new RouteOracle(step.checkpoints, step.gates.map(gate => ({
          checkpointId: gate.checkpointId,
          block: gate.block,
          approach: gate.approach,
          exit: gate.exit,
          crossing: {
            entryClearance: gate.entryClearance,
            exitClearance: gate.exitClearance,
            verticalTolerance: gate.verticalTolerance,
            requiredExitSamples: gate.requiredExitSamples,
            planeEpsilon: gate.planeEpsilon,
            corridorHalfWidth: gate.corridorHalfWidth,
            maxStepDistance: gate.maxStepDistance,
            exitDwellMs: gate.exitDwellMs
          }
        })), Math.min(...step.gates.map(gate => gate.maxStepDistance), 1.75))
        const routeStartedAt = performance.now()
        const observedOpenGates = new Set<string>()
        const validateFences = () => {
          evidence.fenceEvidence.length = 0
          for (const fence of step.fences) {
            const block = bot.blockAt(new Vec3(fence.block.x, fence.block.y, fence.block.z), false)
            const name = block?.name
            const valid = typeof name === 'string' && fenceBlockMatches(name, fence.expectedName)
            evidence.fenceEvidence.push({ block: fence.block, name, valid })
            if (step.requireFenceEvidence && !valid) {
              throw new Error(`INCONCLUSIVE_FIXTURE: fence ${fence.block.x},${fence.block.y},${fence.block.z} is ${name ?? 'unavailable'}`)
            }
          }
        }
        validateFences()
        if (step.requireFenceEvidence && !fenceBlocksDirectPath(
          step.checkpoints[0].position,
          step.checkpoints[step.checkpoints.length - 1].position,
          step.fences.map(fence => ({ x: fence.block.x, y: fence.block.y, z: fence.block.z })))) {
          throw new Error('INCONCLUSIVE_FIXTURE: fence geometry does not block direct A-C path')
        }
        try {
          while (true) {
            const current = validateUniquePinnedEntity(
              Object.values(bot.entities), bot.entity.position, step.nameIncludes, step.maxDistance,
              pinned.identity, pinned.entity, step.targetUuid)
            const openGates: string[] = []
            for (const gate of step.gates) {
              const block = bot.blockAt(new Vec3(gate.block.x, gate.block.y, gate.block.z), false)
              const properties = block?.getProperties?.() as { open?: unknown } | undefined
              if (properties?.open === true) openGates.push(gate.checkpointId)
            }
            for (const gateId of openGates) observedOpenGates.add(gateId)
            const sampleElapsedMs = Math.round(performance.now())
            const observation = oracle.observe(current.position, sampleElapsedMs, openGates)
            evidence.observations.push({ ...observation, sampleElapsedMs, openGates: [...openGates] })
            if (observation.passed) {
              evidence.verdict = 'PASS'
              return evidence
            }
            await wait(step.sampleMs, signal)
          }
        } finally {
          evidence.observations = evidence.observations.slice(-512)
          const observations = evidence.observations as Array<{
            position: { x: number; y: number; z: number }
            sampleElapsedMs?: number
            segmentIndex?: number
            visited?: string[]
            shortcutDetected?: boolean
            backtrackDetected?: boolean
            gateOrderViolation?: boolean
            discontinuityDetected?: boolean
          }>
          evidence.routePixelMap = {
            title: `Route ${this.scenario.name} / ${step.id}`,
            checkpoints: step.checkpoints,
            fences: step.fences.map(fence => ({ x: fence.block.x, y: fence.block.y, z: fence.block.z })),
            gates: step.gates.map(gate => ({
              id: gate.checkpointId,
              block: gate.block,
              open: observedOpenGates.has(gate.checkpointId)
            })),
            samples: observations.map(observation => ({
              position: observation.position,
              elapsedMs: Math.max(0, Math.round((observation.sampleElapsedMs ?? routeStartedAt) - routeStartedAt)),
              checkpoint: observation.visited?.at(-1),
              segmentIndex: observation.segmentIndex,
              issue: observation.shortcutDetected
                ? 'shortcut'
                : observation.backtrackDetected ? 'backtrack'
                : observation.gateOrderViolation ? 'gate-order-violation'
                : observation.discontinuityDetected ? 'discontinuity' : undefined
            })),
            verdict: evidence.verdict
          }
        }
      }
      case 'observe_crossing': {
        const observations: ReturnType<CrossingTracker['observe']>[] = []
        const pairingConfig = step.targetUuid === undefined ? undefined : {
          targetUuid: step.targetUuid,
          serverWorld: step.serverWorld!,
          dimension: step.dimension!,
          gateBlock: step.gateBlock!
        }
        const evidence = {
          verdict: 'INCONCLUSIVE',
          identity: undefined as ReturnType<typeof pinUniqueEntity>['identity'] | undefined,
          pairing: pairingConfig === undefined ? undefined : {
            targetUuid: pairingConfig.targetUuid,
            serverWorld: pairingConfig.serverWorld,
            dimension: pairingConfig.dimension,
            gateBlock: pairingConfig.gateBlock,
            observedServerWorld: undefined as string | undefined,
            observedDimension: undefined as string | undefined,
            observedGateBlock: undefined as ObservedGateBlock | undefined
          },
          configuration: {
            approach: step.approach,
            exit: step.exit,
            entryClearance: step.entryClearance,
            exitClearance: step.exitClearance,
            verticalTolerance: step.verticalTolerance,
            requiredExitSamples: step.requiredExitSamples,
            planeEpsilon: step.planeEpsilon,
            corridorHalfWidth: step.corridorHalfWidth,
            maxStepDistance: step.maxStepDistance,
            exitDwellMs: step.exitDwellMs,
            sampleMs: step.sampleMs
          },
          observations
        }
        this.activeStepEvidence = evidence
        const assertPairing = () => {
          if (pairingConfig === undefined || evidence.pairing === undefined) return
          const expectedWorld = normalizedWorldName(pairingConfig.serverWorld)
          const expectedDimension = normalizedWorldName(pairingConfig.dimension)
          const actualWorld = observedServerWorld(bot)
          const actualDimension = observedDimension(bot)
          const actualGate = observedGateBlock(bot, pairingConfig.gateBlock)
          evidence.pairing.observedServerWorld = actualWorld
          evidence.pairing.observedDimension = actualDimension
          evidence.pairing.observedGateBlock = actualGate
          if (!actualWorld) {
            throw new Error('INCONCLUSIVE_PAIRING: server world is unavailable')
          }
          if (actualWorld !== expectedWorld) {
            throw new Error(
              `INCONCLUSIVE_PAIRING: expected server world ${pairingConfig.serverWorld}, observed ${actualWorld}`)
          }
          if (!actualDimension) {
            throw new Error('INCONCLUSIVE_PAIRING: dimension is unavailable')
          }
          if (actualDimension !== expectedDimension) {
            throw new Error(
              `INCONCLUSIVE_PAIRING: expected dimension ${pairingConfig.dimension}, observed ${actualDimension}`)
          }
          const gatePosition = `${pairingConfig.gateBlock.x},${pairingConfig.gateBlock.y},${pairingConfig.gateBlock.z}`
          if (!actualGate) {
            throw new Error(`INCONCLUSIVE_PAIRING: gate block ${gatePosition} is unavailable`)
          }
          const isDoor = actualGate.name.endsWith('_door') && actualGate.half === 'lower'
          const isFenceGate = actualGate.name.endsWith('_fence_gate')
          if (!isDoor && !isFenceGate) {
            throw new Error(
              `INCONCLUSIVE_PAIRING: expected door or fence gate at ${gatePosition}, observed ${actualGate.name}`)
          }
          const crossingAxis = Math.abs(step.exit.x - step.approach.x) > 1e-6 ? 'x' : 'z'
          const facingAxis = actualGate.facing === 'east' || actualGate.facing === 'west' ? 'x'
            : actualGate.facing === 'north' || actualGate.facing === 'south' ? 'z' : undefined
          if (facingAxis !== crossingAxis) {
            throw new Error(
              `INCONCLUSIVE_PAIRING: gate ${gatePosition} facing ${actualGate.facing ?? 'unavailable'} does not match crossing axis ${crossingAxis}`)
          }
        }
        assertPairing()
        const pinned = pinUniqueEntity(
          Object.values(bot.entities), bot.entity.position,
          step.nameIncludes, step.maxDistance, step.requireUuid, pairingConfig?.targetUuid)
        const { identity, entity: pinnedEntity } = pinned
        evidence.identity = identity
        const tracker = new CrossingTracker(step)
        let disappeared = false
        let identityFailure: Error | undefined
        let pairingFailure: Error | undefined
        let lifecycleFailure: Error | undefined
        let trackingFailure: Error | undefined
        let lastTrackedPosition: { x: number; y: number; z: number } | undefined
        const observePosition = (position: Entity['position'], confirmExitSample: boolean) => {
          if (!confirmExitSample && lastTrackedPosition
            && position.x === lastTrackedPosition.x
            && position.y === lastTrackedPosition.y
            && position.z === lastTrackedPosition.z) return undefined
          try {
            const observation = tracker.observe(position, performance.now(), confirmExitSample)
            observations.push(observation)
            lastTrackedPosition = { x: position.x, y: position.y, z: position.z }
            return observation
          } catch (error) {
            trackingFailure ??= error instanceof Error ? error : new Error(String(error))
            return undefined
          }
        }
        const validateIdentityWindow = () => {
          if (pairingFailure || identityFailure) return
          try {
            assertPairing()
            validateUniquePinnedEntity(
              Object.values(bot.entities), bot.entity.position,
              step.nameIncludes, step.maxDistance, identity, pinnedEntity, pairingConfig?.targetUuid)
          } catch (error) {
            const failure = error instanceof Error ? error : new Error(String(error))
            if (failure.message.startsWith('INCONCLUSIVE_PAIRING:')) pairingFailure = failure
            else identityFailure = failure
          }
        }
        const removeEntityGoneListener = this.session?.on('entityGone', (gone: Entity) => {
          if (gone === pinnedEntity || gone.id === identity.id
            && (!identity.uuid || gone.uuid === identity.uuid)) disappeared = true
          validateIdentityWindow()
        })
        const removeEntitySpawnListener = this.session?.on('entitySpawn', validateIdentityWindow)
        const removeEntityUpdateListener = this.session?.on('entityUpdate', validateIdentityWindow)
        const removeEntityMovedListener = this.session?.on('entityMoved', (moved: Entity) => {
          validateIdentityWindow()
          if (!identityFailure && moved === pinnedEntity) observePosition(moved.position, false)
        })
        const removeBotMoveListener = this.session?.on('move', validateIdentityWindow)
        const removeGateUpdateListener = pairingConfig === undefined ? undefined
          : this.session?.on('blockUpdate', (_oldBlock: unknown, newBlock: { position?: Vec3 } | null) => {
            const position = newBlock?.position
            if (position?.x === pairingConfig.gateBlock.x
              && position.y === pairingConfig.gateBlock.y
              && position.z === pairingConfig.gateBlock.z) validateIdentityWindow()
          })
        const removeGateChunkUnloadListener = pairingConfig === undefined ? undefined
          : this.session?.on('chunkColumnUnload', (corner: Vec3) => {
            if (Math.floor(pairingConfig.gateBlock.x / 16) === Math.floor(corner.x / 16)
              && Math.floor(pairingConfig.gateBlock.z / 16) === Math.floor(corner.z / 16)) {
              pairingFailure ??= new Error('INCONCLUSIVE_PAIRING: gate chunk unloaded during crossing trajectory')
            }
          })
        const failLifecycle = (event: string) => {
          lifecycleFailure ??= new Error(
            `INCONCLUSIVE_TRACKING: bot ${event} during crossing trajectory`)
        }
        const removeDeathListener = this.session?.on('death', () => failLifecycle('death'))
        const removeRespawnListener = this.session?.on('respawn', () => failLifecycle('respawn'))
        try {
          while (true) {
            if (lifecycleFailure) throw lifecycleFailure
            if (trackingFailure) throw trackingFailure
            if (pairingFailure) throw pairingFailure
            if (disappeared) {
              throw new Error(
                `INCONCLUSIVE_TRACKING: observed entity ${identity.id} disappeared during trajectory`)
            }
            if (identityFailure) throw identityFailure
            assertPairing()
            const current = validateUniquePinnedEntity(
              Object.values(bot.entities), bot.entity.position,
              step.nameIncludes, step.maxDistance, identity, pinnedEntity, pairingConfig?.targetUuid)
            const observation = observePosition(current.position, true)
            if (trackingFailure) throw trackingFailure
            if (!observation) {
              throw new Error('INCONCLUSIVE_TRACKING: crossing observation unavailable')
            }
            if (observation.crossed) {
              evidence.verdict = 'PASS'
              return evidence
            }
            await wait(step.sampleMs, signal)
          }
        } finally {
          removeEntityGoneListener?.()
          removeEntitySpawnListener?.()
          removeEntityUpdateListener?.()
          removeEntityMovedListener?.()
          removeBotMoveListener?.()
          removeGateUpdateListener?.()
          removeGateChunkUnloadListener?.()
          removeDeathListener?.()
          removeRespawnListener?.()
        }
      }
    }
    return this.unreachableStep(step)
  }

  private unreachableStep(step: never): never {
    throw new Error(`Unsupported scenario action: ${String((step as { action?: unknown }).action ?? 'unknown')}`)
  }

  private nearestEntity(name: string, maxDistance: number): Entity | undefined {
    const bot = this.requireBot()
    const query = name.toLocaleLowerCase()
    return bot.nearestEntity(entity => {
      return entityIdentityLabels(entity).some(label => label.toLocaleLowerCase().includes(query))
        && entity.position.distanceTo(bot.entity.position) <= maxDistance
    }) ?? undefined
  }

  private entityNotFoundMessage(name: string, maxDistance: number): string {
    const bot = this.requireBot()
    const { x, y, z } = bot.entity.position
    const candidates = Object.values(bot.entities)
      .filter(entity => entity.type === 'player')
      .map(entity => ({
        label: this.safeDiagnosticString(entity.username)
          ?? this.safeCustomName(entity)
          ?? this.safeDiagnosticString(entity.displayName)
          ?? this.safeDiagnosticString(entity.name)
          ?? 'unknown',
        distance: entity.position.distanceTo(bot.entity.position)
      }))
      .filter(candidate => Number.isFinite(candidate.distance) && candidate.distance <= maxDistance)
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 5)
      .map(candidate => `${candidate.label}@${candidate.distance.toFixed(2)}`)
    return `Entity not found: ${name}; bot=${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}; maxDistance=${maxDistance}; nearbyPlayers=${candidates.join(',') || 'none'}`
  }

  private safeCustomName(entity: Entity): string | undefined {
    try {
      return this.safeDiagnosticString(entity.getCustomName?.())
    } catch {
      return undefined
    }
  }

  private safeDiagnosticString(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined
    try {
      return String(value).slice(0, 256)
    } catch {
      return undefined
    }
  }

  private withDefinedValues<T extends Record<string, unknown>>(value: T): Partial<T> {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>
  }

  private async travelTo(
    x: number, y: number, z: number, range: number,
    travel: 'walk' | 'teleport', signal: AbortSignal
  ): Promise<void> {
    const bot = this.requireBot()
    const start = this.position()
    this.record('travel_start', `${travel} to ${x}, ${y}, ${z}`, { start, target: { x, y, z }, range })
    if (travel === 'teleport') {
      bot.chat(`/tp @s ${x} ${y} ${z}`)
      await this.poll(
        () => bot.entity.position.distanceTo({ x, y, z } as Vec3) <= range ? true : undefined,
        signal
      )
    } else {
      await this.abortable(
        bot.pathfinder.goto(new goals.GoalNear(x, y, z, range)),
        signal,
        () => bot.pathfinder.stop()
      )
    }
    this.record('travel_complete', `${travel} completed`, { start, end: this.position(), target: { x, y, z } })
  }

  private inventoryCounts(): Record<string, number> {
    return this.requireBot().inventory.items().reduce<Record<string, number>>((counts, item) => {
      counts[item.name] = (counts[item.name] ?? 0) + item.count
      return counts
    }, {})
  }

  private position(): { x: number; y: number; z: number } {
    const { x, y, z } = this.requireBot().entity.position
    return { x, y, z }
  }

  private requireBot(): Bot {
    if (!this.bot) throw new Error('Bot is not connected')
    return this.bot
  }

  private async poll<T>(
    check: () => T | undefined, signal: AbortSignal, intervalMs = 100
  ): Promise<T> {
    while (true) {
      const value = check()
      if (value !== undefined) return value
      await wait(intervalMs, signal)
    }
  }

  private observedState(step: Extract<ScenarioStep, { action: 'assert_state' }>): {
    health: number
    food: number
    gui: 'open' | 'closed'
    elapsedMs: number
    failures: string[]
  } {
    const bot = this.requireBot()
    const gui = bot.currentWindow ? 'open' : 'closed'
    const failures: string[] = []
    if (step.minimumHealth !== undefined && bot.health < step.minimumHealth) {
      failures.push(`Expected health >= ${step.minimumHealth}, found ${bot.health}`)
    }
    if (step.minimumFood !== undefined && bot.food < step.minimumFood) {
      failures.push(`Expected food >= ${step.minimumFood}, found ${bot.food}`)
    }
    if (step.gui !== 'any' && gui !== step.gui) failures.push(`Expected GUI ${step.gui}, found ${gui}`)
    return { health: bot.health, food: bot.food, gui, elapsedMs: Date.now() - this.startedAt.getTime(), failures }
  }

  private assertStateEvidenceMessage(): string {
    const evidence = this.activeStepEvidence as { failures?: string[] } | undefined
    const failures = evidence?.failures?.filter(failure => failure.length > 0) ?? []
    return failures.length > 0 ? failures.join('; ') : 'assert_state timed out before predicates passed'
  }

  private abortable<T>(promise: Promise<T>, signal: AbortSignal, onAbort: () => void): Promise<T> {
    if (signal.aborted) {
      onAbort()
      return Promise.reject(signal.reason ?? new Error('Operation cancelled'))
    }
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        onAbort()
        reject(signal.reason ?? new Error('Operation cancelled'))
      }
      signal.addEventListener('abort', abort, { once: true })
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    })
  }

  private async withTimeout<T>(
    promise: Promise<T>, timeoutMs: number, label: string,
    onTimeout?: (timeout: Error) => void
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => { timer = setTimeout(() => {
          const timeout = new Error(`Timeout: ${label}`)
          if (onTimeout) onTimeout(timeout)
          else this.lifecycle.cancel(timeout.message)
          reject(timeout)
        }, timeoutMs) })
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  report(): TestReport {
    const finished = this.finishedAt?.getTime() ?? Date.now()
    return {
      runId: this.id,
      scenario: this.scenario.name,
      status: this.status,
      verdict: this.verdict(),
      manifest: this.manifest(),
      startedAt: this.startedAt.toISOString(),
      finishedAt: this.finishedAt?.toISOString(),
      durationMs: finished - this.startedAt.getTime(),
      summary: {
        total: this.steps.length,
        passed: this.steps.filter(step => step.status === 'passed').length,
        failed: this.steps.filter(step => step.status === 'failed').length,
        skipped: this.steps.filter(step => step.status === 'skipped').length
      },
      steps: this.steps,
      issues: this.steps.filter(step => step.status !== 'passed').map(step => ({ severity: step.verdict === 'FAIL' ? 'high' as const : 'low' as const, stepId: step.id, message: step.message })),
      timeline: this.events
    }
  }

  private verdict(): Verdict {
    if (this.steps.some(step => step.verdict === 'FAIL')) return 'FAIL'
    if (this.steps.some(step => step.verdict === 'INCONCLUSIVE')) return 'INCONCLUSIVE'
    if (this.status === 'failed') return 'FAIL'
    if (this.status !== 'passed') return 'INCONCLUSIVE'
    return 'PASS'
  }

  private manifest(): RunManifest {
    const bot = this.bot
    return {
      schemaVersion: 1,
      evidence: this.evidenceBinding,
      runner: {
        name: runnerPackage.name,
        version: runnerPackage.version,
        ...(this.sourceRevision ? { sourceRevision: this.sourceRevision } : {})
      },
      ...(this.dependencies.capabilityManifest ? { capability: this.dependencies.capabilityManifest } : {}),
      scenario: {
        name: this.scenario.name,
        sha256: createHash('sha256').update(JSON.stringify(this.scenario)).digest('hex')
      },
      ...(this.scenario.qa ? {
        qa: {
          ...this.scenario.qa,
          ...(this.dependencies.qaExecution ? { execution: this.dependencies.qaExecution } : {})
        }
      } : {}),
      ...(this.dependencies.qaPlan ? { qaPlan: this.dependencies.qaPlan } : {}),
      ...(this.dependencies.multiAccountResult
        ? { qaPlan: buildMultiAccountQaPlan(this.dependencies.multiAccountResult.result, this.dependencies.multiAccountResult.kind) }
        : {}),
      ...(this.dependencies.persistenceResult
        ? { persistence: buildPersistenceQaReport(this.dependencies.persistenceResult.result, this.dependencies.persistenceResult.project, this.dependencies.persistenceResult.fixture) }
        : {}),
      ...(this.dependencies.compatibilityResult
        ? { compatibility: buildCompatibilityReport(this.dependencies.compatibilityResult) }
        : {}),
      ...(this.dependencies.transactionResult
        ? { transaction: buildTransactionReport(this.dependencies.transactionResult.result, this.dependencies.transactionResult.project, this.dependencies.transactionResult.fixture) }
        : {}),
      ...(this.dependencies.crashRecoveryResult
        ? { crashRecovery: buildCrashRecoveryReport(this.dependencies.crashRecoveryResult.result, this.dependencies.crashRecoveryResult.project, this.dependencies.crashRecoveryResult.fixture) }
        : {}),
      ...(this.dependencies.guiResult
        ? { gui: buildGuiReport(this.dependencies.guiResult.result, this.dependencies.guiResult.project, this.dependencies.guiResult.fixture) }
        : {}),
      ...(this.dependencies.gameplayResult
        ? { gameplay: buildGameplayReport(this.dependencies.gameplayResult.result, this.dependencies.gameplayResult.project, this.dependencies.gameplayResult.fixture) }
        : {}),
      ...(this.dependencies.multiClientResult
        ? { multiClient: buildMultiClientReport(this.dependencies.multiClientResult.result, this.dependencies.multiClientResult.project, this.dependencies.multiClientResult.fixture) }
        : {}),
      target: {
        host: this.minecraft.host,
        port: this.minecraft.port,
        configuredVersion: this.minecraft.version
      },
      observed: {
        negotiatedVersion: bot?.version,
        protocolVersion: bot?.protocolVersion,
        serverWorld: bot ? observedServerWorld(bot) : undefined,
        dimension: bot ? observedDimension(bot) : undefined
      }
    }
  }

  view(): RunView {
    const bot = this.bot
    return {
      runId: this.id,
      scenario: this.scenario.name,
      status: this.status,
      currentStep: this.currentStep,
      startedAt: this.startedAt.toISOString(),
      finishedAt: this.finishedAt?.toISOString(),
      position: bot?.entity ? this.position() : undefined,
      health: bot?.health,
      food: bot?.food,
      gui: this.gui,
      steps: this.steps,
      lastEvents: this.events.slice(-50),
      error: this.error
    }
  }

  private async writeReport(): Promise<void> {
    const report = this.report()
    const artifacts: EvidenceBundleInput['artifacts'] = [{
      role: 'report',
      fileName: `${this.id}.json`,
      content: JSON.stringify(report, null, 2)
    }]
    for (const [index, step] of report.steps.entries()) {
      const map = (step.evidence as { routePixelMap?: RoutePixelMapInput } | undefined)?.routePixelMap
      if (!map) continue
      const prefix = `${this.id}-step-${String(index + 1).padStart(4, '0')}-route-map`
      artifacts.push(
        { role: 'route-map-json', fileName: `${prefix}.json`, content: JSON.stringify(map, null, 2) },
        { role: 'route-map-html', fileName: `${prefix}.html`, content: renderRoutePixelMapHtml(map) }
      )
    }
    await writeEvidenceBundle(this.reportDir, `${this.id}.bundle.json`, {
      runId: this.id,
      scenarioSha256: report.manifest.scenario.sha256,
      ...(report.manifest.capability
        ? { capabilitySourceFingerprint: report.manifest.capability.sourceFingerprint }
        : {}),
      ...(report.manifest.evidence.evidenceGrade === 'artifact-bound'
        ? { targetBindingSha256: report.manifest.evidence.targetBindingSha256 }
        : {}),
      artifacts
    })
  }

  private async persistReport(): Promise<void> {
    try {
      await this.writeReport()
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      this.error = `Evidence persistence failed: ${detail}`
      this.record('persist_error', this.error)
      if (!this.cancelled) this.status = 'failed'
      throw error
    }
  }
}
