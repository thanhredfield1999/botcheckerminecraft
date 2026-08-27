import assert from 'node:assert/strict'
import test from 'node:test'
import { runCompatibilityMatrix } from '../src/compatibility-runner.js'

test('compatibility runner chạy target tuần tự và aggregate PASS', async () => {
  const order: string[] = []
  const result = await runCompatibilityMatrix({
    project: 'Plugin', fixture: 'paper',
    targets: [{ targetId: 'a', minecraftVersion: '1.21.11', paperVersion: 'paper', expectedProtocol: '774' }, { targetId: 'b', minecraftVersion: '1.21.11', paperVersion: 'paper', expectedProtocol: '774' }],
    observe: async target => { order.push(target.targetId); return { negotiatedVersion: target.minecraftVersion, protocolVersion: target.expectedProtocol, pluginPresent: true, scenarioPassed: true } }
  })
  assert.deepEqual(order, ['a', 'b'])
  assert.equal(result.verdict, 'PASS')
})

test('compatibility runner provider lỗi là INCONCLUSIVE, không giả PASS', async () => {
  const result = await runCompatibilityMatrix({
    project: 'Plugin', fixture: 'paper', targets: [{ targetId: 'a', minecraftVersion: '1.21.11', paperVersion: 'paper', expectedProtocol: '774' }],
    observe: async () => { throw new Error('target unavailable') }
  })
  assert.equal(result.verdict, 'INCONCLUSIVE')
})

void assert
