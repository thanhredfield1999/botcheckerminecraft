import assert from 'node:assert/strict'
import test from 'node:test'
import { CrossingTracker } from '../src/crossing.js'

const options = {
  approach: { x: 48.5, y: 64, z: -17.5 },
  exit: { x: 49.5, y: 64, z: -15.5 },
  entryClearance: 0.3,
  exitClearance: 0.3,
  verticalTolerance: 1,
  requiredExitSamples: 2,
  planeEpsilon: 0.1,
  corridorHalfWidth: 0.75,
  maxStepDistance: 1.75,
  exitDwellMs: 200
}

test('crossing đòi segment qua đúng aperture và dwell ổn định phía exit', () => {
  const tracker = new CrossingTracker(options)

  assert.equal(tracker.observe({ x: 48.5, y: 64, z: -17.5 }, 0).crossed, false)
  assert.equal(tracker.observe({ x: 48.9, y: 64, z: -16.7 }, 100).crossed, false)
  assert.equal(tracker.observe({ x: 49.05, y: 64, z: -16.4 }, 200).crossed, false)
  assert.equal(tracker.observe({ x: 49.2, y: 64, z: -16.1 }, 300).crossed, false)
  assert.equal(tracker.observe({ x: 49.22, y: 64, z: -16.08 }, 400).crossed, false)
  const proof = tracker.observe({ x: 49.22, y: 64, z: -16.08 }, 500)

  assert.equal(proof.crossed, true)
  assert.equal(proof.entryObserved, true)
  assert.equal(proof.crossingObserved, true)
  assert.equal(proof.exitConfirmations, 3)
  assert.equal(proof.exitDwellMs, 200)
})

test('crossing chậm qua deadband vẫn tạo proof khi chuỗi liên tục hợp lệ', () => {
  const tracker = new CrossingTracker({
    ...options,
    approach: { x: -1, y: 64, z: 0 },
    exit: { x: 1, y: 64, z: 0 },
    requiredExitSamples: 1,
    exitDwellMs: 0
  })

  tracker.observe({ x: -1, y: 64, z: 0 }, 0)
  tracker.observe({ x: -0.2, y: 64, z: 0 }, 100)
  tracker.observe({ x: -0.05, y: 64, z: 0 }, 200)
  tracker.observe({ x: 0.05, y: 64, z: 0 }, 300)
  tracker.observe({ x: 0.2, y: 64, z: 0 }, 400)
  const proof = tracker.observe({ x: 0.5, y: 64, z: 0 }, 500)

  assert.equal(proof.crossed, true)
  assert.equal(proof.entryObserved, true)
  assert.equal(proof.crossingObserved, true)
})

test('event geometry không tự tăng exit confirmations trước poll', () => {
  const tracker = new CrossingTracker({
    ...options,
    approach: { x: -1, y: 64, z: 0 },
    exit: { x: 1, y: 64, z: 0 },
    requiredExitSamples: 2,
    exitDwellMs: 0
  })

  tracker.observe({ x: -1, y: 64, z: 0 }, 0)
  const eventCrossing = tracker.observe({ x: 0.5, y: 64, z: 0 }, 100, false)
  const duplicateEvent = tracker.observe({ x: 0.5, y: 64, z: 0 }, 110, false)
  const firstPoll = tracker.observe({ x: 0.5, y: 64, z: 0 }, 200)
  const secondPoll = tracker.observe({ x: 0.5, y: 64, z: 0 }, 300)

  assert.equal(eventCrossing.crossingObserved, true)
  assert.equal(eventCrossing.exitConfirmations, 0)
  assert.equal(duplicateEvent.exitConfirmations, 0)
  assert.equal(firstPoll.exitConfirmations, 1)
  assert.equal(firstPoll.crossed, false)
  assert.equal(secondPoll.exitConfirmations, 2)
  assert.equal(secondPoll.crossed, true)
})

test('xuất hiện bên trong deadband không đủ để arm crossing', () => {
  const tracker = new CrossingTracker({
    ...options,
    approach: { x: -1, y: 64, z: 0 },
    exit: { x: 1, y: 64, z: 0 },
    entryClearance: 0,
    requiredExitSamples: 1,
    exitDwellMs: 0
  })

  tracker.observe({ x: -0.05, y: 64, z: 0 }, 0)
  tracker.observe({ x: 0.05, y: 64, z: 0 }, 100)
  const exit = tracker.observe({ x: 0.5, y: 64, z: 0 }, 200)

  assert.equal(exit.entryObserved, false)
  assert.equal(exit.crossingObserved, false)
  assert.equal(exit.crossed, false)
})

test('proximity và xuất hiện thẳng phía thoát không tạo crossing proof', () => {
  const tracker = new CrossingTracker(options)

  assert.equal(tracker.observe({ x: 49.5, y: 64, z: -15.5 }, 0).crossed, false)
  assert.equal(tracker.observe({ x: 49.5, y: 64, z: -15.5 }, 300).crossed, false)
  assert.equal(tracker.observe({ x: 48.4822, y: 64, z: -17.3 }, 400).crossed, false)
})

test('mẫu quay lại giữa mặt phẳng reset chuỗi xác nhận phía thoát', () => {
  const tracker = new CrossingTracker(options)

  tracker.observe({ x: 48.5, y: 64, z: -17.5 }, 0)
  tracker.observe({ x: 48.9, y: 64, z: -16.7 }, 100)
  tracker.observe({ x: 49.05, y: 64, z: -16.4 }, 200)
  tracker.observe({ x: 49.2, y: 64, z: -16.1 }, 300)
  tracker.observe({ x: 49.0, y: 64, z: -16.5 }, 400)

  assert.equal(tracker.observe({ x: 49.2, y: 64, z: -16.1 }, 500).crossed, false)
})

test('quay lại dải mặt phẳng sau crossing làm mất proof cũ', () => {
  const tracker = new CrossingTracker(options)

  tracker.observe({ x: 48.5, y: 64, z: -17.5 }, 0)
  tracker.observe({ x: 48.9, y: 64, z: -16.7 }, 100)
  tracker.observe({ x: 49.05, y: 64, z: -16.4 }, 200)
  tracker.observe({ x: 49.2, y: 64, z: -16.1 }, 300)
  const backtrack = tracker.observe({ x: 49.0, y: 64, z: -16.5 }, 400)

  assert.equal(backtrack.crossingObserved, false)
  assert.equal(tracker.observe({ x: 49.2, y: 64, z: -16.1 }, 700).crossed, false)
})

test('proof đã mất không tái dùng entry cũ khi crossing lại từ mặt phẳng', () => {
  const tracker = new CrossingTracker({
    ...options,
    approach: { x: -1, y: 64, z: 0 },
    exit: { x: 1, y: 64, z: 0 },
    requiredExitSamples: 1,
    exitDwellMs: 0
  })

  tracker.observe({ x: -1, y: 64, z: 0 }, 0)
  tracker.observe({ x: -0.05, y: 64, z: 0 }, 100)
  tracker.observe({ x: 0.05, y: 64, z: 0 }, 200)
  const backtrack = tracker.observe({ x: 0, y: 64, z: 0 }, 300)
  const recrossWithoutEntry = tracker.observe({ x: 0.5, y: 64, z: 0 }, 400)

  assert.equal(backtrack.crossingObserved, false)
  assert.equal(recrossWithoutEntry.entryObserved, false)
  assert.equal(recrossWithoutEntry.crossingObserved, false)
  assert.equal(recrossWithoutEntry.crossed, false)
})

test('quay lại entry clearance sau proof cũ cho phép arm crossing mới', () => {
  const tracker = new CrossingTracker({
    ...options,
    approach: { x: -1, y: 64, z: 0 },
    exit: { x: 1, y: 64, z: 0 },
    requiredExitSamples: 1,
    exitDwellMs: 0
  })

  tracker.observe({ x: -1, y: 64, z: 0 }, 0)
  tracker.observe({ x: 0.05, y: 64, z: 0 }, 100)
  tracker.observe({ x: -0.5, y: 64, z: 0 }, 200)
  tracker.observe({ x: -0.05, y: 64, z: 0 }, 300)
  tracker.observe({ x: 0.05, y: 64, z: 0 }, 400)
  const secondCrossing = tracker.observe({ x: 0.5, y: 64, z: 0 }, 500)

  assert.equal(secondCrossing.entryObserved, true)
  assert.equal(secondCrossing.crossingObserved, true)
  assert.equal(secondCrossing.crossed, true)
})

test('rời corridor sau crossing làm mất proof trước khi dwell exit', () => {
  const tracker = new CrossingTracker({
    ...options,
    approach: { x: -1, y: 64, z: 0 },
    exit: { x: 1, y: 64, z: 0 },
    requiredExitSamples: 2,
    exitDwellMs: 100
  })

  tracker.observe({ x: -1, y: 64, z: 0 }, 0)
  tracker.observe({ x: -0.05, y: 64, z: 0 }, 100)
  tracker.observe({ x: 0.05, y: 64, z: 0 }, 200)
  const outside = tracker.observe({ x: 0.1, y: 64, z: 1 }, 300)
  tracker.observe({ x: 0.5, y: 64, z: 0 }, 400)
  const dwellWithoutContinuousProof = tracker.observe({ x: 0.5, y: 64, z: 0 }, 500)

  assert.equal(outside.withinCorridor, false)
  assert.equal(outside.entryObserved, false)
  assert.equal(outside.crossingObserved, false)
  assert.equal(dwellWithoutContinuousProof.crossed, false)
})

test('cú nhảy lớn qua mặt phẳng bị đánh dấu discontinuity và không thể pass', () => {
  const tracker = new CrossingTracker(options)

  tracker.observe({ x: 48.5, y: 64, z: -17.5 }, 0)
  const jump = tracker.observe({ x: 49.5, y: 64, z: -15.5 }, 100)

  assert.equal(jump.discontinuityDetected, true)
  assert.equal(jump.crossed, false)
  assert.equal(tracker.observe({ x: 49.5, y: 64, z: -15.5 }, 500).crossed, false)
})

test('segment đổi phía ngoài bề rộng lối đi không tạo crossing proof', () => {
  const tracker = new CrossingTracker({ ...options, maxStepDistance: 3 })

  tracker.observe({ x: 46.711, y: 64, z: -16.606 }, 0)
  const outside = tracker.observe({ x: 47.711, y: 64, z: -14.606 }, 100)

  assert.equal(outside.crossingObserved, false)
  assert.equal(outside.withinCorridor, false)
  assert.equal(tracker.observe({ x: 47.711, y: 64, z: -14.606 }, 500).crossed, false)
})

test('segment chỉ cắt aperture nhưng hai mẫu biên ở ngoài corridor không hợp lệ', () => {
  const tracker = new CrossingTracker({
    ...options,
    approach: { x: -1, y: 64, z: 0 },
    exit: { x: 1, y: 64, z: 0 },
    corridorHalfWidth: 0.5,
    maxStepDistance: 5
  })

  tracker.observe({ x: -1, y: 64, z: 0 }, 0)
  tracker.observe({ x: -0.2, y: 64, z: -1 }, 100)
  const cutThrough = tracker.observe({ x: 0.2, y: 64, z: 1 }, 200)

  assert.equal(cutThrough.crossingObserved, false)
})

test('rời aperture trước crossing buộc phải quan sát lại entry clearance', () => {
  const tracker = new CrossingTracker({
    ...options,
    approach: { x: -1, y: 64, z: 0 },
    exit: { x: 1, y: 64, z: 0 },
    corridorHalfWidth: 0.5
  })

  tracker.observe({ x: -1, y: 64, z: 0 }, 0)
  tracker.observe({ x: -0.4, y: 64, z: 0.8 }, 100)
  tracker.observe({ x: -0.1, y: 64, z: 0 }, 200)
  const crossedWithoutNewEntry = tracker.observe({ x: 0.2, y: 64, z: 0 }, 300)

  assert.equal(crossedWithoutNewEntry.entryObserved, false)
  assert.equal(crossedWithoutNewEntry.crossingObserved, false)
})

test('tracker phòng thủ trước geometry không hữu hạn hoặc không đủ clearance', () => {
  assert.throws(() => new CrossingTracker({
    ...options,
    approach: { x: -1e308, y: 64, z: 0 },
    exit: { x: 1e308, y: 64, z: 0 }
  }), /geometry|hữu hạn/i)
  assert.throws(() => new CrossingTracker({
    ...options,
    approach: { x: -0.1, y: 64, z: 0 },
    exit: { x: 0.1, y: 64, z: 0 },
    entryClearance: 0.3,
    exitClearance: 0.3
  }), /clearance/i)
})
