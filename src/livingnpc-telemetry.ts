import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type { TimelineEvent } from './types.js'

export interface LivingNpcTelemetryParseOptions {
  maxBytes?: number
  maxEvents?: number
  maxBlockProbesPerEvent?: number
}

export interface LivingNpcTelemetryAnalysisOptions {
  expectedRolesByNpcId?: Record<string, string>
  expectedRolesByName?: Record<string, string>
}

export interface LivingNpcObserverEventData {
  schemaVersion: 1
  source: 'livingnpc.telemetry'
  npc: LivingNpcIdentity
  position: {
    block: BlockCoordinate | null
    precise: PreciseCoordinate | null
    targetBlock: BlockCoordinate | null
    targetPrecise: PreciseCoordinate | null
  }
  state: { state: string; phase: string }
  navigation: LivingNpcTelemetryNavigation | null
  path: string | null
  obstacle: LivingNpcTelemetryBlockProbe | null
  blockProbes: LivingNpcTelemetryBlockProbe[]
  semanticPoint: LivingNpcObserverSemanticPoint | null
  timestampTick: number
  timestampMillis: number
  rawType: string
}

export interface LivingNpcObserverTimelineEvent extends TimelineEvent {
  type: `livingnpc.telemetry.${string}`
  data: LivingNpcObserverEventData
}

export interface LivingNpcIdentity {
  uuid: string | null
  name: string
  role: string
  world: string
}

export interface BlockCoordinate {
  world: string
  x: number
  y: number
  z: number
}

export interface PreciseCoordinate extends BlockCoordinate {
  yaw: number
  pitch: number
}

export interface LivingNpcObserverSemanticPoint {
  type: string
  name: string
  world: string
  position: PreciseCoordinate | null
}

export type LivingNpcTelemetryEvidence =
  | {
    code: 'LIVINGNPC_ROLE_MISMATCH'
    severity: 'medium'
    verdict: 'INCONCLUSIVE'
    message: string
    npc: LivingNpcIdentity
    expectedRole: string
    observedRole: string
    eventIndex: number
    timestampTick: number
    timestampMillis: number
  }
  | {
    code: 'LIVINGNPC_STUCK_PATH_ABSENT'
    severity: 'high'
    verdict: 'FAIL'
    message: string
    npc: LivingNpcIdentity
    state: string
    phase: string
    navigation: LivingNpcTelemetryNavigation | null
    eventIndex: number
    timestampTick: number
    timestampMillis: number
  }
  | {
    code: 'LIVINGNPC_SEMANTIC_TARGET_COLLISION'
    severity: 'medium'
    verdict: 'INCONCLUSIVE'
    message: string
    semanticPoint: LivingNpcObserverSemanticPoint
    participants: LivingNpcIdentity[]
    eventIndexes: number[]
    timestampMillis: number
  }

const DEFAULT_MAX_BYTES = 1_048_576
const DEFAULT_MAX_EVENTS = 512
const DEFAULT_MAX_BLOCK_PROBES_PER_EVENT = 16
const DEFAULT_MAX_OBSERVATORY_ITEMS = 16
const DEFAULT_MAX_STRUCTURES = 32
const MAX_TEXT_LENGTH = 256
const MAX_TOTAL_RECORDED = 9_007_199_254_740_991
const WORLD_BOUND = 29_999_984

const boundedText = z.string().min(1).max(MAX_TEXT_LENGTH)
const nullableBoundedText = z.string().max(MAX_TEXT_LENGTH).nullable()
const uuidText = z.string().uuid().nullable()
const finiteNumber = z.number().finite()
const worldCoordinate = finiteNumber.min(-WORLD_BOUND).max(WORLD_BOUND)
const tickNumber = z.number().int().nonnegative().max(MAX_TOTAL_RECORDED)

const telemetryPositionSchema = z.strictObject({
  world: boundedText,
  xBlock: z.number().int().min(-WORLD_BOUND).max(WORLD_BOUND),
  yBlock: z.number().int().min(-WORLD_BOUND).max(WORLD_BOUND),
  zBlock: z.number().int().min(-WORLD_BOUND).max(WORLD_BOUND),
  x: worldCoordinate,
  y: worldCoordinate,
  z: worldCoordinate,
  yaw: finiteNumber,
  pitch: finiteNumber
})

const telemetryBlockProbeSchema = z.strictObject({
  relation: boundedText,
  world: boundedText,
  x: z.number().int().min(-WORLD_BOUND).max(WORLD_BOUND),
  y: z.number().int().min(-WORLD_BOUND).max(WORLD_BOUND),
  z: z.number().int().min(-WORLD_BOUND).max(WORLD_BOUND),
  material: boundedText,
  solid: z.boolean(),
  passable: z.boolean(),
  loadedChunk: z.boolean(),
  door: z.boolean(),
  fenceGate: z.boolean(),
  fence: z.boolean(),
  obstacle: z.boolean()
})

const telemetryNavigationSchema = z.strictObject({
  navigating: z.boolean(),
  targetWorld: nullableBoundedText,
  target: telemetryPositionSchema.nullable(),
  strategy: nullableBoundedText,
  path: nullableBoundedText,
  examiners: nullableBoundedText,
  pathfinder: nullableBoundedText,
  range: finiteNumber.min(0).max(WORLD_BOUND),
  stationaryTicks: z.number().int().min(-1).max(MAX_TOTAL_RECORDED),
  distanceMargin: finiteNumber.min(0).max(WORLD_BOUND).nullable(),
  pathMargin: finiteNumber.min(0).max(WORLD_BOUND).nullable(),
  cancelReason: nullableBoundedText,
  elapsedTicks: tickNumber
})

const telemetrySemanticPointSchema = z.strictObject({
  type: boundedText,
  name: boundedText,
  world: boundedText,
  position: telemetryPositionSchema.nullable()
})

const telemetryItemQuantitySchema = z.strictObject({
  itemKey: boundedText,
  quantity: z.number().int().nonnegative().max(MAX_TOTAL_RECORDED)
})

const telemetryActivitySchema = z.strictObject({
  npcId: z.string().uuid().optional(),
  npcName: boundedText.optional(),
  role: boundedText,
  action: boundedText,
  itemKey: boundedText.optional(),
  amount: z.number().int().nonnegative().max(MAX_TOTAL_RECORDED).optional(),
  createdAt: z.string().max(MAX_TEXT_LENGTH).optional(),
  timestampMillis: tickNumber.optional()
})

const telemetryEconomySchema = z.strictObject({
  schemaVersion: z.literal(1),
  villageId: boundedText.optional(),
  currencyUnit: boundedText.optional(),
  balanceMinor: tickNumber.optional(),
  timestampMillis: tickNumber.optional(),
  activities: z.array(telemetryActivitySchema).max(DEFAULT_MAX_OBSERVATORY_ITEMS).optional(),
  inventory: z.array(telemetryItemQuantitySchema).max(DEFAULT_MAX_OBSERVATORY_ITEMS).optional()
})

const telemetryVisitorPurchaseSchema = z.strictObject({
  spentMinor: tickNumber.optional(),
  remainingMinor: tickNumber.optional(),
  items: z.array(telemetryItemQuantitySchema).max(DEFAULT_MAX_OBSERVATORY_ITEMS).optional()
})

const telemetryVisitorSchema = z.strictObject({
  visitId: boundedText.optional(),
  uuid: z.string().uuid().optional(),
  name: boundedText.optional(),
  phase: boundedText.optional(),
  walletMinor: tickNumber.optional(),
  target: telemetryPositionSchema.nullable().optional(),
  demand: z.array(telemetryItemQuantitySchema).max(DEFAULT_MAX_OBSERVATORY_ITEMS).optional(),
  purchase: telemetryVisitorPurchaseSchema.optional()
})

const telemetryVisitorsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  villageId: boundedText.optional(),
  enabled: z.boolean().optional(),
  activeCount: z.number().int().nonnegative().max(DEFAULT_MAX_OBSERVATORY_ITEMS).optional(),
  maxActive: z.number().int().nonnegative().max(DEFAULT_MAX_OBSERVATORY_ITEMS).optional(),
  visitors: z.array(telemetryVisitorSchema).max(DEFAULT_MAX_OBSERVATORY_ITEMS).optional(),
  timestampMillis: tickNumber.optional()
})

const telemetryBoundsSchema = z.strictObject({
  world: boundedText,
  minX: z.number().int().min(-WORLD_BOUND).max(WORLD_BOUND),
  minY: z.number().int().min(-WORLD_BOUND).max(WORLD_BOUND),
  minZ: z.number().int().min(-WORLD_BOUND).max(WORLD_BOUND),
  maxX: z.number().int().min(-WORLD_BOUND).max(WORLD_BOUND),
  maxY: z.number().int().min(-WORLD_BOUND).max(WORLD_BOUND),
  maxZ: z.number().int().min(-WORLD_BOUND).max(WORLD_BOUND)
}).superRefine((bounds, context) => {
  if (bounds.minX > bounds.maxX) context.addIssue({ code: 'custom', path: ['minX'], message: 'minX exceeds maxX' })
  if (bounds.minY > bounds.maxY) context.addIssue({ code: 'custom', path: ['minY'], message: 'minY exceeds maxY' })
  if (bounds.minZ > bounds.maxZ) context.addIssue({ code: 'custom', path: ['minZ'], message: 'minZ exceeds maxZ' })
})

const telemetryStructureSchema = z.strictObject({
  id: boundedText,
  type: boundedText.optional(),
  bounds: telemetryBoundsSchema,
  beds: z.number().int().nonnegative().max(DEFAULT_MAX_OBSERVATORY_ITEMS).optional(),
  workstations: z.number().int().nonnegative().max(DEFAULT_MAX_OBSERVATORY_ITEMS).optional(),
  doors: z.number().int().nonnegative().max(DEFAULT_MAX_OBSERVATORY_ITEMS).optional(),
  occupancy: z.number().int().nonnegative().max(DEFAULT_MAX_OBSERVATORY_ITEMS).optional(),
  scanStatus: boundedText.optional()
})

const telemetryStructuresSchema = z.strictObject({
  schemaVersion: z.literal(1),
  villageId: boundedText.optional(),
  status: boundedText.optional(),
  structures: z.array(telemetryStructureSchema).max(DEFAULT_MAX_STRUCTURES).optional(),
  timestampMillis: tickNumber.optional()
})

const telemetryHouseScanSchema = z.strictObject({
  schemaVersion: z.literal(1),
  status: boundedText.optional(),
  houses: z.array(telemetryStructureSchema).max(DEFAULT_MAX_STRUCTURES).optional(),
  timestampMillis: tickNumber.optional()
})

const telemetryEventBaseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  type: boundedText,
  npcId: uuidText,
  name: boundedText,
  role: boundedText,
  world: boundedText,
  npcBlock: telemetryPositionSchema.nullable(),
  npcPrecise: telemetryPositionSchema.nullable(),
  targetBlock: telemetryPositionSchema.nullable(),
  targetPrecise: telemetryPositionSchema.nullable(),
  state: boundedText,
  phase: boundedText,
  navigation: telemetryNavigationSchema.nullable(),
  path: nullableBoundedText,
  obstacle: telemetryBlockProbeSchema.nullable(),
  semanticPoint: telemetrySemanticPointSchema.nullable(),
  blockProbes: z.array(telemetryBlockProbeSchema),
  timestampTick: tickNumber,
  timestampMillis: tickNumber
})

export const livingNpcTelemetrySnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  capacity: z.number().int().positive().max(DEFAULT_MAX_EVENTS),
  totalRecorded: tickNumber,
  events: z.array(telemetryEventBaseSchema.extend({
    blockProbes: z.array(telemetryBlockProbeSchema).max(DEFAULT_MAX_BLOCK_PROBES_PER_EVENT)
  })).max(DEFAULT_MAX_EVENTS),
  economy: telemetryEconomySchema.optional(),
  visitors: telemetryVisitorsSchema.optional(),
  structures: telemetryStructuresSchema.optional(),
  houseScan: telemetryHouseScanSchema.optional()
}).superRefine((snapshot, context) => {
  if (snapshot.events.length > snapshot.capacity) {
    context.addIssue({ code: 'custom', path: ['events'], message: 'events length exceeds capacity' })
  }
})

export type LivingNpcTelemetrySnapshot = z.infer<typeof livingNpcTelemetrySnapshotSchema>
export type LivingNpcTelemetryEvent = LivingNpcTelemetrySnapshot['events'][number]
export type LivingNpcTelemetryPosition = NonNullable<LivingNpcTelemetryEvent['npcBlock']>
export type LivingNpcTelemetryNavigation = NonNullable<LivingNpcTelemetryEvent['navigation']>
export type LivingNpcTelemetryBlockProbe = LivingNpcTelemetryEvent['blockProbes'][number]

export async function parseLivingNpcTelemetryFile(
  file: string,
  options: LivingNpcTelemetryParseOptions = {}
): Promise<LivingNpcTelemetrySnapshot> {
  return parseLivingNpcTelemetryString(await readFile(file, 'utf8'), options)
}

export function parseLivingNpcTelemetryString(
  payload: string,
  options: LivingNpcTelemetryParseOptions = {}
): LivingNpcTelemetrySnapshot {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  if (Buffer.byteLength(payload, 'utf8') > maxBytes) {
    throw new Error(`LivingNPC telemetry payload too large: ${Buffer.byteLength(payload, 'utf8')} > ${maxBytes}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid JSON: ${message}`)
  }

  const schema = schemaForOptions(options)
  const result = schema.safeParse(normalizeRuntimeTelemetryShape(parsed))
  if (!result.success) {
    throw new Error(`Invalid LivingNPC telemetry snapshot: ${z.prettifyError(result.error)}`)
  }
  return result.data
}

export function telemetryToTimelineEvents(snapshot: LivingNpcTelemetrySnapshot): LivingNpcObserverTimelineEvent[] {
  return snapshot.events.map((event, index) => {
    const data = observerData(event)
    return {
      at: new Date(event.timestampMillis).toISOString(),
      elapsedMs: Math.max(0, event.timestampMillis - snapshot.events[0]!.timestampMillis),
      type: `livingnpc.telemetry.${event.type}`,
      summary: `${event.name} ${event.role} ${event.state} path=${event.path ?? event.navigation?.path ?? 'unknown'}`,
      data: { ...data, eventIndex: index } as LivingNpcObserverEventData & { eventIndex: number }
    }
  })
}

export function analyzeLivingNpcTelemetry(
  snapshot: LivingNpcTelemetrySnapshot,
  options: LivingNpcTelemetryAnalysisOptions = {}
): LivingNpcTelemetryEvidence[] {
  const evidence: LivingNpcTelemetryEvidence[] = []
  const roleMismatchNpcs = new Set<string>()
  const semanticTargets = new Map<string, Array<{ event: LivingNpcTelemetryEvent; index: number; point: LivingNpcObserverSemanticPoint }>>()

  snapshot.events.forEach((event, index) => {
    const npc = identity(event)
    const expectedRole = expectedRoleFor(event, options)
    const npcKey = identityKey(event)
    if (expectedRole !== undefined && expectedRole !== event.role && !roleMismatchNpcs.has(npcKey)) {
      roleMismatchNpcs.add(npcKey)
      evidence.push({
        code: 'LIVINGNPC_ROLE_MISMATCH',
        severity: 'medium',
        verdict: 'INCONCLUSIVE',
        message: `LivingNPC telemetry role mismatch for ${event.name}: expected ${expectedRole}, observed ${event.role}`,
        npc,
        expectedRole,
        observedRole: event.role,
        eventIndex: index,
        timestampTick: event.timestampTick,
        timestampMillis: event.timestampMillis
      })
    }

    const pathState = event.path ?? event.navigation?.path
    const cancelReason = event.navigation?.cancelReason
    if (cancelReason === 'STUCK' && pathState === 'absent') {
      evidence.push({
        code: 'LIVINGNPC_STUCK_PATH_ABSENT',
        severity: 'high',
        verdict: 'FAIL',
        message: `LivingNPC ${event.name} ${event.state} ended STUCK with path absent`,
        npc,
        state: event.state,
        phase: event.phase,
        navigation: event.navigation,
        eventIndex: index,
        timestampTick: event.timestampTick,
        timestampMillis: event.timestampMillis
      })
    }

    const point = observerSemanticPoint(event.semanticPoint)
    if (point?.position) {
      const key = semanticTargetKey(point)
      const bucket = semanticTargets.get(key) ?? []
      bucket.push({ event, index, point })
      semanticTargets.set(key, bucket)
    }
  })

  for (const collisions of semanticTargets.values()) {
    const uniqueNpcs = new Map<string, LivingNpcIdentity>()
    for (const collision of collisions) uniqueNpcs.set(identityKey(collision.event), identity(collision.event))
    if (uniqueNpcs.size <= 1) continue
    evidence.push({
      code: 'LIVINGNPC_SEMANTIC_TARGET_COLLISION',
      severity: 'medium',
      verdict: 'INCONCLUSIVE',
      message: `LivingNPC semantic target shared by ${uniqueNpcs.size} NPCs`,
      semanticPoint: collisions[0]!.point,
      participants: [...uniqueNpcs.values()],
      eventIndexes: collisions.map(collision => collision.index),
      timestampMillis: Math.min(...collisions.map(collision => collision.event.timestampMillis))
    })
  }

  return evidence
}

function normalizeRuntimeTelemetryShape(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const value = input as Record<string, unknown>
  const normalized: Record<string, unknown> = { ...value }
  const economy = value.economy
  if (economy && typeof economy === 'object' && !Array.isArray(economy)) {
    const root = economy as Record<string, unknown>
    const first = Array.isArray(root.villages) ? root.villages[0] : undefined
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      const source = first as Record<string, unknown>
      normalized.economy = {
        schemaVersion: 1,
        villageId: source.villageId,
        currencyUnit: source.currencyUnit,
        balanceMinor: source.balanceMinor,
        inventory: Array.isArray(source.inventory)
          ? source.inventory.map((item) => {
              if (!item || typeof item !== 'object' || Array.isArray(item)) return item
              const row = item as Record<string, unknown>
              return { itemKey: row.itemKey ?? row.item, quantity: row.quantity ?? row.amount }
            })
          : undefined,
        activities: Array.isArray(source.activities)
          ? source.activities.slice(0, DEFAULT_MAX_OBSERVATORY_ITEMS).map((activity) => {
              if (!activity || typeof activity !== 'object' || Array.isArray(activity)) return activity
              const row = activity as Record<string, unknown>
              return {
                npcId: row.npcId,
                npcName: row.npcName,
                role: row.role,
                action: row.action,
                itemKey: row.itemKey ?? row.item,
                amount: row.amount,
                createdAt: row.createdAt
              }
            })
          : undefined
      }
    }
  }
  const visitors = value.visitors
  if (visitors && typeof visitors === 'object' && !Array.isArray(visitors)) {
    const root = visitors as Record<string, unknown>
    if (Array.isArray(root.active)) {
      const { active: _active, ...rest } = root
      normalized.visitors = { ...rest, schemaVersion: 1, visitors: root.active }
    }
  }
  return normalized
}

function schemaForOptions(options: LivingNpcTelemetryParseOptions): typeof livingNpcTelemetrySnapshotSchema {
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS
  const maxBlockProbes = options.maxBlockProbesPerEvent ?? DEFAULT_MAX_BLOCK_PROBES_PER_EVENT
  const eventSchema = telemetryEventBaseSchema.extend({
    blockProbes: z.array(telemetryBlockProbeSchema).max(maxBlockProbes)
  })
  return z.strictObject({
    schemaVersion: z.literal(1),
    capacity: z.number().int().positive().max(maxEvents),
    totalRecorded: tickNumber,
    events: z.array(eventSchema).max(maxEvents),
    economy: telemetryEconomySchema.optional(),
    visitors: telemetryVisitorsSchema.optional(),
    structures: telemetryStructuresSchema.optional(),
    houseScan: telemetryHouseScanSchema.optional()
  }).superRefine((snapshot, context) => {
    if (snapshot.events.length > snapshot.capacity) {
      context.addIssue({ code: 'custom', path: ['events'], message: 'events length exceeds capacity' })
    }
  }) as typeof livingNpcTelemetrySnapshotSchema
}

function observerData(event: LivingNpcTelemetryEvent): LivingNpcObserverEventData {
  return {
    schemaVersion: 1,
    source: 'livingnpc.telemetry',
    npc: identity(event),
    position: {
      block: blockCoordinate(event.npcBlock),
      precise: preciseCoordinate(event.npcPrecise ?? event.npcBlock),
      targetBlock: blockCoordinate(event.targetBlock),
      targetPrecise: preciseCoordinate(event.targetPrecise ?? event.targetBlock)
    },
    state: { state: event.state, phase: event.phase },
    navigation: event.navigation,
    path: event.path,
    obstacle: event.obstacle,
    blockProbes: event.blockProbes,
    semanticPoint: observerSemanticPoint(event.semanticPoint),
    timestampTick: event.timestampTick,
    timestampMillis: event.timestampMillis,
    rawType: event.type
  }
}

function identity(event: LivingNpcTelemetryEvent): LivingNpcIdentity {
  return { uuid: event.npcId, name: event.name, role: event.role, world: event.world }
}

function identityKey(event: LivingNpcTelemetryEvent): string {
  return event.npcId ?? `${event.world}:${event.name}:${event.role}`
}

function expectedRoleFor(event: LivingNpcTelemetryEvent, options: LivingNpcTelemetryAnalysisOptions): string | undefined {
  if (event.npcId && options.expectedRolesByNpcId?.[event.npcId] !== undefined) return options.expectedRolesByNpcId[event.npcId]
  return options.expectedRolesByName?.[event.name]
}

function blockCoordinate(position: LivingNpcTelemetryPosition | null): BlockCoordinate | null {
  if (!position) return null
  return { world: position.world, x: position.xBlock, y: position.yBlock, z: position.zBlock }
}

function preciseCoordinate(position: LivingNpcTelemetryPosition | null): PreciseCoordinate | null {
  if (!position) return null
  return { world: position.world, x: position.x, y: position.y, z: position.z, yaw: position.yaw, pitch: position.pitch }
}

function observerSemanticPoint(point: LivingNpcTelemetryEvent['semanticPoint']): LivingNpcObserverSemanticPoint | null {
  if (!point) return null
  return { type: point.type, name: point.name, world: point.world, position: preciseCoordinate(point.position) }
}

function semanticTargetKey(point: LivingNpcObserverSemanticPoint): string {
  const position = point.position
  if (!position) return `${point.world}:unavailable`
  return [position.world, position.x, position.y, position.z].join(':')
}
