import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCompatibilityReport } from '../src/compatibility-report.js'
import { evaluateCompatibilityMatrix } from '../src/compatibility-matrix.js'

test('compatibility result chuyển thành manifest report bounded', () => {
  const matrix = evaluateCompatibilityMatrix({
    project: 'Plugin', fixture: 'fixture', targets: [{
      targetId: 'paper-1.21.11', minecraftVersion: '1.21.11', paperVersion: 'paper', expectedProtocol: '774',
      observed: { negotiatedVersion: '1.21.11', protocolVersion: '774', pluginPresent: true, scenarioPassed: true }
    }]
  })
  const report = buildCompatibilityReport(matrix)
  assert.equal(report.verdict, 'PASS')
  assert.equal(report.targets[0]?.targetId, 'paper-1.21.11')
  assert.equal('raw' in report, false)
})

test('compatibility report giữ INCONCLUSIVE và loại evidence không bounded', () => {
  const matrix = evaluateCompatibilityMatrix({
    project: 'Plugin', fixture: 'fixture', targets: [{ targetId: 'paper', minecraftVersion: '1.21.11', paperVersion: 'paper', expectedProtocol: '774' }]
  })
  const report = buildCompatibilityReport(matrix)
  assert.equal(report.verdict, 'INCONCLUSIVE')
  assert.equal(report.targets[0]?.evidence.expectedProtocol, '774')
})

void assert
