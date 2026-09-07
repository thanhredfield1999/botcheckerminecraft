import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const adapterRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'paper-bukkit-adapter')
const companionRoot = path.join(adapterRoot, 'keystore-companion')

test('keystore-companion là Gradle subproject thật, không phải file lẻ', async () => {
  const settings = await readFile(path.join(adapterRoot, 'settings.gradle.kts'), 'utf8')
  assert.match(settings, /include\("keystore-companion"\)/,
    'companion phải được include, nếu không Gradle không bao giờ biên dịch nó')

  await access(path.join(companionRoot, 'build.gradle.kts'))
  const build = await readFile(path.join(companionRoot, 'build.gradle.kts'), 'utf8')
  assert.match(build, /JavaLanguageVersion\.of\(21\)/)
  assert.match(build, /compileOnly\("io\.papermc\.paper:paper-api:\$paperApiVersion"\)/)
  assert.match(build, /getOrElse\("1\.21\.11-R0\.1-SNAPSHOT"\)/)
  assert.match(build, /compileOnly\(project\(":"\)\)/,
    'phải compile-only vào adapter để dùng chung exact service Class')
  // Bỏ comment trước khi kiểm: comment mô tả "không shade/relocate" không được
  // tính là bằng chứng có shade/relocate.
  const buildCode = build.replace(/\/\/[^\n]*/g, '')
  assert.doesNotMatch(buildCode, /shadow|relocate/,
    'shade/relocate sẽ tạo Class thứ hai và phá ServicesManager lookup')
  assert.doesNotMatch(buildCode, /^\s*implementation\(project/m,
    'adapter phải là compileOnly, không được đóng gói vào JAR companion')
})

test('companion có plugin descriptor và hard dependency vào adapter', async () => {
  const pluginYml = await readFile(
    path.join(companionRoot, 'src/main/resources/plugin.yml'), 'utf8')
  assert.match(pluginYml, /^name: BotCheckerKeyStoreCompanion$/m)
  assert.match(
    pluginYml,
    /^main: vn\.heomc\.botchecker\.keystorecompanion\.PaperBukkitOnlinePlayerKeyStoreCompanionPlugin$/m)
  assert.match(pluginYml, /^api-version: '1\.21\.11'$/m)
  assert.match(pluginYml, /^depend: \[BotCheckerPaperAdapter\]$/m,
    'hard dependency là thứ bảo đảm cùng service Class và đúng thứ tự load')
})

test('companion plugin đăng ký service và teardown đúng thứ tự', async () => {
  const source = await readFile(path.join(
    companionRoot,
    'src/main/java/vn/heomc/botchecker/keystorecompanion',
    'PaperBukkitOnlinePlayerKeyStoreCompanionPlugin.java'), 'utf8')

  assert.match(source, /extends JavaPlugin/)
  assert.match(source, /PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration\.register\(/,
    'phải đăng ký qua helper của adapter, không tự gọi ServicesManager.register thô')
  assert.match(source, /getServer\(\)\.getServicesManager\(\)/)
  assert.match(source, /public void onDisable\(\)/)

  // Teardown: bỏ registration TRƯỚC custody, nếu ngược lại adapter có thể còn lease
  // trỏ vào key đã đóng.
  const disable = source.slice(source.indexOf('public void onDisable()'))
  assert.ok(
    disable.indexOf('closeQuietly(registration)') < disable.indexOf('closeQuietly(access)'),
    'registration phải được đóng trước access')
})

test('companion fail-closed khi config thiếu và không log giá trị nhạy cảm', async () => {
  const source = await readFile(path.join(
    companionRoot,
    'src/main/java/vn/heomc/botchecker/keystorecompanion',
    'PaperBukkitOnlinePlayerKeyStoreCompanionPlugin.java'), 'utf8')

  assert.match(source, /PAPER_BUKKIT_COMPANION_CONFIG_INCOMPLETE/)
  assert.match(source, /no key service registered/)

  // Không được nội suy biến vào log: mọi thông điệp phải là literal cố định.
  const logCalls = source.match(/getLogger\(\)\.(?:info|warning|severe)\([^;]*\);/g) ?? []
  assert.ok(logCalls.length > 0)
  for (const call of logCalls) {
    assert.doesNotMatch(call, /\+|String\.format|rawPath|alias|password|keyStorePath|error\./,
      `log không được chứa giá trị động: ${call}`)
  }

  // Password chỉ đến từ environment, không từ config/argv.
  assert.match(source, /System\.getenv\(/)
  assert.doesNotMatch(source, /getConfig\(\)\.getString\("keystore\.password"\)/)
})

test('config.yml chỉ chứa metadata, không chứa bí mật', async () => {
  const config = await readFile(
    path.join(companionRoot, 'src/main/resources/config.yml'), 'utf8')

  assert.match(config, /password-environment-variable: ''/,
    'chỉ lưu TÊN biến môi trường, không lưu password')
  assert.match(config, /path: ''/)
  assert.match(config, /alias: ''/)
  // Không có key nào tên "password:" trần (khác với password-environment-variable).
  assert.doesNotMatch(config, /^\s*password:/m)
})
