#!/usr/bin/env node
/**
 * Skip gate: chạy full test suite và fail khi coverage tụt xuống dưới sàn đã pin
 * cho đúng nền tảng hiện tại.
 *
 * Lý do tồn tại: mọi `skip:` trong repo này là điều kiện môi trường (Windows-only
 * observer, javac vắng mặt, host cấm symlink). Nếu môi trường CI thiếu công cụ, các
 * test đó im lặng biến mất và job vẫn xanh — nghĩa là "PASS" không còn nói lên điều
 * gì. Gate này biến sự im lặng đó thành lỗi.
 *
 * Sàn được pin theo quan sát thật, không phải ước lượng. Cập nhật khi thêm/bớt test.
 */

import { spawnSync } from 'node:child_process'

const FLOORS = {
  win32: {
    // Quan sát 2026-09-08 (round 3 trước hai low correction cuối): 878/872/0/6.
    minExecuted: 872,
    maxSkipped: 6,
    label: 'Windows (netstat/session-lock observers + javac interop chạy được)'
  },
  linux: {
    // Linux bỏ toàn bộ nhóm Windows-only (~23 test) nhưng PHẢI chạy javac interop.
    // Sàn thấp hơn Windows đúng phần đó, không thấp hơn nữa.
    minExecuted: 777,
    maxSkipped: 40,
    label: 'Linux (Windows-only observers skip; javac interop bắt buộc chạy)'
  },
  darwin: {
    minExecuted: 777,
    maxSkipped: 40,
    label: 'macOS (Windows-only observers skip; javac interop bắt buộc chạy)'
  }
}

const floor = FLOORS[process.platform]
if (!floor) {
  console.error(`Skip gate chưa pin sàn cho platform: ${process.platform}`)
  process.exit(1)
}

// Gọi thẳng test runner thay vì `npm test` qua shell: tránh shell-injection surface
// và giữ output counter ổn định trên mọi nền tảng. Cùng concurrency=2 với npm test:
// javac/process fixtures không được làm VM budget tests thiếu CPU trên host nhiều core.
const result = spawnSync(process.execPath, [
  '--import', 'tsx', '--test', '--test-concurrency=2', 'test/**/*.test.ts'
], {
  encoding: 'utf8',
  windowsHide: true,
  maxBuffer: 64 * 1024 * 1024
})

if (result.error) throw result.error
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`

function counter(name) {
  const match = output.match(new RegExp(`^\\u2139 ${name} (\\d+)$`, 'm'))
  if (!match) throw new Error(`Không đọc được counter '${name}' từ output test runner`)
  return Number(match[1])
}

const tests = counter('tests')
const pass = counter('pass')
const fail = counter('fail')
const skipped = counter('skipped')

console.log(`Platform: ${process.platform} — ${floor.label}`)
console.log(`tests=${tests} pass=${pass} fail=${fail} skipped=${skipped}`)
console.log(`Sàn: executed >= ${floor.minExecuted}, skipped <= ${floor.maxSkipped}`)

const problems = []
if (fail > 0) problems.push(`${fail} test FAIL`)
if (pass < floor.minExecuted) {
  problems.push(`chỉ ${pass} test chạy, dưới sàn ${floor.minExecuted} — có nhóm test biến mất im lặng`)
}
if (skipped > floor.maxSkipped) {
  problems.push(`${skipped} test bị skip, vượt trần ${floor.maxSkipped}`)
}

if (problems.length > 0) {
  console.error('\nSKIP GATE FAILED:')
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error('\nSkip reasons trong lần chạy này:')
  for (const line of output.split('\n')) {
    if (line.trimStart().startsWith('\uFE3B')) console.error(`  ${line.trim()}`)
  }
  process.exit(1)
}

console.log('\nSKIP GATE PASSED')
