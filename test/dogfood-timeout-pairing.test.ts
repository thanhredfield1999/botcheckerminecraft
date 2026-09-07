import assert from 'node:assert/strict'
import test from 'node:test'
import { scenarioSchema } from '../src/scenario.js'

/**
 * DF-06 và DF-07 (dogfooding 2026-09-07).
 *
 * DF-06 — LivingNPC và RestaurantTycoon đều đụng trần `timeoutMs` 300000ms.
 * Bất đối xứng vô lý: scenario cho phép `maxDurationMs` tới 1 giờ, nhưng một
 * step không chờ quá 5 phút được. RestaurantTycoon có luồng THIẾT KẾ là chờ vài
 * phút (đặt hàng → villager chở tới).
 *
 * DF-07 — RestaurantTycoon phải BỎ HẲN pairing vì schema ép hình học "đúng 1
 * block mỗi bên". Đối xứng và axis-aligned là invariant thật; con số 1 block thì
 * không — nó chỉ đúng với gate của LivingNPC.
 */

const crossingStep = (extra: Record<string, unknown> = {}) => ({
  id: 'g1', action: 'observe_crossing', nameIncludes: 'npc',
  approach: { x: 4, y: 64, z: 10 },
  exit: { x: 6, y: 64, z: 10 },
  ...extra
})

const pairing = {
  targetUuid: '00000000-0000-4000-8000-000000000000',
  serverWorld: 'world', dimension: 'overworld',
  gateBlock: { x: 5, y: 64, z: 10 }
}

test('DF-06: step chờ được tới 1 giờ, khớp trần của scenario', () => {
  const parsed = scenarioSchema.parse({
    name: 'long', maxDurationMs: 3_600_000,
    steps: [{ id: 's1', action: 'wait', durationMs: 600_000, timeoutMs: 660_000 }]
  })
  assert.equal((parsed.steps[0] as { durationMs: number }).durationMs, 600_000)
  assert.equal((parsed.steps[0] as { timeoutMs: number }).timeoutMs, 660_000)
})

test('DF-06: step không vượt được trần scenario — chờ lâu hơn cả run là vô nghĩa', () => {
  assert.throws(() => scenarioSchema.parse({
    name: 'x', maxDurationMs: 3_600_001,
    steps: [{ id: 's1', action: 'wait', durationMs: 1000 }]
  }))
  // Thời lượng chờ NGƯỜI VIẾT chủ động đặt không được vượt cả run.
  assert.throws(() => scenarioSchema.parse({
    name: 'x', maxDurationMs: 60_000,
    steps: [{ id: 's1', action: 'wait', durationMs: 120_000 }]
  }))
  // Nhưng `timeoutMs` mặc định (30s) KHÔNG được chặn scenario ngắn hợp lệ —
  // ràng buộc chỉ áp cho giá trị khai báo tường minh.
  const short = scenarioSchema.parse({
    name: 'short', maxDurationMs: 1000,
    steps: [{ id: 's1', action: 'chat', message: 'hi' }]
  })
  assert.equal(short.steps.length, 1)
})

test('DF-07: pairing chấp nhận gate rộng hơn 1 block mỗi bên', () => {
  // gateBlock.x = 5 → tâm block là 5.5. Hai điểm đối xứng quanh 5.5, cùng trục X,
  // cùng cao độ — nhưng cách 3 block mỗi bên thay vì 1.
  const parsed = scenarioSchema.parse({
    name: 'wide', maxDurationMs: 60_000,
    steps: [crossingStep({
      approach: { x: 2.5, y: 64, z: 10.5 },
      exit: { x: 8.5, y: 64, z: 10.5 },
      ...pairing
    })]
  })
  assert.equal(parsed.steps.length, 1)
})

test('DF-07: vẫn CHẶN mất đối xứng, lệch trục, lệch cao độ', () => {
  const bad = (approach: object, exit: object) => () => scenarioSchema.parse({
    name: 'bad', maxDurationMs: 60_000,
    steps: [crossingStep({ approach, exit, ...pairing })]
  })

  // Lệch tâm: hai điểm không đối xứng quanh gate → không chứng minh được đã qua.
  assert.throws(bad({ x: 4, y: 64, z: 10 }, { x: 9, y: 64, z: 10 }))
  // Chéo trục: crossing plane không vuông góc với gate.
  assert.throws(bad({ x: 4, y: 64, z: 9 }, { x: 6, y: 64, z: 11 }))
  // Lệch cao độ so với gate block.
  assert.throws(bad({ x: 4, y: 66, z: 10 }, { x: 6, y: 66, z: 10 }))
})

test('DF-07: pairing vẫn phải đủ cả 4 field', () => {
  // Nới hình học không có nghĩa là nới tính toàn vẹn của pairing.
  assert.throws(() => scenarioSchema.parse({
    name: 'partial', maxDurationMs: 60_000,
    steps: [crossingStep({ targetUuid: pairing.targetUuid })]
  }))
})
