import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import { collectRuntimeCapabilityManifest } from '../src/capability-manifest.js'

test('Paper online-player observer chỉ là localhost library-only server-list counter-evidence', async () => {
  const source = await readFile('src/paper-process-online-player-observer.ts', 'utf8')
  const manifest = collectRuntimeCapabilityManifest({ rootDir: process.cwd() })
  assert.deepEqual(
    manifest.capabilities.find(capability => capability.name === 'paper-process-online-player-observation'),
    { name: 'paper-process-online-player-observation', mode: 'library-only' }
  )
  assert.match(source, /const STATUS_HOST = '127\.0\.0\.1'/)
  assert.match(source, /const STATUS_VERSION = '1\.21\.11'/)
  assert.match(source, /onlinePlayerFactsAuthoritative: false/)
  assert.match(source, /provesBukkitOnlinePlayers: false/)
  assert.match(source, /provesZeroOnlinePlayers: false/)
  assert.match(source, /usableForCleanPreflight: false/)
  assert.doesNotMatch(source, /node:fs|node:http|node:net|fetch\s*\(|process\.env|spawn\s*\(|\.kill\s*\(|taskkill|killall/)
  assert.doesNotMatch(source, /\/reload|PlugMan|hot-loader|writeFile|rename\s*\(|unlink\s*\(|rm\s*\(|mkdir\s*\(/)

  const files = (await readdir('src')).filter(file =>
    file.endsWith('.ts') && file !== 'paper-process-online-player-observer.ts')
  const importers: string[] = []
  for (const file of files) {
    const candidate = await readFile(`src/${file}`, 'utf8')
    if (/(?:from\s+['"][^'"]*paper-process-online-player-observer|(?:import|require)\(\s*['"][^'"]*paper-process-online-player-observer)/.test(candidate)) {
      importers.push(`src/${file}`)
    }
  }
  assert.deepEqual(importers, [])
})
