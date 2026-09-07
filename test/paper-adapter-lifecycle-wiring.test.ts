import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const adapterRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'paper-bukkit-adapter')
const javaRoot = path.join(adapterRoot, 'src/main/java/vn/heomc/botchecker/paperadapter')

const readJava = (name: string) => readFile(path.join(javaRoot, `${name}.java`), 'utf8')

test('plugin main compose runtime thật, không còn chỉ log', async () => {
  const source = await readJava('PaperBukkitOnlinePlayerPlugin')

  assert.match(source, /extends JavaPlugin/)
  assert.match(source, /PaperBukkitOnlinePlayerAdapterConfig\.parse\(/,
    'phải parse config strict trước khi làm bất cứ gì')
  assert.match(source, /PaperBukkitOnlinePlayerExternalKeyStoreRuntimeComposition\.register\(/,
    'phải compose runtime, đây là thứ trước đây hoàn toàn thiếu')
  assert.match(source, /new PaperBukkitOnlinePlayerAdapterRuntimeFactory\(/)
  assert.match(source, /public void onDisable\(\)/)
  assert.match(source, /composition\.close\(\)/)

  assert.doesNotMatch(source, /transport remains disabled/,
    'câu log của packaging boundary cũ phải biến mất')
})

test('adapter fail-closed ở mọi nhánh: config, companion, registration', async () => {
  const source = await readJava('PaperBukkitOnlinePlayerPlugin')

  for (const code of [
    'PAPER_BUKKIT_ADAPTER_CONFIG_INVALID',
    'PAPER_BUKKIT_ADAPTER_COMPANION_UNAVAILABLE',
    'PAPER_BUKKIT_ADAPTER_RUNTIME_REGISTER_FAILED'
  ]) {
    assert.match(source, new RegExp(code), `thiếu mã fail-closed ${code}`)
  }

  // Mỗi nhánh lỗi phải return sớm, không đi tiếp để bind socket.
  // (log có thể xuống dòng nên cho phép khoảng trắng tuỳ ý giữa các token)
  const failureBranches = source.match(
    /getLogger\(\)\.warning\([\s\S]*?\);\s*return;/g) ?? []
  assert.equal(failureBranches.length, 3,
    `cả ba nhánh lỗi phải return ngay sau khi log, thấy ${failureBranches.length}`)

  // Không nội suy giá trị vào log.
  const logCalls = source.match(/getLogger\(\)\.(?:info|warning|severe)\([\s\S]*?\);/g) ?? []
  assert.ok(logCalls.length >= 4, 'phải có ít nhất 4 lệnh log')
  for (const call of logCalls) {
    assert.doesNotMatch(call, /\+\s*(?:config|companion|error|policy)|String\.format/,
      `log không được chứa giá trị động: ${call}`)
  }
})

test('boot identity được mint mỗi lần enable, không đọc từ config', async () => {
  const config = await readJava('PaperBukkitOnlinePlayerAdapterConfig')

  assert.match(config, /SecureRandom/,
    'boot id phải từ SecureRandom, không phải literal cấu hình')
  assert.match(config, /public static String mintBootId\(\)/)

  // claimedBootId KHÔNG được đọc từ config — đó chính là BC-013.
  assert.doesNotMatch(config, /requiredId\(section, "server\.boot-id"\)/)
  assert.doesNotMatch(config, /getString\("boot/)

  const yml = await readFile(path.join(adapterRoot, 'src/main/resources/config.yml'), 'utf8')
  assert.doesNotMatch(yml, /^\s*boot-id:/m,
    'config.yml không được chứa boot-id: nó phải là fact runtime, không phải literal')
  assert.match(yml, /minted fresh from SecureRandom/,
    'config.yml phải nói rõ vì sao boot id không cấu hình được')
})

test('config parser bounded và fail-closed, không echo giá trị lỗi', async () => {
  const config = await readJava('PaperBukkitOnlinePlayerAdapterConfig')

  assert.match(config, /PAPER_BUKKIT_ADAPTER_CONFIG_MISSING/)
  assert.match(config, /PAPER_BUKKIT_ADAPTER_CONFIG_INVALID/)
  assert.match(config, /requiredSha256Hex/)

  // Mọi thông điệp lỗi là literal cố định, không kèm giá trị người dùng nhập.
  const throws = config.match(/throw new IllegalArgumentException\([^;]*\);/g) ?? []
  assert.ok(throws.length >= 5)
  for (const statement of throws) {
    assert.doesNotMatch(statement, /\+|String\.format|value|key\b/,
      `lỗi config không được echo giá trị: ${statement}`)
  }
})

test('config.yml adapter chỉ chứa public identifier, không chứa bí mật', async () => {
  const yml = await readFile(path.join(adapterRoot, 'src/main/resources/config.yml'), 'utf8')

  for (const required of [
    'companion-plugin-name:', 'port:', 'socket-timeout-ms:', 'snapshot-timeout-ms:',
    'max-ledger-entries:', 'audience:', 'instance-id:', 'target-binding-sha256:'
  ]) {
    assert.ok(yml.includes(required), `config.yml thiếu khoá ${required}`)
  }

  assert.doesNotMatch(yml, /^\s*(?:password|private-key|key-bytes|keystore-path):/m,
    'adapter không bao giờ được cấu hình key material — custody thuộc companion')
  assert.match(yml, /always 127\.0\.0\.1/,
    'bind address phải cố định, không cấu hình được')
})
