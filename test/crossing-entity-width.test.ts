import assert from 'node:assert/strict'
import test from 'node:test'
import { CrossingTracker, type CrossingOptions } from '../src/crossing.js'

/**
 * DF-08 (dogfooding 2026-09-07). LivingNPC quan sát được:
 *
 *     PASS dù NPC cạ tường ở z=8.0018 (lateral 0.4982 < 0.6)
 *
 * Nguyên nhân: `corridorHalfWidth` so sánh với TÂM entity, không tính bề ngang
 * thân. NPC dạng người rộng 0.6 block (nửa = 0.3): tâm ở lateral 0.4982 nghĩa là
 * mép thân ở 0.798 — đã đâm vào tường của aperture rộng 1.2.
 *
 * Với chuẩn của LivingNPC (trajectory A→B→C liên tục), đó là FALSE POSITIVE:
 * đúng loại lỗi mà observe_crossing sinh ra để ngăn.
 */

const base = (extra: Partial<CrossingOptions> = {}): CrossingOptions => ({
  approach: { x: 0, y: 64, z: 0 },
  exit: { x: 0, y: 64, z: 10 },
  entryClearance: 0.3,
  exitClearance: 0.3,
  verticalTolerance: 1,
  requiredExitSamples: 2,
  planeEpsilon: 0.1,
  corridorHalfWidth: 0.6,
  maxStepDistance: 1.75,
  exitDwellMs: 300,
  ...extra
})

/** Đi thẳng qua gate ở một lateral cố định; trả về observation cuối. */
const walkThrough = (options: CrossingOptions, lateral: number) => {
  const tracker = new CrossingTracker(options)
  let last = tracker.observe({ x: lateral, y: 64, z: 3 }, 0)
  for (const [z, t] of [[4.5, 200], [5.5, 400], [6.5, 600], [7.5, 800], [8.5, 1000]] as const) {
    last = tracker.observe({ x: lateral, y: 64, z }, t)
  }
  return last
}

test('DF-08: entityHalfWidth mặc định 0 — hành vi cũ giữ nguyên', () => {
  // Không đặt entityHalfWidth thì kết quả phải y hệt trước khi sửa, nếu không
  // mọi evidence cũ đổi nghĩa trong im lặng.
  const observation = walkThrough(base(), 0.4982)
  assert.equal(observation.crossed, true)
  assert.equal(observation.withinCorridor, true)
})

test('DF-08: entityHalfWidth khiến NPC cạ tường bị TỪ CHỐI', () => {
  // Đây chính là ca LivingNPC báo. Thân rộng 0.6 → nửa 0.3.
  // |0.4982| + 0.3 = 0.798 > 0.6 → phải fail.
  const observation = walkThrough(base({ entityHalfWidth: 0.3 }), 0.4982)
  assert.equal(observation.withinCorridor, false, 'thân NPC vượt aperture')
  assert.equal(observation.crossed, false, 'cạ tường không được tính là đã qua gate')
})

test('DF-08: đi giữa hành lang vẫn PASS khi bật entityHalfWidth', () => {
  // Không được biến thành assertion không bao giờ đạt: đi đúng tâm phải qua.
  const observation = walkThrough(base({ entityHalfWidth: 0.3 }), 0.05)
  assert.equal(observation.crossed, true)
  assert.equal(observation.withinCorridor, true)
})

test('DF-08: observation nêu lateralClearance để đọc lại evidence thấy được biên', () => {
  // Chính con số này lẽ ra phải khiến DF-08 lộ ra sớm hơn: nó cho biết còn cách
  // tường bao nhiêu, thay vì chỉ một boolean pass/fail.
  const tight = walkThrough(base({ entityHalfWidth: 0.3 }), 0.4982)
  assert.ok(tight.lateralClearance !== undefined)
  // 0.6 - (0.4982 + 0.3) = -0.1982 → âm nghĩa là đã đâm vào tường.
  assert.ok(tight.lateralClearance < 0, 'clearance âm = thân vượt aperture')

  const roomy = walkThrough(base({ entityHalfWidth: 0.3 }), 0)
  assert.ok(Math.abs(roomy.lateralClearance - 0.3) < 1e-9)
})

test('DF-08: entityHalfWidth >= corridorHalfWidth bị chặn ngay lúc dựng tracker', () => {
  // Thân không bao giờ lọt thì mọi run đều fail — đó là lỗi cấu hình, phải báo
  // ngay chứ không để chạy xong rồi mới thấy fail khó hiểu.
  assert.throws(() => new CrossingTracker(base({ entityHalfWidth: 0.6 })))
  assert.throws(() => new CrossingTracker(base({ entityHalfWidth: -0.1 })))
})
