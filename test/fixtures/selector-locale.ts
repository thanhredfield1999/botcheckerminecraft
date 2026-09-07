import assert from 'node:assert/strict'
import { TestRun } from '../../src/runner.js'
import { scenarioSchema } from '../../src/scenario.js'
import { pinUniqueEntity } from '../../src/entity-observer.js'

// Mô phỏng default locale trong subprocess; không sửa locale của máy người dùng.
const localeLowerCase = String.prototype.toLocaleLowerCase
String.prototype.toLocaleLowerCase = function (locales) {
  return localeLowerCase.call(this, locales ?? 'tr-TR')
}
const npc = { id: 1, uuid: 'id-1', name: 'IRON', position: { x: 0, y: 0, z: 0 } }
assert.equal(pinUniqueEntity([npc], npc.position, 'iron', 8, true).entity, npc)
const scenario = scenarioSchema.parse({ name: 'locale', steps: [
  { id: 'inventory', action: 'assert_inventory', itemIncludes: 'iron', exactly: 1 }
] })
const run = new TestRun(scenario, {
  host: 'localhost', port: 25565, username: 'offline-fixture', auth: 'offline'
}, '.')
run.bot = { currentWindow: null, inventory: { slots: [null,
  { name: 'IRON', displayName: 'IRON', count: 1 }], selectedItem: null } } as never
const seam = run as unknown as {
  executeStep(step: unknown, signal: AbortSignal, cursor: number): Promise<unknown>
}
await seam.executeStep(scenario.steps[0], new AbortController().signal, 0)
console.log('selector-locale: PASS')
