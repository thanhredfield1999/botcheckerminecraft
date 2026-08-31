import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import { collectRuntimeCapabilityManifest } from '../src/capability-manifest.js'

test('Paper session-lock observer chỉ là Windows library-only byte-range probe', async () => {
  const source = await readFile('src/paper-process-session-lock-observer.ts', 'utf8')
  const manifest = collectRuntimeCapabilityManifest({ rootDir: process.cwd() })
  assert.deepEqual(
    manifest.capabilities.find(capability =>
      capability.name === 'paper-process-session-lock-observation'),
    { name: 'paper-process-session-lock-observation', mode: 'library-only' }
  )
  assert.deepEqual(
    manifest.capabilities.find(capability =>
      capability.name === 'paper-process-declared-artifact-tcp-session-lock-preflight'),
    {
      name: 'paper-process-declared-artifact-tcp-session-lock-preflight',
      mode: 'library-only'
    }
  )
  assert.match(
    source,
    /C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1\.0\\\\powershell\.exe/
  )
  assert.match(source, /Buffer\.from\('☃', 'utf8'\)/)
  assert.match(source, /\.Lock\(0,1\)/)
  assert.match(source, /\.Unlock\(0,1\)/)
  assert.match(source, /0x80070021/)
  assert.match(source, /throw/)
  assert.match(source, /sessionLockFactsAuthoritative: false/)
  assert.match(source, /provesPaperProcessIdentity: false/)
  assert.doesNotMatch(source, /process\.env|SystemRoot|PATH|spawn\s*\(|\.kill\s*\(|taskkill|killall/)
  assert.doesNotMatch(source, /\/reload|PlugMan|hot-loader|node:http|node:net|fetch\s*\(/)
  assert.doesNotMatch(source, /writeFile|rename\s*\(|unlink\s*\(|rm\s*\(|mkdir\s*\(/)

  const files = (await readdir('src')).filter(file =>
    file.endsWith('.ts') && file !== 'paper-process-session-lock-observer.ts')
  const importers: string[] = []
  for (const file of files) {
    const candidate = await readFile(`src/${file}`, 'utf8')
    if (/(?:from\s+['"][^'"]*paper-process-session-lock-observer|(?:import|require)\(\s*['"][^'"]*paper-process-session-lock-observer)/.test(candidate)) {
      importers.push(`src/${file}`)
    }
  }
  assert.deepEqual(importers, [])
})
