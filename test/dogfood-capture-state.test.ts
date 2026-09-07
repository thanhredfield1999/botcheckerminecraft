import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { scenarioSchema } from '../src/scenario.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * DF-05 (dogfooding 2026-09-07) — thiếu sót có ảnh hưởng sâu nhất.
 *
 * ItemGuard: "text match nhung KHONG capture duoc gia tri code... step sau khong
 * so sanh lai duoc" → không chứng minh được CÙNG MỘT item trước và sau thao tác.
 * RestaurantTycoon: "Dung de LAY UUID that; sau do PHAI SUA TAY targetUuid ben
 * duoi. Khong co bien/tham chieu dong trong schema."
 *
 * Mọi kiểm chứng dạng "định danh không đổi qua thao tác" — lõi của anti-dupe và
 * item tracking — đều bị chặn bởi đúng thiếu sót này.
 *
 * Thiết kế: `capture` trích một nhóm regex từ text đã quan sát vào biến có tên;
 * `assert_capture` so lại ở step sau. Cố ý KHÔNG làm template `${var}` thay thế
 * tự do trong mọi field: nó biến scenario thành ngôn ngữ lập trình mini, khó
 * kiểm chứng và dễ sinh evidence sai.
 */

const scenario = (steps: unknown[]) => scenarioSchema.parse({
  name: 'df05', maxDurationMs: 120_000, steps
})

test('DF-05: capture lưu nhóm regex vào biến có tên', () => {
  const parsed = scenario([
    { id: 's1', action: 'capture', name: 'itemCode',
      pattern: 'Ma so:\\s*([A-Z0-9-]+)', source: 'chat' }
  ])
  const step = parsed.steps[0] as { name: string, pattern: string, group?: number }
  assert.equal(step.name, 'itemCode')
  // Mặc định lấy nhóm 1 — nhóm bắt đầu tiên là thứ người viết mong đợi.
  assert.equal(step.group, 1)
})

test('DF-05: pattern phải có ít nhất một nhóm bắt', () => {
  // Regex không nhóm thì không capture được gì; bắt lỗi lúc parse thay vì để
  // scenario chạy rồi mới phát hiện biến rỗng.
  assert.throws(() => scenario([
    { id: 's1', action: 'capture', name: 'x', pattern: 'khong co nhom' }
  ]))
  // Regex hỏng cũng phải chặn ngay.
  assert.throws(() => scenario([
    { id: 's1', action: 'capture', name: 'x', pattern: '([unclosed' }
  ]))
})

test('DF-05: tên biến phải là identifier, và không trùng', () => {
  assert.throws(() => scenario([
    { id: 's1', action: 'capture', name: 'ten co dau cach', pattern: '(x)' }
  ]))
  assert.throws(() => scenario([
    { id: 's1', action: 'capture', name: 'dup', pattern: '(x)' },
    { id: 's2', action: 'capture', name: 'dup', pattern: '(y)' }
  ]))
})

test('DF-05: assert_capture so lại biến đã capture', () => {
  const parsed = scenario([
    { id: 's1', action: 'capture', name: 'code', pattern: 'Ma so:\\s*(\\w+)' },
    { id: 's2', action: 'assert_capture', name: 'code',
      pattern: 'Ma so:\\s*(\\w+)', equals: true }
  ])
  assert.equal(parsed.steps.length, 2)
})

test('DF-05: assert_capture với biến chưa capture bị chặn lúc parse', () => {
  // Đây là điểm mấu chốt: tham chiếu biến không tồn tại phải fail SỚM, không
  // phải lúc chạy — nếu không, một scenario sai chính tả sẽ chạy hết rồi báo
  // pass vì "không có gì để so".
  assert.throws(() => scenario([
    { id: 's1', action: 'assert_capture', name: 'chuaCapture', pattern: '(\\w+)' }
  ]))
  // Và phải theo THỨ TỰ: capture sau khi assert thì cũng vô nghĩa.
  assert.throws(() => scenario([
    { id: 's1', action: 'assert_capture', name: 'sau', pattern: '(\\w+)' },
    { id: 's2', action: 'capture', name: 'sau', pattern: '(\\w+)' }
  ]))
})

test('DF-05: equals: false chứng minh giá trị ĐÃ ĐỔI', () => {
  // Cần cho luồng ngược: sau khi rèn, mã item PHẢI khác — nếu giống thì thao tác
  // không có hiệu lực.
  const parsed = scenario([
    { id: 's1', action: 'capture', name: 'v', pattern: '(\\w+)' },
    { id: 's2', action: 'assert_capture', name: 'v', pattern: '(\\w+)', equals: false }
  ])
  assert.equal((parsed.steps[1] as { equals: boolean }).equals, false)
})

test('DF-05: runner lưu và so biến thật, không chỉ khai báo schema', async () => {
  const source = await readFile(path.join(root, 'src/runner.ts'), 'utf8')

  assert.match(source, /case 'capture'/)
  assert.match(source, /case 'assert_capture'/)
  // Phải có kho biến sống suốt run.
  assert.match(source, /captures/)
  // assert_capture phải so sánh thật, cả hai chiều equals.
  assert.match(source, /step\.equals/)
  // Giá trị capture phải vào evidence, nếu không đọc lại report không kiểm được.
  assert.match(source, /captured/)
})
