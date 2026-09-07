import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { scenarioSchema } from '../src/scenario.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * DF-03 (dogfooding 2026-09-07). ItemGuard:
 *
 *   "NO-GO: BotChecker khong co action `drop_item`. Buoc nay chi chay duoc neu
 *    fixture tu them mot command drop rieng — tuc la phai sua san pham cho harness."
 *
 * Câu cuối là lời phê bình đúng chỗ: bắt sản phẩm thêm command chỉ để test được
 * là làm hỏng thứ đang test. Drop/pickup lại là bề mặt dupe cổ điển nhất của
 * Minecraft, nên thiếu nó khiến cả mảng anti-dupe không tự động hoá được.
 *
 * Cố ý KHÔNG làm `drag`: kéo-thả cần window click packet với `stateId` và cursor
 * state, sai một nhịp là desync im lặng — evidence sai còn tệ hơn không có.
 */

const scenario = (step: Record<string, unknown>) => scenarioSchema.parse({
  name: 'df03', maxDurationMs: 60_000,
  steps: [{ id: 's1', action: 'drop_item', itemIncludes: 'sword', ...step }]
})

test('DF-03: drop_item tồn tại và mặc định thả cả stack', () => {
  const parsed = scenario({})
  const step = parsed.steps[0] as { action: string, count?: number }
  assert.equal(step.action, 'drop_item')
  // Không nêu count = thả trọn stack; đó là hành vi người dùng mong đợi nhất
  // và cũng là cách tái hiện dupe drop/pickup kinh điển.
  assert.equal(step.count, undefined)
})

test('DF-03: drop_item nhận count để thả một phần stack', () => {
  const step = scenario({ count: 1 }).steps[0] as { count?: number }
  assert.equal(step.count, 1)
  // count: 0 vô nghĩa — thả 0 item không phải một hành động.
  assert.throws(() => scenario({ count: 0 }))
  assert.throws(() => scenario({ count: -1 }))
})

test('DF-03: source guard gọi API clickWindow cho drop', async () => {
  const source = await readFile(path.join(root, 'src/runner.ts'), 'utf8')
  const block = source.slice(source.indexOf("case 'drop_item'"), source.indexOf("case 'capture'"))

  // Structural guard only; packet behavior is exercised by round2-behavior.
  assert.match(block, /bot\.clickWindow\(slot, wholeStack \? 1 : 0, 4\)/)
  assert.doesNotMatch(block, /bot\.tossStack|bot\.transfer|bot\.toss\(/)

  // Phải fail rõ khi không có item, thay vì lặng lẽ không làm gì rồi báo pass.
  assert.match(block, /Inventory item not found/)

  // Evidence phải nêu đã thả bao nhiêu và còn lại bao nhiêu — nếu không thì
  // không kiểm chứng được kết quả drop khi đọc lại report.
  assert.match(block, /dropped/)
  assert.match(block, /remaining/)
})

test('DF-03: drop_item nằm trong scenario schema', async () => {
  // Action mới mà không khai báo capability thì manifest nói dối về những gì
  // harness làm được.
  const source = await readFile(path.join(root, 'src/scenario.ts'), 'utf8')
  assert.match(source, /literal\('drop_item'\)/)
})
