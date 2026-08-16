import assert from 'node:assert/strict'
import test from 'node:test'
import { scenarioSchema } from '../src/scenario.js'

test('assert_gui yêu cầu hậu điều kiện nội dung cụ thể', () => {
  const valid = scenarioSchema.parse({
    name: 'GUI postcondition',
    steps: [{
      id: 'payment-ready', action: 'assert_gui',
      titleIncludes: 'Xác nhận thanh toán',
      items: [{ nameIncludes: 'Thanh toán', count: 1 }]
    }]
  })

  assert.deepEqual(valid.steps[0], {
    id: 'payment-ready', action: 'assert_gui', timeoutMs: 30_000, optional: false,
    titleIncludes: 'Xác nhận thanh toán',
    items: [{ nameIncludes: 'Thanh toán', count: 1 }]
  })
  assert.equal(scenarioSchema.safeParse({
    name: 'weak GUI assertion', steps: [{ id: 'gui', action: 'assert_gui' }]
  }).success, false)
})

test('assert_gui cho phép title-only, từ chối count-only', () => {
  assert.equal(scenarioSchema.safeParse({
    name: 'title-only GUI assertion',
    steps: [{ id: 'gui', action: 'assert_gui', titleIncludes: 'Menu' }]
  }).success, true)
  assert.equal(scenarioSchema.safeParse({
    name: 'count-only GUI assertion',
    steps: [{ id: 'gui', action: 'assert_gui', items: [{ count: 1 }] }]
  }).success, false)
})
