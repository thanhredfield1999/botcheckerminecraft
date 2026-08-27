import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateCompatibilityMatrix } from '../src/compatibility-matrix.js'

test('compatibility matrix PASS khi mọi target observed đúng contract', () => {
  const result = evaluateCompatibilityMatrix({
    project: 'Plugin', fixture: 'paper-fixture', targets: [
      { targetId: 'paper-1.21.11', minecraftVersion: '1.21.11', paperVersion: '1.21.11-R0.1-SNAPSHOT', expectedProtocol: '774', observed: { negotiatedVersion: '1.21.11', protocolVersion: '774', pluginPresent: true, scenarioPassed: true } }
    ]
  })
  assert.equal(result.verdict, 'PASS')
  assert.deepEqual(result.summary, { total: 1, pass: 1, fail: 0, inconclusive: 0 })
})

test('compatibility matrix FAIL khi handshake/plugin runtime sai expectation', () => {
  const result = evaluateCompatibilityMatrix({
    project: 'Plugin', fixture: 'paper-fixture', targets: [
      { targetId: 'paper-1.21.11', minecraftVersion: '1.21.11', paperVersion: 'paper', expectedProtocol: '774', observed: { negotiatedVersion: '1.21.10', protocolVersion: '773', pluginPresent: false, scenarioPassed: false } }
    ]
  })
  assert.equal(result.verdict, 'FAIL')
  assert.equal(result.targets[0]?.verdict, 'FAIL')
})

test('compatibility matrix INCONCLUSIVE khi thiếu observed evidence', () => {
  const result = evaluateCompatibilityMatrix({
    project: 'Plugin', fixture: 'paper-fixture', targets: [
      { targetId: 'paper-unknown', minecraftVersion: '1.21.11', paperVersion: 'paper', expectedProtocol: '774' }
    ]
  })
  assert.equal(result.verdict, 'INCONCLUSIVE')
  assert.equal(result.targets[0]?.verdict, 'INCONCLUSIVE')
})

test('compatibility matrix reject duplicate target, credential-like ID và unbounded matrix', () => {
  const base = { targetId: 'paper', minecraftVersion: '1.21.11', paperVersion: 'paper', expectedProtocol: '774', observed: { negotiatedVersion: '1.21.11', protocolVersion: '774', pluginPresent: true, scenarioPassed: true } }
  assert.throws(() => evaluateCompatibilityMatrix({ project: 'P', fixture: 'F', targets: [base, base] }), /duplicate/i)
  assert.throws(() => evaluateCompatibilityMatrix({ project: 'P', fixture: 'F', targets: [{ ...base, targetId: 'token-target' }] }), /credential/i)
})

void assert
