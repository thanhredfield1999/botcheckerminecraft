import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { containsCredentialMaterial } from './failure-envelope.js'

// DF-06 (dogfooding 2026-09-07): trần cũ 300000ms (5 phút) bất đối xứng vô lý với
// `maxDurationMs` cho phép tới 1 giờ. RestaurantTycoon có luồng THIẾT KẾ là chờ
// vài phút (đặt hàng → villager chở tới), LivingNPC có lunch-rest schedule dài.
// Nâng lên bằng trần scenario; ràng buộc thật (step không vượt cả run) được kiểm
// ở superRefine bên dưới, chỗ đó mới biết maxDurationMs.
const MAX_RUN_MS = 3_600_000

const baseStep = z.strictObject({
  id: z.string().min(1),
  timeoutMs: z.number().int().positive().max(MAX_RUN_MS).default(30_000),
  optional: z.boolean().default(false),
  note: z.string().optional()
})

const worldCoordinate = z.number().min(-29_999_984).max(29_999_984)

// DF-05: pattern phải là regex hợp lệ VÀ có ít nhất một nhóm bắt — regex không
// nhóm thì không capture được gì, và để scenario chạy rồi mới thấy biến rỗng là
// kiểu lỗi khó truy nhất.
const capturePattern = z.string().min(1).max(256).superRefine((pattern, context) => {
  let compiled: RegExp
  try {
    compiled = new RegExp(pattern)
  } catch {
    context.addIssue({ code: 'custom', message: 'pattern không phải regex hợp lệ' })
    return
  }
  // Đếm nhóm bắt bằng cách khớp chuỗi rỗng với một nhánh luôn đúng — mẹo chuẩn,
  // không cần parse regex bằng tay.
  const groupCount = new RegExp(`${compiled.source}|`).exec('')!.length - 1
  if (groupCount < 1) {
    context.addIssue({ code: 'custom', message: 'pattern phải có ít nhất một nhóm bắt' })
  }
})

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
  baseStep.extend({ action: z.literal('wait'), durationMs: z.number().int().nonnegative().max(MAX_RUN_MS) }),
  baseStep.extend({ action: z.literal('chat'), message: z.string().min(1) }),
  baseStep.extend({
    action: z.literal('wait_for_text'),
    text: z.string().min(1).optional(),
    // DF-02: `.min(2)` cũ ép người viết phải đổi sang `text` khi list còn đúng 1
    // phần tử — vô ích khi sinh scenario bằng script.
    allOf: z.array(z.string().min(1)).min(1).max(16).optional(),
    // DF-02: negative assertion. "Không có message lỗi nào trong N ms" là thứ QA
    // cần thường xuyên nhưng trước đây không diễn đạt được.
    notText: z.string().min(1).optional(),
    // Cửa sổ quan sát cho notText. Nằm ở đây chứ không ở baseStep vì chỉ
    // wait_for_text mới cần nó.
    durationMs: z.number().int().positive().max(MAX_RUN_MS).optional(),
    source: z.enum(['any', 'chat', 'title', 'action_bar']).default('any')
  }).refine(
    value => [value.text, value.allOf, value.notText].filter(v => v !== undefined).length === 1,
    'exactly one of text, allOf or notText is required'
  ).refine(
    // "Chưa thấy X" luôn đúng ở thời điểm 0. Assertion chỉ có nghĩa khi quan sát
    // suốt một khoảng thời gian, nên notText bắt buộc đi kèm durationMs.
    value => value.notText === undefined || value.durationMs !== undefined,
    'notText requires durationMs — the absence of text is only meaningful over a window'
  ),
  baseStep.extend({ action: z.literal('wait_for_gui'), titleIncludes: z.string().optional() }),
  baseStep.extend({
    action: z.literal('assert_gui'),
    afterStep: z.string().min(1).optional(),
    topSlotCount: z.number().int().nonnegative().max(256).optional(),
    titleIncludes: z.string().min(1).optional(),
    items: z.array(z.strictObject({
      slot: z.number().int().nonnegative().optional(),
      section: z.enum(['top', 'player']).default('top'),
      material: z.string().min(1).optional(),
      nameIncludes: z.string().min(1).optional(),
      loreIncludes: z.string().min(1).optional(),
      count: z.number().int().positive().optional(),
      exactly: z.number().int().nonnegative().max(256).optional(),
      absent: z.literal(true).optional(),
      slotEmpty: z.literal(true).optional()
    }).superRefine((value, context) => {
      if (value.slot === undefined && !value.material && !value.nameIncludes && !value.loreIncludes) {
        context.addIssue({ code: 'custom', message: 'GUI item selector is required' })
      }
      if (value.slotEmpty) {
        if (value.slot === undefined) context.addIssue({ code: 'custom', path: ['slot'], message: 'slotEmpty requires slot' })
        if (value.material || value.nameIncludes || value.loreIncludes || value.count !== undefined || value.exactly !== undefined || value.absent) {
          context.addIssue({ code: 'custom', message: 'slotEmpty cannot be combined with item predicates' })
        }
      }
      if (value.absent && value.exactly !== undefined && value.exactly !== 0) {
        context.addIssue({ code: 'custom', path: ['exactly'], message: 'absent only permits exactly 0' })
      }
    })).min(1).optional()
  }).refine(value => value.titleIncludes !== undefined || value.topSlotCount !== undefined || value.items !== undefined, 'titleIncludes, topSlotCount or items is required'),
  baseStep.extend({ action: z.literal('click_gui'), slot: z.number().int().nonnegative().optional(), section: z.enum(['top', 'player']).default('top'), nameIncludes: z.string().optional(), loreIncludes: z.string().optional(), button: z.enum(['left', 'right']).default('left'), inspectDelayMs: z.number().int().nonnegative().max(10_000).default(750) }).refine(value => value.slot !== undefined || value.nameIncludes || value.loreIncludes, 'slot, nameIncludes or loreIncludes is required'),
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
  // DF-03 (dogfooding 2026-09-07): ItemGuard không tự động hoá được mảng anti-dupe
  // vì thiếu action này — họ phải thêm command drop vào chính sản phẩm để test
  // được, tức là sửa thứ đang kiểm. Drop/pickup là bề mặt dupe cổ điển nhất.
  // Không có `count` = thả trọn stack.
  baseStep.extend({
    action: z.literal('drop_item'),
    itemIncludes: z.string().min(1),
    count: z.number().int().positive().max(64).optional()
  }),
  // DF-05 (dogfooding 2026-09-07): harness không có state giữa các step, nên
  // ItemGuard không chứng minh được CÙNG MỘT item trước/sau thao tác, còn
  // RestaurantTycoon phải sửa tay `targetUuid` sau khi đọc UUID thật.
  //
  // `capture` trích một nhóm regex từ text đã quan sát vào biến có tên.
  // Cố ý KHÔNG làm template `${var}` thay thế tự do trong mọi field: nó biến
  // scenario thành ngôn ngữ lập trình mini, khó kiểm chứng và dễ sinh evidence
  // sai một cách im lặng.
  baseStep.extend({
    action: z.literal('capture'),
    name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'tên biến phải là identifier'),
    pattern: capturePattern,
    group: z.number().int().positive().max(9).default(1),
    source: z.enum(['any', 'chat', 'title', 'action_bar']).default('any')
  }),
  baseStep.extend({
    action: z.literal('assert_capture'),
    name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'tên biến phải là identifier'),
    pattern: capturePattern,
    group: z.number().int().positive().max(9).default(1),
    source: z.enum(['any', 'chat', 'title', 'action_bar']).default('any'),
    // equals: false chứng minh giá trị ĐÃ ĐỔI — cần cho luồng ngược (sau khi rèn,
    // mã item phải khác; giống nghĩa là thao tác không có hiệu lực).
    equals: z.boolean().default(true)
  }),
  baseStep.extend({ action: z.literal('fish'), attempts: z.number().int().positive().max(20).default(1) }),
  baseStep.extend({ action: z.literal('plant'), seedIncludes: z.string().min(1), soil: z.enum(['farmland', 'dirt', 'grass_block']).default('farmland') }),
  // Dogfooding 2026-09-07 (DF-01): trước đây chỉ có `minimum` và nó `.positive()`.
  // Hệ quả là assertion KHÔNG BAO GIỜ fail được khi dupe xảy ra — `minimum: 1` vẫn
  // pass khi tồn tại 2 item. ItemGuard gọi đây là gap lớn nhất, và họ đúng.
  // `exactly` là thứ duy nhất chứng minh được "đúng N, không hơn"; `maximum: 0`
  // chứng minh được "đã mất" (VillageDefense cần cho luồng chết-mất-đồ).
  baseStep.extend({
    action: z.literal('assert_inventory'),
    itemIncludes: z.string().min(1),
    minimum: z.number().int().nonnegative().optional(),
    maximum: z.number().int().nonnegative().optional(),
    exactly: z.number().int().nonnegative().optional()
  }).refine(
    value => value.exactly === undefined
      || (value.minimum === undefined && value.maximum === undefined),
    'exactly cannot be combined with minimum or maximum'
  ).refine(
    value => value.minimum === undefined || value.maximum === undefined
      || value.minimum <= value.maximum,
    'minimum must not exceed maximum'
  ).transform(value => value.exactly === undefined
    && value.minimum === undefined && value.maximum === undefined
    ? { ...value, minimum: 1 }   // giữ nguyên hành vi mặc định cũ
    : value),
  baseStep.extend({ action: z.literal('assert_position'), x: z.number(), y: z.number(), z: z.number(), range: z.number().positive().default(3) }),
  baseStep.extend({
    action: z.literal('assert_state'),
    minimumHealth: z.number().min(0).max(20).optional(),
    minimumFood: z.number().min(0).max(20).optional(),
    gui: z.enum(['open', 'closed', 'any']).default('closed')
  }).refine(value => value.minimumHealth !== undefined || value.minimumFood !== undefined || value.gui !== 'any', 'at least one state assertion is required'),
  // DF-04: cùng hình dạng lỗi với assert_inventory. Trước đây chỉ khẳng định được
  // "có tồn tại", nên assertion pass cả khi ground-item merge sai (còn 2 thay vì 1)
  // lẫn khi merge đúng. `exactly`/`maximum` mới phân biệt được hai trường hợp đó.
  baseStep.extend({
    action: z.literal('assert_nearby_entity'),
    nameIncludes: z.string().min(1),
    requiredUuid: z.string().uuid().optional(),
    maxDistance: z.number().positive().max(128).default(48),
    minimum: z.number().int().nonnegative().optional(),
    maximum: z.number().int().nonnegative().optional(),
    exactly: z.number().int().nonnegative().optional()
  }).refine(
    value => value.exactly === undefined
      || (value.minimum === undefined && value.maximum === undefined),
    'exactly cannot be combined with minimum or maximum'
  ).refine(
    value => value.minimum === undefined || value.maximum === undefined
      || value.minimum <= value.maximum,
    'minimum must not exceed maximum'
  ).refine(
    // requiredUuid pin đúng một entity; đòi số lượng khác 1 là tự mâu thuẫn.
    value => value.requiredUuid === undefined
      || (value.exactly ?? 1) === 1 && (value.maximum ?? 1) >= 1 && (value.minimum ?? 1) <= 1,
    'requiredUuid pins a single entity and cannot be combined with a different count'
  ).refine(
    value => (value.exactly === undefined && value.maximum === undefined) || value.timeoutMs > 300,
    'timeoutMs must exceed 300 ms for exact/maximum count dwell and poll margin'
  ),
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
    action: z.literal('observe_route'),
    nameIncludes: z.string().min(1),
    targetUuid: z.string().trim().uuid(),
    maxDistance: z.number().positive().max(128).default(64),
    checkpoints: z.array(z.strictObject({ id: z.string().min(1), position: positionSchema, radius: z.number().positive().max(8) })).min(2).max(16),
    fences: z.array(z.strictObject({ block: gateBlockSchema, expectedName: z.string().min(1).optional() })).max(128).default([]),
    gates: z.array(z.strictObject({
      checkpointId: z.string().min(1),
      block: gateBlockSchema,
      approach: positionSchema,
      exit: positionSchema,
      entryClearance: z.number().nonnegative().default(0.3),
      exitClearance: z.number().nonnegative().default(0.3),
      verticalTolerance: z.number().positive().default(1),
      requiredExitSamples: z.number().int().positive().max(20).default(2),
      planeEpsilon: z.number().positive().max(1).default(0.1),
      corridorHalfWidth: z.number().positive().max(8).default(0.75),
      // DF-08: xem chú thích ở observe_crossing. Gate của observe_route dùng cùng
      // CrossingTracker nên phải có cùng tuỳ chọn, nếu không route-level gate vẫn
      // giữ nguyên false positive đã sửa ở crossing-level.
      entityHalfWidth: z.number().nonnegative().max(4).default(0),
      maxStepDistance: z.number().positive().max(8).default(1.75),
      exitDwellMs: z.number().int().nonnegative().max(10_000).default(300)
    })).max(16).default([]),
    requireFenceEvidence: z.boolean().default(true),
    sampleMs: z.number().int().min(50).max(5_000).default(100)
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
    // DF-08: nửa bề ngang thân entity. Mặc định 0 = point check trên tâm (hành vi
    // cũ). Đặt 0.3 cho NPC dạng người để corridor tính theo mép thân — nếu không,
    // NPC cạ tường vẫn được tính là qua gate hợp lệ.
    entityHalfWidth: z.number().nonnegative().max(4).default(0),
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
  qa: z.strictObject({
    project: z.string().trim().min(1).max(128),
    fixture: z.string().trim().min(1).max(128),
    accountRole: z.string().trim().min(1).max(64),
    authorization: z.array(z.string().trim().min(1).max(128).refine(
      value => !containsCredentialMaterial(value),
      'Credential-like QA authorization rejected'
    )).min(1).max(32),
    phase: z.enum(['persistence', 'permission', 'negative-security']).optional()
  }).optional(),
  steps: z.array(stepSchema).min(1).max(256)
}).superRefine((scenario, context) => {
  const seen = new Set<string>()
  // DF-05: theo dõi biến đã capture theo THỨ TỰ step. Tham chiếu biến chưa tồn
  // tại phải fail lúc parse — nếu để lúc chạy, một scenario sai chính tả sẽ chạy
  // hết rồi báo pass vì "không có gì để so".
  const capturedNames = new Set<string>()
  scenario.steps.forEach((step, index) => {
    if (seen.has(step.id)) {
      context.addIssue({
        code: 'custom', path: ['steps', index, 'id'],
        message: `Step ID bị trùng: ${step.id}`
      })
    }
    if (step.action === 'assert_gui' && step.afterStep !== undefined && !seen.has(step.afterStep)) {
      context.addIssue({
        code: 'custom', path: ['steps', index, 'afterStep'],
        message: 'afterStep phải tham chiếu một step đứng trước assert_gui'
      })
    }
    seen.add(step.id)
    // DF-06: trần cứng 5 phút đã bỏ, nhưng ràng buộc THẬT vẫn phải giữ — một step
    // không được chờ lâu hơn cả run. Chỉ tính thời lượng NGƯỜI VIẾT chủ động đặt:
    // `timeoutMs` mặc định là 30s, và scenario ngắn hợp lệ (vd 1s cho unit test)
    // không nên bị chặn chỉ vì mặc định của một field không ai khai báo.
    const declaredWait = step.action === 'wait' ? step.durationMs
      : step.action === 'wait_for_text' ? (step.durationMs ?? 0)
        : 0
    if (declaredWait > step.timeoutMs || (step.action === 'wait_for_text'
      && step.notText !== undefined && declaredWait === step.timeoutMs)) {
      context.addIssue({
        code: 'custom', path: ['steps', index, 'timeoutMs'],
        message: 'timeoutMs phải đủ cho durationMs; notText cần timeoutMs lớn hơn cửa sổ quan sát'
      })
    }
    if (declaredWait > scenario.maxDurationMs) {
      context.addIssue({
        code: 'custom', path: ['steps', index],
        message: `Step chờ ${declaredWait}ms vượt maxDurationMs ${scenario.maxDurationMs}ms của scenario`
      })
    }
    if (step.action === 'capture' || step.action === 'assert_capture') {
      try {
        // Nhánh rỗng đi trước: đếm nhóm mà không thực thi pattern người viết.
        const groupCount = new RegExp(`|(?:${step.pattern})`).exec('')!.length - 1
        if (step.group > groupCount) {
          context.addIssue({ code: 'custom', path: ['steps', index, 'group'],
            message: 'group không tồn tại trong pattern' })
        }
      } catch {
        // capturePattern đã báo regex không hợp lệ ở field pattern.
      }
    }
    if (step.action === 'capture') {
      if (capturedNames.has(step.name)) {
        context.addIssue({
          code: 'custom', path: ['steps', index, 'name'],
          message: `Biến capture bị trùng: ${step.name}`
        })
      }
      capturedNames.add(step.name)
    }
    if (step.action === 'assert_capture' && !capturedNames.has(step.name)) {
      context.addIssue({
        code: 'custom', path: ['steps', index, 'name'],
        message: `assert_capture tham chiếu biến chưa được capture trước đó: ${step.name}`
      })
    }
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
      // DF-07: trước đây ép `|dx| == 2` — tức đúng 1 block mỗi bên. Đối xứng và
      // axis-aligned là invariant thật (chúng bảo đảm crossing plane vuông góc
      // với gate và hai điểm nằm hai phía); còn con số 1 block chỉ đúng với gate
      // của LivingNPC. RestaurantTycoon phải bỏ hẳn pairing vì ràng buộc này.
      const axisAligned = (Math.abs(dz) <= tolerance && Math.abs(dx) > tolerance)
        || (Math.abs(dx) <= tolerance && Math.abs(dz) > tolerance)
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
