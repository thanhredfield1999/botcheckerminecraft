import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

test('Paper Bukkit adapter được đóng gói thành Gradle plugin module tách biệt', async () => {
  const root = 'paper-bukkit-adapter'
  await access(`${root}/settings.gradle.kts`)
  const build = await readFile(`${root}/build.gradle.kts`, 'utf8')
  const pluginYml = await readFile(`${root}/src/main/resources/plugin.yml`, 'utf8')
  const main = await readFile(
    `${root}/src/main/java/vn/heomc/botchecker/paperadapter/PaperBukkitOnlinePlayerPlugin.java`,
    'utf8'
  )

  assert.match(build, /compileOnly\("io\.papermc\.paper:paper-api:\$paperApiVersion"\)/)
  assert.match(build, /getOrElse\("1\.21\.11-R0\.1-SNAPSHOT"\)/)
  assert.match(build, /JavaLanguageVersion\.of\(21\)/)
  assert.match(pluginYml, /^name: BotCheckerPaperAdapter$/m)
  assert.match(pluginYml, /^main: vn\.heomc\.botchecker\.paperadapter\.PaperBukkitOnlinePlayerPlugin$/m)
  assert.match(pluginYml, /^api-version: '1\.21\.11'$/m)
  assert.match(main, /extends JavaPlugin/)
  // Các invariant an toàn vẫn giữ nguyên: plugin main không tự mở socket, không tự
  // đọc KeyStore/ký, không tự đọc player state. Nó chỉ compose các thành phần đó.
  assert.doesNotMatch(main, /import\s+(?:java\.net\.|java\.security\.)/)
  assert.doesNotMatch(main, /\bgetOnlinePlayers\s*\(|\bnew\s+(?:ServerSocket|Socket|KeyStore|Signature)\b/)
  // Contract ĐÃ ĐỔI có chủ đích 2026-09-07 (audit BC-001): trước đây plugin main cố ý
  // KHÔNG compose runtime và chỉ log "transport remains disabled" — đó là packaging
  // boundary khi wire contract chưa có parity test. Nay nó phải compose thật, nếu không
  // toàn bộ adapter là dead code trong chính JAR của nó.
  assert.match(main, /PaperBukkitOnlinePlayerExternalKeyStoreRuntimeComposition\.register\(/)
  assert.match(main, /PaperBukkitOnlinePlayerAdapterConfig\.parse\(/)
  assert.doesNotMatch(main, /transport remains disabled/)
})
