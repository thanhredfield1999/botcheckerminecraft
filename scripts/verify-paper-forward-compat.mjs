#!/usr/bin/env node
/**
 * Paper forward-compatibility gate.
 *
 * Adapter compile against SÀN `1.21.11-R0.1-SNAPSHOT` để giữ bytecode 21 — đó là điều
 * kiện để một JAR chạy được cả trên 1.21.11 (Java 21) lẫn Paper 26.x (Java 25).
 *
 * Nhưng "compile theo sàn" KHÔNG tự chứng minh nó còn chạy trên bản mới nhất. Script này
 * kiểm compile (không runtime): hỏi Maven bản paper-api stable mới nhất, biên dịch nguyên bộ
 * source adapter + companion với API đó ở `--release 21`. Nếu Paper xoá hoặc đổi một API
 * mà adapter đang dùng, bước này FAIL — sớm hơn nhiều so với lúc phát hiện trên server.
 *
 * Mạng hỏng/thiếu javac là SKIPPED; khi REQUIRE_FORWARD_COMPAT=1 hoặc CI=true,
 * SKIPPED exit 1, local optional exit 0. API không tương thích là FAILED. Không báo
 * thành công khi chưa thực sự biên dịch.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const adapterRoot = path.join(root, 'paper-bukkit-adapter')
const METADATA_URL =
  'https://repo.papermc.io/repository/maven-public/io/papermc/paper/paper-api/maven-metadata.xml'
const MAVEN_BASE = 'https://repo.papermc.io/repository/maven-public/io/papermc/paper/paper-api'
const NETWORK_TIMEOUT_MS = 60_000

let workspace
function skip(reason) {
  console.log(`paper-forward-compat: SKIPPED — ${reason}`)
  console.log('Forward compatibility is NOT verified by this run.')
  if (workspace) rmSync(workspace, { recursive: true, force: true })
  process.exit(process.env.REQUIRE_FORWARD_COMPAT === '1' || process.env.CI === 'true' ? 1 : 0)
}

function fail(reason) {
  console.error(`paper-forward-compat: FAILED — ${reason}`)
  if (workspace) rmSync(workspace, { recursive: true, force: true })
  process.exit(1)
}

if (spawnSync('javac', ['-version'], { windowsHide: true }).status !== 0) {
  skip('javac không có mặt')
}

let metadata
try {
  const response = await fetch(METADATA_URL, { signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) })
  if (!response.ok) skip(`Maven metadata trả HTTP ${response.status}`)
  metadata = await response.text()
} catch (error) {
  skip(`không tải được Maven metadata (${error.name})`)
}

const stableVersions = [...metadata.matchAll(/<version>([^<]+)<\/version>/g)]
  .map(match => match[1]).filter(version => /^\d+(?:\.\d+)*\.build\.\d+-stable$/.test(version))
  .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
// <release> có thể là alpha: không dùng nó làm bằng chứng latest stable.
const latest = stableVersions.at(-1)
if (!latest) skip('không tìm được stable Paper API trong Maven metadata')
console.log(`paper-forward-compat: latest stable paper-api = ${latest}`)

workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-fwd-'))
try {
  const apiJar = path.join(workspace, 'paper-api.jar')
  const jarUrl = `${MAVEN_BASE}/${latest}/paper-api-${latest}.jar`
  try {
    const response = await fetch(jarUrl, { signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) })
    if (!response.ok) skip(`không tải được paper-api JAR (HTTP ${response.status})`)
    writeFileSync(apiJar, Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    skip(`không tải được paper-api JAR (${error.name})`)
  }

  // Adventure là transitive dep của paper-api; javac thủ công không resolve Maven nên
  // phải tải tay. Thiếu nó là vấn đề của cách kiểm, không phải của adapter → SKIPPED.
  const adventureJars = []
  let adventureVersion
  try {
    const response = await fetch(
      'https://repo1.maven.org/maven2/net/kyori/adventure-key/maven-metadata.xml',
      { signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) })
    adventureVersion = (await response.text()).match(/<release>([^<]+)<\/release>/)?.[1]
  } catch {
    skip('không tải được Adventure metadata')
  }
  if (!adventureVersion) skip('không đọc được Adventure release version')

  for (const artifact of ['adventure-key', 'adventure-api']) {
    const target = path.join(workspace, `${artifact}.jar`)
    try {
      const response = await fetch(
        `https://repo1.maven.org/maven2/net/kyori/${artifact}/${adventureVersion}/${artifact}-${adventureVersion}.jar`,
        { signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS), redirect: 'follow' })
      if (!response.ok) skip(`không tải được ${artifact} (HTTP ${response.status})`)
      writeFileSync(target, Buffer.from(await response.arrayBuffer()))
      adventureJars.push(target)
    } catch (error) {
      skip(`không tải được ${artifact} (${error.name})`)
    }
  }

  const sources = []
  const collect = directory => {
    const stat = lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('source root không phải directory thường')
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'build' || entry.name === '.gradle') continue
      const absolute = path.join(directory, entry.name)
      if (lstatSync(absolute).isSymbolicLink()) fail('source symlink không được phép')
      if (entry.isDirectory()) collect(absolute)
      else if (entry.isFile() && entry.name.endsWith('.java')) sources.push(absolute)
    }
  }
  collect(path.join(adapterRoot, 'src/main/java'))
  collect(path.join(adapterRoot, 'keystore-companion/src/main/java'))
  if (sources.length === 0) fail('không tìm thấy source Java nào của adapter')

  const argfile = path.join(workspace, 'sources.txt')
  writeFileSync(argfile, sources.map(source => `"${source.replaceAll('\\', '/')}"`).join('\n'), 'utf8')
  const classpath = [apiJar, ...adventureJars].join(path.delimiter)
  const outDir = path.join(workspace, 'out')

  const compile = spawnSync('javac', [
    '--release', '21', '-nowarn', '-cp', classpath, '-d', outDir, `@${argfile}`
  ], { encoding: 'utf8', windowsHide: true })

  if (compile.error) skip(`không chạy được javac (${compile.error.code})`)
  if (compile.status !== 0) {
    console.error(compile.stdout ?? '')
    console.error(compile.stderr ?? '')
    fail(
      `${sources.length} file adapter KHÔNG biên dịch được với paper-api ${latest}. `
      + 'Forward compatibility NOT verified; cần phân biệt lỗi source/API, JDK và classpath qua diagnostics.'
    )
  }

  console.log(
    `paper-forward-compat: PASSED — ${sources.length} file compile sạch với paper-api `
    + `${latest} ở --release 21 (sàn build vẫn là 1.21.11).`
  )
} finally {
  rmSync(workspace, { recursive: true, force: true })
}
