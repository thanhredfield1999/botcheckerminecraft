import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

const baseStep = z.strictObject({
  id: z.string().min(1),
  timeoutMs: z.number().int().positive().max(300_000).default(30_000),
  optional: z.boolean().default(false),
  note: z.string().optional()
})

const worldCoordinate = z.number().min(-29_999_984).max(29_999_984)
const positionSchema = z.strictObject({
  x: worldCoordinate,
  y: worldCoordinate,
  z: worldCoordinate
})
const gateBlockSchema = z.strictObject({
  x: worldCoordinate.int(),
  y: worldCoordinate.int(),
  z: worldCoordinate.int()
})

const stepSchema = z.discriminatedUnion('action', [
  baseStep.extend({ action: z.literal('wait'), durationMs: z.number().int().nonnegative().max(300_000) }),
  baseStep.extend({ action: z.literal('chat'), message: z.string().min(1) }),
  baseStep.extend({ action: z.literal('wait_for_text'), text: z.string().min(1), source: z.enum(['any', 'chat', 'title', 'action_bar']).default('any') }),
  baseStep.extend({ action: z.literal('wait_for_gui'), titleIncludes: z.string().optional() }),
  baseStep.extend({
    action: z.literal('assert_gui'),
    titleIncludes: z.string().min(1).optional(),
    items: z.array(z.strictObject({
      slot: z.number().int().nonnegative().optional(),
      nameIncludes: z.string().min(1).optional(),
      loreIncludes: z.string().min(1).optional(),
      count: z.number().int().positive().optional()
    }).refine(value => value.slot !== undefined || value.nameIncludes || value.loreIncludes, 'GUI item selector is required')).min(1).optional()
  }).refine(value => value.titleIncludes !== undefined || value.items !== undefined, 'titleIncludes or items is required'),
  baseStep.extend({ action: z.literal('click_gui'), slot: z.number().int().nonnegative().optional(), nameIncludes: z.string().optional(), loreIncludes: z.string().optional(), button: z.enum(['left', 'right']).default('left'), inspectDelayMs: z.number().int().nonnegative().max(10_000).default(750) }).refine(value => value.slot !== undefined || value.nameIncludes || value.loreIncludes, 'slot, nameIncludes or loreIncludes is required'),
  baseStep.extend({ action: z.literal('go_to'), x: z.number(), y: z.number(), z: z.number(), range: z.number().positive().max(16).default(1), travel: z.enum(['walk', 'teleport']).default('walk') }),
  baseStep.extend({
    action: z.literal('interact_entity'),
    nameIncludes: z.string().min(1),
    requiredUuid: z.string().trim().uuid().optional(),
    maxDistance: z.number().positive().max(128).default(32),
    interactionRange: z.number().positive().max(6).default(2.5),
    travel: z.enum(['walk', 'teleport']).default('walk'),
    x: z.number().optional(),
    y: z.number().optional(),
    z: z.number().optional(),
    waitForGui: z.boolean().default(false)
  }).refine(value => [value.x, value.y, value.z].every(coordinate => coordinate === undefined) || [value.x, value.y, value.z].every(coordinate => coordinate !== undefined), 'x, y and z must be provided together'),
  baseStep.extend({ action: z.literal('equip'), itemIncludes: z.string().min(1), destination: z.enum(['hand', 'off-hand', 'head', 'torso', 'legs', 'feet']).default('hand') }),
  baseStep.extend({ action: z.literal('fish'), attempts: z.number().int().positive().max(20).default(1) }),
  baseStep.extend({ action: z.literal('plant'), seedIncludes: z.string().min(1), soil: z.enum(['farmland', 'dirt', 'grass_block']).default('farmland') }),
  baseStep.extend({ action: z.literal('assert_inventory'), itemIncludes: z.string().min(1), minimum: z.number().int().positive().default(1) }),
  baseStep.extend({ action: z.literal('assert_position'), x: z.number(), y: z.number(), z: z.number(), range: z.number().positive().default(3) }),
  baseStep.extend({
    action: z.literal('assert_state'),
    minimumHealth: z.number().min(0).max(20).optional(),
    minimumFood: z.number().min(0).max(20).optional(),
    gui: z.enum(['open', 'closed', 'any']).default('closed')
  }).refine(value => value.minimumHealth !== undefined || value.minimumFood !== undefined || value.gui !== 'any', 'at least one state assertion is required'),
  baseStep.extend({
    action: z.literal('assert_nearby_entity'),
    nameIncludes: z.string().min(1),
    requiredUuid: z.string().uuid().optional(),
    maxDistance: z.number().positive().max(128).default(48)
  }),
  baseStep.extend({
    action: z.literal('inspect_entities'),
    maxDistance: z.number().positive().max(128).default(48),
    limit: z.number().int().positive().max(64).default(64)
  }),
  baseStep.extend({
    action: z.literal('observe_load'),
    durationMs: z.number().int().positive().max(30_000).default(5_000),
    sampleMs: z.number().int().min(100).max(5_000).default(500),
    maxDistance: z.number().positive().max(48).default(48),
    maxEntities: z.number().int().positive().max(64).default(64),
    maxInventoryItems: z.number().int().positive().max(46).default(46)
  }),
  baseStep.extend({
    action: z.literal('observe_crossing'),
    nameIncludes: z.string().min(1),
    targetUuid: z.string().trim().uuid().optional(),
    serverWorld: z.string().trim().min(1).max(128).optional(),
    dimension: z.string().trim().min(1).max(128).optional(),
    gateBlock: gateBlockSchema.optional(),
    maxDistance: z.number().positive().max(128).default(32),
    approach: positionSchema,
    exit: positionSchema,
    entryClearance: z.number().nonnegative().default(0.3),
    exitClearance: z.number().nonnegative().default(0.3),
    verticalTolerance: z.number().positive().default(1),
    requiredExitSamples: z.number().int().positive().max(20).default(2),
    planeEpsilon: z.number().positive().max(1).default(0.1),
    corridorHalfWidth: z.number().positive().max(8).default(0.75),
    maxStepDistance: z.number().positive().max(8).default(1.75),
    exitDwellMs: z.number().int().nonnegative().max(10_000).default(300),
    requireUuid: z.literal(true).default(true),
    sampleMs: z.number().int().min(50).max(5_000).default(100)
  })
])

export const scenarioSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().default(''),
  maxDurationMs: z.number().int().positive().max(3_600_000).default(900_000),
  steps: z.array(stepSchema).min(1)
}).superRefine((scenario, context) => {
  const seen = new Set<string>()
  scenario.steps.forEach((step, index) => {
    if (seen.has(step.id)) {
      context.addIssue({
        code: 'custom', path: ['steps', index, 'id'],
        message: `Step ID bị trùng: ${step.id}`
      })
    }
    seen.add(step.id)
    if (step.action !== 'observe_crossing') return

    const pairingValues = [step.targetUuid, step.serverWorld, step.dimension, step.gateBlock]
    const pairingFieldCount = pairingValues.filter(value => value !== undefined).length
    if (pairingFieldCount !== 0 && pairingFieldCount !== pairingValues.length) {
      context.addIssue({
        code: 'custom', path: ['steps', index],
        message: 'Crossing pairing phải có targetUuid, serverWorld, dimension và gateBlock đồng thời'
      })
    }

    const dx = step.exit.x - step.approach.x
    const dz = step.exit.z - step.approach.z
    const distanceXZ = Math.hypot(dx, dz)
    if (!Number.isFinite(distanceXZ) || distanceXZ <= 1e-9) {
      context.addIssue({
        code: 'custom', path: ['steps', index, 'exit'],
        message: 'Approach và exit phải tạo crossing geometry hữu hạn trong mặt phẳng XZ'
      })
      return
    }
    if (distanceXZ / 2 < Math.max(step.entryClearance, step.exitClearance, step.planeEpsilon)) {
      context.addIssue({
        code: 'custom', path: ['steps', index],
        message: 'Approach và exit không đủ xa mặt phẳng để thỏa clearance crossing'
      })
    }
    if (Math.abs(step.approach.y - step.exit.y) >= step.verticalTolerance) {
      context.addIssue({
        code: 'custom', path: ['steps', index, 'exit', 'y'],
        message: 'Approach và exit lệch cao độ ngoài vertical tolerance'
      })
    }
    if (pairingFieldCount === pairingValues.length && step.gateBlock) {
      const gateCenter = {
        x: step.gateBlock.x + 0.5,
        y: step.gateBlock.y,
        z: step.gateBlock.z + 0.5
      }
      const tolerance = 1e-6
      const midpointX = (step.approach.x + step.exit.x) / 2
      const midpointZ = (step.approach.z + step.exit.z) / 2
      const centered = Math.hypot(midpointX - gateCenter.x, midpointZ - gateCenter.z) <= tolerance
      const axisAligned = (Math.abs(Math.abs(dx) - 2) <= tolerance && Math.abs(dz) <= tolerance)
        || (Math.abs(Math.abs(dz) - 2) <= tolerance && Math.abs(dx) <= tolerance)
      const level = Math.abs(step.approach.y - gateCenter.y) <= tolerance
        && Math.abs(step.exit.y - gateCenter.y) <= tolerance
      if (!centered || !axisAligned || !level) {
        context.addIssue({
          code: 'custom', path: ['steps', index, 'gateBlock'],
          message: 'Paired crossing phải dùng hai điểm đứng đối xứng cách tâm gateBlock đúng 1 block trên một trục X hoặc Z'
        })
      }
    }
  })
})

export type Scenario = z.infer<typeof scenarioSchema>
export type ScenarioStep = Scenario['steps'][number]

export async function loadScenario(scenarioDir: string, name: string): Promise<Scenario> {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid scenario name')
  const file = path.resolve(scenarioDir, `${name}.json`)
  return scenarioSchema.parse(JSON.parse(await readFile(file, 'utf8')))
}
