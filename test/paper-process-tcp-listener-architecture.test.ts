import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import { collectRuntimeCapabilityManifest } from '../src/capability-manifest.js'

test('Paper process TCP listener observer chỉ là Windows library-only OS snapshot', async () => {
  const source = await readFile('src/paper-process-tcp-listener-observer.ts', 'utf8')
  const manifest = collectRuntimeCapabilityManifest({ rootDir: process.cwd() })
  assert.deepEqual(
    manifest.capabilities.find(capability => capability.name === 'paper-process-tcp-listener-observation'),
    { name: 'paper-process-tcp-listener-observation', mode: 'library-only' }
  )
  assert.deepEqual(
    manifest.capabilities.find(capability =>
      capability.name === 'paper-process-declared-artifact-tcp-listener-preflight'),
    { name: 'paper-process-declared-artifact-tcp-listener-preflight', mode: 'library-only' }
  )
  assert.match(source, /C:\\\\Windows\\\\System32\\\\netstat\.exe/)
  assert.match(source, /configuredTcpPortListenerOwnersObserved: true/)
  assert.match(source, /tcpListenerFactsAuthoritative: false/)
  assert.match(source, /provesPaperProcessIdentity: false/)
  assert.match(source, /execFileSync\(WINDOWS_NETSTAT_EXE, \['-ano', '-p', 'tcp'\]/)
  assert.doesNotMatch(
    source,
    /spawn\s*\(|\.kill\s*\(|taskkill|killall|\/reload|PlugMan|hot-loader/
  )
  assert.doesNotMatch(
    source,
    /node:fs|node:net|node:http|fetch\s*\(|process\.env|writeFile|rename\s*\(|unlink\s*\(|rm\s*\(|mkdir\s*\(/
  )

  const files = (await readdir('src')).filter(file =>
    file.endsWith('.ts') && file !== 'paper-process-tcp-listener-observer.ts')
  const importers: string[] = []
  for (const file of files) {
    const candidate = await readFile(`src/${file}`, 'utf8')
    if (/(?:from\s+['"][^'"]*paper-process-tcp-listener-observer|(?:import|require)\(\s*['"][^'"]*paper-process-tcp-listener-observer)/.test(candidate)) {
      importers.push(`src/${file}`)
    }
  }
  assert.deepEqual(importers, [])
})
