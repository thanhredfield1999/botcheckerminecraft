import assert from 'node:assert/strict'
import test from 'node:test'
import { scenarioSchema } from '../src/scenario.js'

/**
 * Dogfooding 2026-09-07: năm dự án thật (VillageDefense, LivingNPC, ItemGuard,
 * RestaurantTycoon, BastionForge) dùng thử BotChecker. Kết luận chung của họ là
 * harness QUAN SÁT tốt nhưng ASSERT yếu — ghi được nhiều evidence, nhưng thiếu
 * đúng những assertion khiến evidence đó kết luận được điều gì.
 *
 * File này khoá các assertion vá lỗ hổng đó. Xem docs/DOGFOOD_FINDINGS_2026-09-07.md.
 */

const step = (extra: Record<string, unknown>) => ({
  name: 'dogfood', maxDurationMs: 60_000,
  steps: [{ id: 's1', action: 'assert_inventory', itemIncludes: 'sword', ...extra }]
})

test('DF-01: assert_inventory nhận exactly — phát hiện dupe', () => {
  // ItemGuard: "minimum:1 van PASS ca khi dupe thanh cong tao ra 2 sword".
  // `exactly` là assertion DUY NHẤT có thể fail khi dupe xảy ra.
  const parsed = scenarioSchema.parse(step({ exactly: 1 }))
  assert.equal((parsed.steps[0] as { exactly?: number }).exactly, 1)
})

test('DF-01: assert_inventory nhận maximum, và minimum: 0', () => {
  // VillageDefense cần chứng minh MẤT đồ khi chết → maximum: 0.
  // `minimum: 0` trước đây bị .positive() chặn, dù nó hoàn toàn hợp lệ.
  assert.equal((scenarioSchema.parse(step({ maximum: 0 })).steps[0] as { maximum?: number }).maximum, 0)
  assert.equal((scenarioSchema.parse(step({ minimum: 0 })).steps[0] as { minimum?: number }).minimum, 0)
})

test('DF-01: exactly loại trừ minimum/maximum, và min>max bị chặn', () => {
  // Cho cả ba cùng lúc là mâu thuẫn ý định — bắt lỗi lúc parse, không phải lúc chạy.
  assert.throws(() => scenarioSchema.parse(step({ exactly: 1, minimum: 2 })))
  assert.throws(() => scenarioSchema.parse(step({ exactly: 1, maximum: 2 })))
  assert.throws(() => scenarioSchema.parse(step({ minimum: 3, maximum: 2 })))
})

test('DF-04: assert_nearby_entity nhận exactly/maximum', () => {
  // ItemGuard: "assertion nay PASS ca khi merge thanh 1 lan khi van con 2".
  const base = { id: 's1', action: 'assert_nearby_entity', nameIncludes: 'item' }
  const two = scenarioSchema.parse({
    name: 'd', maxDurationMs: 60_000, steps: [{ ...base, exactly: 2 }] })
  assert.equal((two.steps[0] as { exactly?: number }).exactly, 2)

  const none = scenarioSchema.parse({
    name: 'd', maxDurationMs: 60_000, steps: [{ ...base, maximum: 0 }] })
  assert.equal((none.steps[0] as { maximum?: number }).maximum, 0)

  // requiredUuid pin đúng một entity nên đi kèm exactly khác 1 là vô nghĩa.
  assert.throws(() => scenarioSchema.parse({
    name: 'd', maxDurationMs: 60_000,
    steps: [{ ...base, requiredUuid: '00000000-0000-4000-8000-000000000000', exactly: 2 }] }))
})

test('DF-02: wait_for_text nhận notText, và allOf một phần tử', () => {
  const negative = scenarioSchema.parse({
    name: 'd', maxDurationMs: 60_000,
    steps: [{ id: 's1', action: 'wait_for_text', notText: 'Loi', durationMs: 2000 }] })
  assert.equal((negative.steps[0] as { notText?: string }).notText, 'Loi')

  // allOf.min(2) cũ ép người viết scenario phải đổi sang `text` khi list còn 1
  // phần tử — khó chịu vô ích khi sinh scenario bằng script.
  const single = scenarioSchema.parse({
    name: 'd', maxDurationMs: 60_000,
    steps: [{ id: 's1', action: 'wait_for_text', allOf: ['xong'] }] })
  assert.deepEqual((single.steps[0] as { allOf?: string[] }).allOf, ['xong'])

  // Vẫn giữ: đúng một trong text/allOf/notText.
  assert.throws(() => scenarioSchema.parse({
    name: 'd', maxDurationMs: 60_000,
    steps: [{ id: 's1', action: 'wait_for_text', text: 'a', notText: 'b' }] }))
  assert.throws(() => scenarioSchema.parse({
    name: 'd', maxDurationMs: 60_000, steps: [{ id: 's1', action: 'wait_for_text' }] }))
})

test('DF-02: notText cần durationMs — nếu không thì nó vô nghĩa', () => {
  // "Chưa thấy text X" luôn đúng ở thời điểm 0. Assertion chỉ có giá trị khi
  // quan sát suốt một khoảng thời gian, nên durationMs là bắt buộc.
  assert.throws(() => scenarioSchema.parse({
    name: 'd', maxDurationMs: 60_000,
    steps: [{ id: 's1', action: 'wait_for_text', notText: 'Loi' }] }))
})
