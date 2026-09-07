import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { scenarioSchema } from '../src/scenario.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Bản 0.2.0 là mốc các dự án khác căn theo. File này khoá hợp đồng đó: version
 * đồng bộ giữa Node và Gradle, CHANGELOG có mục tương ứng, và mọi action/field
 * mà CHANGELOG hứa đều thật sự parse được.
 *
 * Không có nó, "chốt version" chỉ là một con số trong package.json.
 */

const VERSION = '0.2.0'

test('version đồng bộ giữa package.json, Gradle và CHANGELOG', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.version, VERSION)
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
  assert.equal(lock.version, VERSION)
  assert.equal(lock.packages[''].version, VERSION)

  // Adapter và companion phải cùng version, nếu không JAR phát hành ra sẽ mâu
  // thuẫn với API Node mà nó phục vụ.
  const gradle = await readFile(
    path.join(root, 'paper-bukkit-adapter/build.gradle.kts'), 'utf8')
  assert.match(gradle, new RegExp(`version = "${VERSION.replace(/\./g, '\\.')}-SNAPSHOT"`))
  const companion = await readFile(
    path.join(root, 'paper-bukkit-adapter/keystore-companion/build.gradle.kts'), 'utf8')
  assert.match(companion, /version = rootProject\.version/,
    'companion phải kế thừa version của adapter, không hard-code')

  const changelog = await readFile(path.join(root, 'CHANGELOG.md'), 'utf8')
  assert.match(changelog, new RegExp(`^## ${VERSION.replace(/\./g, '\\.')} — `, 'm'))
})

test('mọi action CHANGELOG 0.2.0 hứa đều parse được', () => {
  const steps = [
    { id: 'a', action: 'capture', name: 'code', pattern: 'Ma so:\\s*(\\w+)' },
    { id: 'b', action: 'drop_item', itemIncludes: 'sword' },
    { id: 'c', action: 'assert_inventory', itemIncludes: 'sword', exactly: 1 },
    { id: 'd', action: 'assert_inventory', itemIncludes: 'gem', maximum: 0 },
    { id: 'e', action: 'assert_nearby_entity', nameIncludes: 'item', exactly: 2 },
    { id: 'f', action: 'wait_for_text', notText: 'Loi', durationMs: 3000 },
    { id: 'g', action: 'wait_for_text', allOf: ['xong'] },
    { id: 'h', action: 'assert_capture', name: 'code', pattern: 'Ma so:\\s*(\\w+)', equals: false },
    { id: 'i', action: 'wait', durationMs: 600_000, timeoutMs: 660_000 }
  ]
  const parsed = scenarioSchema.parse({
    name: 'contract-0-2-0', maxDurationMs: 3_600_000, steps
  })
  assert.equal(parsed.steps.length, steps.length)
})

test('observe_crossing nhận entityHalfWidth ở cả hai nơi dùng CrossingTracker', () => {
  // observe_crossing
  const crossing = scenarioSchema.parse({
    name: 'c', maxDurationMs: 60_000,
    steps: [{
      id: 's1', action: 'observe_crossing', nameIncludes: 'npc',
      approach: { x: 0, y: 64, z: 0 }, exit: { x: 0, y: 64, z: 4 },
      entityHalfWidth: 0.3
    }]
  })
  assert.equal((crossing.steps[0] as { entityHalfWidth: number }).entityHalfWidth, 0.3)

  // gate của observe_route — dùng chung tracker, sửa một chỗ là chưa đủ.
  const route = scenarioSchema.parse({
    name: 'r', maxDurationMs: 60_000,
    steps: [{
      id: 's1', action: 'observe_route', nameIncludes: 'npc',
      targetUuid: '00000000-0000-4000-8000-000000000000',
      checkpoints: [
        { id: 'p0', position: { x: 0, y: 64, z: 0 }, radius: 2 },
        { id: 'p1', position: { x: 0, y: 64, z: 8 }, radius: 2 }
      ],
      gates: [{
        checkpointId: 'p1', block: { x: 0, y: 64, z: 4 },
        approach: { x: 0, y: 64, z: 2 }, exit: { x: 0, y: 64, z: 6 },
        entityHalfWidth: 0.3
      }]
    }]
  })
  const gates = (route.steps[0] as { gates: { entityHalfWidth: number }[] }).gates
  assert.equal(gates[0].entityHalfWidth, 0.3)
})

test('mặc định 0.1.0 được giữ nguyên — scenario cũ không đổi nghĩa', () => {
  const legacy = scenarioSchema.parse({
    name: 'legacy', maxDurationMs: 900_000,
    steps: [
      { id: 's1', action: 'assert_inventory', itemIncludes: 'sword' },
      { id: 's2', action: 'assert_nearby_entity', nameIncludes: 'villager' },
      { id: 's3', action: 'observe_crossing', nameIncludes: 'npc',
        approach: { x: 0, y: 64, z: 0 }, exit: { x: 0, y: 64, z: 4 } }
    ]
  })
  assert.equal((legacy.steps[0] as { minimum?: number }).minimum, 1)
  assert.equal((legacy.steps[1] as { exactly?: number }).exactly, undefined)
  assert.equal((legacy.steps[2] as { entityHalfWidth: number }).entityHalfWidth, 0)
})
