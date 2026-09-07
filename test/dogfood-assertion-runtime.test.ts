import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Schema chấp nhận một field mà runner không đọc thì field đó là trang trí, và
 * còn tệ hơn không có: người viết scenario tin là đã assert trong khi thực tế
 * không có gì được kiểm. File này chỉ kiểm cấu trúc source, KHÔNG chứng minh
 * runtime. Behavior nằm ở dogfood-round2-behavior và dogfood-consumer-contracts.
 */

test('DF-01: runner thực thi exactly và maximum, không chỉ minimum', async () => {
  const source = await readFile(path.join(root, 'src/runner.ts'), 'utf8')
  const block = source.slice(
    source.indexOf("case 'assert_inventory'"),
    source.indexOf("case 'assert_state'"))

  assert.match(block, /step\.exactly !== undefined && count !== step\.exactly/,
    'exactly phải so sánh bằng, không phải >=')
  assert.match(block, /step\.maximum !== undefined && count > step\.maximum/,
    'maximum phải fail khi vượt — đây là thứ bắt được dupe')
  assert.match(block, /step\.minimum !== undefined && count < step\.minimum/)

  // Thông báo lỗi phải nêu cả kỳ vọng lẫn số quan sát được, nếu không evidence
  // không tự giải thích được khi đọc lại report.
  for (const pattern of [/Expected exactly \$\{step\.exactly\}/, /found \$\{count\}/]) {
    assert.match(block, pattern)
  }
})

test('DF-04: runner ĐẾM entity khi có ràng buộc số lượng', async () => {
  const source = await readFile(path.join(root, 'src/runner.ts'), 'utf8')
  const block = source.slice(
    source.indexOf("case 'assert_nearby_entity'"),
    source.indexOf("case 'inspect_entities'"))

  // Điểm mấu chốt: phải lọc TOÀN BỘ entities rồi đếm. Dùng nearestEntity thì
  // "còn 1" và "còn 2" cho cùng kết quả — đúng lỗi ItemGuard báo.
  assert.match(block, /\.filter\(candidate =>/, 'phải lọc toàn bộ entities')
  assert.match(block, /const count = found\.length/)
  assert.match(block, /step\.exactly === undefined \|\| count === step\.exactly/)
  assert.match(block, /step\.maximum === undefined \|\| count <= step\.maximum/)

  // Đường cũ (không ràng buộc số lượng) phải còn nguyên để không phá scenario cũ.
  assert.match(block, /this\.nearestEntity\(step\.nameIncludes, step\.maxDistance\)/)
})

test('DF-02: runner xử lý notText theo ngữ nghĩa vắng mặt', async () => {
  const source = await readFile(path.join(root, 'src/runner.ts'), 'utf8')
  const block = source.slice(
    source.indexOf("case 'wait_for_text'"),
    source.indexOf("case 'wait_for_gui'"))

  // Sai lầm dễ mắc: dùng poll() như nhánh positive. poll() trả về ngay khi
  // predicate đúng, nên "chưa thấy" sẽ pass tức thì ở ms đầu tiên — assertion
  // trở thành vô nghĩa. Phải chờ hết cửa sổ.
  assert.match(block, /const deadline = Date\.now\(\) \+ step\.durationMs!/)
  assert.match(block, /while \(Date\.now\(\) < deadline\)/)
  assert.match(block, /Forbidden text observed/, 'thấy text giữa chừng phải fail ngay')
  assert.match(block, /return \{ absentFor: step\.durationMs/)

  // Nhánh positive giữ nguyên.
  assert.match(block, /const predicates = \(step\.allOf \?\? \[step\.text!\]\)/)
})

test('DF-01/DF-04: mặc định cũ được giữ — scenario cũ không đổi nghĩa', async () => {
  const { scenarioSchema } = await import('../src/scenario.js')

  // Không nêu ràng buộc nào thì vẫn là minimum: 1 như trước, nếu không mọi
  // scenario cũ sẽ im lặng đổi thành "không assert gì".
  const parsed = scenarioSchema.parse({
    name: 'legacy', maxDurationMs: 60_000,
    steps: [{ id: 's1', action: 'assert_inventory', itemIncludes: 'sword' }] })
  assert.equal((parsed.steps[0] as { minimum?: number }).minimum, 1)

  // assert_nearby_entity không ràng buộc số lượng thì vẫn là "tồn tại ít nhất 1".
  const entity = scenarioSchema.parse({
    name: 'legacy', maxDurationMs: 60_000,
    steps: [{ id: 's1', action: 'assert_nearby_entity', nameIncludes: 'villager' }] })
  const step = entity.steps[0] as { exactly?: number, minimum?: number, maximum?: number }
  assert.equal(step.exactly, undefined)
  assert.equal(step.minimum, undefined)
  assert.equal(step.maximum, undefined)
})
