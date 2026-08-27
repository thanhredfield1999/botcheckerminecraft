import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateGuiInteraction } from '../src/gui-contract.js'
import { buildGuiReport } from '../src/gui-report.js'

test('GUI report giữ verdict và evidence bounded', () => {
  const result = evaluateGuiInteraction({
    expectedTitle: 'Shop', expectedSlot: 13, expectedMaterial: 'minecraft:emerald', expectedClick: 'left',
    before: { title: 'Shop', slot: 13, material: 'minecraft:emerald', displayName: 'Buy', count: 1 },
    click: { performed: true, button: 'left' },
    after: { title: 'Shop', slot: 13, material: 'minecraft:emerald', displayName: 'Buy', count: 0 }, evidence: {}
  })
  const report = buildGuiReport(result, 'Plugin', 'fixture')
  assert.equal(report.kind, 'gui')
  assert.equal(report.verdict, 'PASS')
  assert.equal('before' in report, false)
})

test('GUI report reject credential-like metadata', () => {
  const result = evaluateGuiInteraction({ expectedTitle: 'Shop', expectedSlot: 1, expectedMaterial: 'minecraft:stone', expectedClick: 'left', evidence: {}}
  )
  assert.throws(() => buildGuiReport({ ...result, evidence: { ...result.evidence, expectedTitle: 'token-shop' } }, 'Plugin', 'fixture'), /credential/i)
})

void assert
