import { lstatSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/**
 * Build wrapper cho module Paper/Bukkit adapter.
 *
 * Adapter dùng Gradle riêng (Paper API compile-only), không phải `javac` thẳng như
 * `java-src`. Script này là điểm neo provenance duy nhất cho component
 * `paper-bukkit-adapter` trong capability manifest, và là chỗ CI gọi để thật sự
 * biên dịch adapter.
 *
 * Gradle không có sẵn ở mọi môi trường (Windows dev, CI Linux tối giản). Khi thiếu
 * wrapper, script báo SKIPPED bằng exit 0 thay vì fail toàn bộ `npm run build` —
 * nhưng nó KHÔNG bao giờ báo thành công khi chưa biên dịch.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const adapterRoot = path.join(root, 'paper-bukkit-adapter')

function adapterSourceCount(directory) {
  let count = 0
  const stat = lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Adapter source root must be a regular directory: ${directory}`)
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'build' || entry.name === '.gradle') continue
    const absolute = path.join(directory, entry.name)
    const entryStat = lstatSync(absolute)
    if (entryStat.isSymbolicLink()) throw new Error(`Adapter symlink is not allowed: ${absolute}`)
    if (entryStat.isDirectory()) count += adapterSourceCount(absolute)
    else if (entry.isFile() && entry.name.endsWith('.java')) count += 1
  }
  return count
}

let sourceCount
try {
  sourceCount = adapterSourceCount(adapterRoot)
} catch (error) {
  if (error.code === 'ENOENT') {
    console.log('paper-bukkit-adapter: SKIPPED (module not present)')
    process.exit(0)
  }
  throw error
}

if (sourceCount === 0) throw new Error('No Paper adapter Java sources found')

const isWindows = process.platform === 'win32'
const wrapperPath = path.join(adapterRoot, isWindows ? 'gradlew.bat' : 'gradlew')
let hasWrapper = true
try {
  lstatSync(wrapperPath)
} catch {
  hasWrapper = false
}

if (!hasWrapper) {
  console.log(
    `paper-bukkit-adapter: SKIPPED (${sourceCount} sources, no Gradle wrapper at ${wrapperPath}); `
    + 'adapter bytes are hashed into the capability manifest but NOT compiled by this run'
  )
  process.exit(0)
}

// `gradlew.bat` là batch file: Windows chỉ chạy được qua shell (cmd), spawnSync
// trực tiếp trả EINVAL. POSIX gọi thẳng wrapper, không cần shell.
const result = isWindows
  ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'gradlew.bat', '--quiet', 'build'], {
      cwd: adapterRoot, stdio: 'inherit', windowsHide: true, shell: false
    })
  : spawnSync('./gradlew', ['--quiet', 'build'], {
      cwd: adapterRoot, stdio: 'inherit', windowsHide: true, shell: false
    })

if (result.error) throw result.error
if (result.status !== 0) {
  throw new Error(`Paper adapter Gradle build failed with exit code ${result.status}`)
}
console.log(
  `paper-bukkit-adapter: built ${sourceCount} Java sources `
  + '(adapter + keystore-companion subproject)'
)
