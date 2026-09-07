import assert from 'node:assert/strict'
import test from 'node:test'
import { scenarioSchema } from '../src/scenario.js'

const parse = (steps: unknown[]) => scenarioSchema.parse({
  name: 'round2-schema', maxDurationMs: 900_000, steps
})

test('R2: group phải tồn tại trong pattern của capture và assert_capture', () => {
  assert.throws(() => parse([
    { id: 'c', action: 'capture', name: 'code', pattern: '(x)', group: 3 }
  ]), /group/)
  assert.throws(() => parse([
    { id: 'c', action: 'capture', name: 'code', pattern: '(x)' },
    { id: 'a', action: 'assert_capture', name: 'code', pattern: '(x)', group: 3 }
  ]), /group/)
})

test('R2: duration vượt step timeout bị chặn ngay, kể cả timeout mặc định', () => {
  for (const step of [
    { action: 'wait', durationMs: 600_000 },
    { action: 'wait', durationMs: 1000, timeoutMs: 500 },
    { action: 'wait_for_text', notText: 'error', durationMs: 1000, timeoutMs: 500 }
  ]) assert.throws(() => parse([{ id: 'wait', ...step }]), /timeoutMs/)
  assert.doesNotThrow(() => parse([
    { id: 'wait', action: 'wait', durationMs: 600_000, timeoutMs: 660_000 }
  ]))
})

test('R2 H1: observation window phải kết thúc trước step timeout', () => {
  assert.throws(() => parse([{
    id: 'absence', action: 'wait_for_text', notText: 'error', durationMs: 30_000
  }]), /timeoutMs/)
  assert.doesNotThrow(() => parse([{
    id: 'absence', action: 'wait_for_text', notText: 'error', durationMs: 100, timeoutMs: 1_000
  }]))
})

test('R2 L1: pin UUID không thể yêu cầu ít nhất hai entity', () => {
  assert.throws(() => parse([{
    id: 'pin', action: 'assert_nearby_entity', nameIncludes: 'villager',
    requiredUuid: '11111111-1111-4111-8111-111111111111', minimum: 2
  }]), /single entity/)
})

test('R3-01: count upper bound timeout phải vượt dwell cộng poll margin', () => {
  for (const count of [{ exactly: 1 }, { maximum: 1 }]) {
    for (const timeoutMs of [150, 200, 250, 300]) {
      assert.throws(() => parse([{ id: 'count', action: 'assert_nearby_entity',
        nameIncludes: 'item', ...count, timeoutMs }]), /timeoutMs/)
    }
    assert.doesNotThrow(() => parse([{ id: 'count', action: 'assert_nearby_entity',
      nameIncludes: 'item', ...count, timeoutMs: 1000 }]))
  }
})
