import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const adapterRoot = path.join(root, 'paper-bukkit-adapter')

test('adapter compile theo SÀN 1.21.11, không pin bản mới nhất', async () => {
  for (const file of [
    path.join(adapterRoot, 'build.gradle.kts'),
    path.join(adapterRoot, 'keystore-companion/build.gradle.kts')
  ]) {
    const build = await readFile(file, 'utf8')
    assert.match(build, /getOrElse\("1\.21\.11-R0\.1-SNAPSHOT"\)/,
      `${file} phải mặc định về sàn 1.21.11`)
    // Bytecode 21 là điều kiện để JAR chạy được trên 1.21.11 (Java 21). Paper 26.x
    // chạy Java 25 nhưng vẫn load bytecode 21; ngược lại thì không.
    assert.match(build, /JavaLanguageVersion\.of\(21\)/, `${file} phải giữ bytecode 21`)
    // Version phải override được để thử API khác mà không sửa file.
    assert.match(build, /gradleProperty\("paperApiVersion"\)/,
      `${file} phải cho override paperApiVersion`)
  }
})

test('plugin.yml khai báo đúng sàn 1.21.11, không phải exact-version pin', async () => {
  for (const file of [
    path.join(adapterRoot, 'src/main/resources/plugin.yml'),
    path.join(adapterRoot, 'keystore-companion/src/main/resources/plugin.yml')
  ]) {
    const yml = await readFile(file, 'utf8')
    assert.match(yml, /^api-version: '1\.21\.11'$/m,
      `${file} phải từ chối server thấp hơn sàn 1.21.11 đã công bố`)
  }
})

test('có gate kiểm chứng forward-compat, không chỉ giả định', async () => {
  const script = await readFile(
    path.join(root, 'scripts/verify-paper-forward-compat.mjs'), 'utf8')

  // Phải hỏi Maven bản mới nhất chứ không hard-code.
  assert.match(script, /maven-metadata\.xml/)
  assert.match(script, /<release>/)
  // Phải thực sự biên dịch lại, không chỉ so chuỗi version.
  assert.match(script, /javac/)
  assert.match(script, /'--release', '21'/)
  // Fail-closed: lỗi API là FAILED, hạ tầng thiếu là SKIPPED — không được lẫn.
  assert.match(script, /function fail\(/)
  assert.match(script, /function skip\(/)
  assert.match(script, /Forward compatibility is NOT verified/)

  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.scripts['verify:paper-forward-compat'],
    'node scripts/verify-paper-forward-compat.mjs')

  const workflow = await readFile(
    path.join(root, '.github/workflows/verification-gate.yml'), 'utf8')
  assert.match(workflow, /npm run verify:paper-forward-compat/,
    'CI phải chạy gate này, nếu không nó chỉ là script không ai gọi')
})
