import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = 'E:/AI.WORK/botcheckerminecraft-botchecker'
const load = rel => import(pathToFileURL(path.join(root, rel)).href)
const { TestRun } = await load('dist/src/runner.js')
const { scenarioSchema } = await load('dist/src/scenario.js')
const { pinUniqueEntity, validateUniquePinnedEntity } = await load('dist/src/entity-observer.js')
const { itemSearchText } = await load('dist/src/snapshot.js')
const { Vec3 } = await load('node_modules/vec3/wrapper.mjs')

class OfflineBot extends EventEmitter {
  currentWindow = null
  entity = { position: new Vec3(0, 64, 0) }
  entities = { one: { id: 1, uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Dân làng'.normalize('NFD'), position: new Vec3(1, 64, 0) } }
  health = 20
  food = 20
  version = '1.21.11'
  protocolVersion = '774'
  game = { dimension: 'minecraft:overworld' }
  pathfinder = { stop() {}, setMovements() {} }
  inventory = { slots: [], selectedItem: null, items: () => [], inventoryStart: 9, inventoryEnd: 45 }
  supportFeature() { return false }
  loadPlugin() {}
  quit() { queueMicrotask(() => this.emit('end', 'offline smoke finished')) }
}

const scenario = scenarioSchema.parse({ name: 'compiled-nfc-count-smoke', maxDurationMs: 5000,
  steps: [{ id: 'count', action: 'assert_nearby_entity', nameIncludes: 'DÂN LÀNG', exactly: 1,
    requiredUuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', timeoutMs: 1200 }] })
const dir = await mkdtemp(path.join(tmpdir(), 'bc-r3-built-smoke-'))
try {
  const bot = new OfflineBot()
  const run = new TestRun(scenario, { host: 'localhost', port: 25565, username: 'offline-fixture', auth: 'offline' }, dir,
    { createBot: () => bot, prepareNavigation() {}, connectTimeoutMs: 1000, disconnectTimeoutMs: 100 })
  const started = run.start()
  bot.emit('spawn')
  await started
  const report = run.report()
  assert.equal(report.verdict, 'PASS')
  assert.equal(report.manifest.runner.version, '0.2.0')
  assert.equal(report.steps[0].evidence.count, 1)
  assert.ok(report.steps[0].evidence.stableSamples >= 3)
  assert.ok(report.steps[0].evidence.stableMs >= 200)
  assert.equal(report.steps[0].evidence.serverConfirmed, false)
  const pin = pinUniqueEntity(Object.values(bot.entities), bot.entity.position, 'dân làng', 8, true, bot.entities.one.uuid)
  assert.equal(validateUniquePinnedEntity(Object.values(bot.entities), bot.entity.position,
    'DÂN LÀNG', 8, pin.identity, pin.entity, bot.entities.one.uuid), pin.entity)
  assert.ok(itemSearchText({ slot: 9, material: 'paper', displayName: 'J\u030Cade', count: 1, lore: [] }).includes('\u01F0ade'))
  assert.throws(() => scenarioSchema.parse({ name: 'too-short', steps: [{ id: 'bad', action: 'assert_nearby_entity', nameIncludes: 'x', exactly: 1, timeoutMs: 300 }] }))
  const bundle = JSON.parse(await readFile(path.join(dir, `${run.id}.bundle.json`), 'utf8'))
  assert.ok(bundle)
  console.log(JSON.stringify({ artifact: 'dist/src/*.js', verdict: report.verdict, version: report.manifest.runner.version,
    count: report.steps[0].evidence.count, stableSamples: report.steps[0].evidence.stableSamples,
    stableMs: report.steps[0].evidence.stableMs, persistedBundle: true,
    runtimeLayer: 'offline injected protocol; no socket/Paper', serverConfirmed: false }))
} finally {
  await rm(dir, { recursive: true, force: true })
}
