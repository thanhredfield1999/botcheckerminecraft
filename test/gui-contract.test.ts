import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateGuiInteraction } from '../src/gui-contract.js'

test('GUI PASS khi title, item và click effect đúng', () => {
  const result = evaluateGuiInteraction({
    expectedTitle: 'Shop', expectedSlot: 13, expectedMaterial: 'minecraft:emerald', expectedClick: 'left',
    before: { title: 'Shop', slot: 13, material: 'minecraft:emerald', displayName: 'Buy', count: 1 },
    click: { performed: true, button: 'left' },
    after: { title: 'Shop', slot: 13, material: 'minecraft:emerald', displayName: 'Buy', count: 0 },
    evidence: { message: 'clicked' }
  })
  assert.equal(result.verdict, 'PASS')
})

test('GUI FAIL khi click sai slot hoặc material', () => {
  const result = evaluateGuiInteraction({ expectedTitle: 'Shop', expectedSlot: 13, expectedMaterial: 'minecraft:emerald', expectedClick: 'left', before: { title: 'Shop', slot: 12, material: 'minecraft:dirt', displayName: 'x', count: 1 }, click: { performed: true, button: 'left' }, after: { title: 'Shop', slot: 12, material: 'minecraft:dirt', displayName: 'x', count: 1 }, evidence: {} })
  assert.equal(result.verdict, 'FAIL')
})

test('GUI INCONCLUSIVE khi snapshot/click evidence thiếu', () => {
  const result = evaluateGuiInteraction({ expectedTitle: 'Shop', expectedSlot: 13, expectedMaterial: 'minecraft:emerald', expectedClick: 'left', before: undefined, click: undefined, after: undefined, evidence: {} })
  assert.equal(result.verdict, 'INCONCLUSIVE')
})

test('GUI reject credential-like title/evidence', () => {
  assert.throws(() => evaluateGuiInteraction({ expectedTitle: 'token shop', expectedSlot: 1, expectedMaterial: 'minecraft:stone', expectedClick: 'left', evidence: {} }), /credential/i)
})

void assert
