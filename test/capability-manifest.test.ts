import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildCapabilityManifest, collectRuntimeCapabilityManifest } from '../src/capability-manifest.js'

const sha256 = /^[a-f0-9]{64}$/

function facts() {
  return {
    packageJson: '{"name":"botcheckerminecraft","version":"0.1.0"}',
    packageLock: '{"lockfileVersion":3}',
    git: { commit: '3339f2229679a0cf78aa31b8a35ea9ea2ae2d29d', dirty: true },
    runtime: { node: 'v22.22.0', platform: 'win32', arch: 'x64' },
    codeRoot: 'src',
    loadedPackageJson: { path: 'package.json', content: '{"name":"botcheckerminecraft","version":"0.1.0"}' },
    dependencies: { zod: '4.4.3', mineflayer: '4.37.1' },
    capabilities: { 'route-oracle': 'runtime-wired', gui: 'library-only' },
    sources: [
      { path: 'src/runner.ts', content: 'runner source' },
      { path: 'src/scenario.ts', content: 'scenario source' }
    ]
  } as const
}

test('capability manifest bind package, lock, git, runtime, dependency và source fingerprints', () => {
  const manifest = buildCapabilityManifest(facts())

  assert.equal(manifest.schemaVersion, 1)
  assert.deepEqual(manifest.git, facts().git)
  assert.deepEqual(manifest.runtime, facts().runtime)
  assert.equal(manifest.codeRoot, 'src')
  assert.match(manifest.packageJsonSha256, sha256)
  assert.deepEqual(manifest.loadedPackageJson, { path: 'package.json', sha256: manifest.packageJsonSha256 })
  assert.match(manifest.packageLockSha256, sha256)
  assert.deepEqual(manifest.dependencies, [
    { name: 'mineflayer', version: '4.37.1' },
    { name: 'zod', version: '4.4.3' }
  ])
  assert.deepEqual(manifest.capabilities, [
    { name: 'gui', mode: 'library-only' },
    { name: 'route-oracle', mode: 'runtime-wired' }
  ])
  assert.deepEqual(manifest.sources.map(source => source.path), ['src/runner.ts', 'src/scenario.ts'])
  assert.ok(manifest.sources.every(source => sha256.test(source.sha256)))
  assert.match(manifest.sourceFingerprint, sha256)
})

test('capability manifest deterministic khi input map/list khác thứ tự', () => {
  const first = buildCapabilityManifest(facts())
  const second = buildCapabilityManifest({
    ...facts(),
    dependencies: { mineflayer: '4.37.1', zod: '4.4.3' },
    capabilities: { gui: 'library-only', 'route-oracle': 'runtime-wired' },
    sources: [...facts().sources].reverse()
  })

  assert.deepEqual(second, first)
})

test('capability manifest fail closed với commit/path/capability không bounded', () => {
  assert.throws(() => buildCapabilityManifest({ ...facts(), git: { commit: 'not-a-commit', dirty: false } }), /commit/i)
  assert.throws(() => buildCapabilityManifest({
    ...facts(), sources: [{ path: '../secret.txt', content: 'secret' }]
  }), /source path/i)
  assert.throws(() => buildCapabilityManifest({
    ...facts(), loadedPackageJson: { path: 'dist/package.json', content: '{}' }
  }), /does not match code root/i)
  assert.throws(() => buildCapabilityManifest({
    ...facts(), capabilities: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`capability-${index}`, 'library-only']))
  }), /capabilit/i)
})

test('runtime capability collector bind exact current repo snapshot mà không mở server', async () => {
  const manifest = collectRuntimeCapabilityManifest({ rootDir: process.cwd() })
  const packageJson = await readFile('package.json')
  const packageLock = await readFile('package-lock.json')

  assert.match(manifest.git.commit, /^[a-f0-9]{40}$/)
  assert.equal(typeof manifest.git.dirty, 'boolean')
  assert.equal(manifest.codeRoot, 'src')
  assert.equal(manifest.packageJsonSha256, createHash('sha256').update(packageJson).digest('hex'))
  assert.equal(manifest.loadedPackageJson.path, 'package.json')
  assert.equal(manifest.loadedPackageJson.sha256, manifest.packageJsonSha256)
  assert.equal(manifest.packageLockSha256, createHash('sha256').update(packageLock).digest('hex'))
  assert.ok(manifest.sources.some(source => source.path === 'src/runner.ts'))
  assert.deepEqual(manifest.capabilities.find(capability => capability.name === 'immutable-artifacts')?.mode, 'runtime-wired')
  assert.deepEqual(manifest.capabilities.find(capability => capability.name === 'route-oracle')?.mode, 'runtime-wired')
  assert.deepEqual(manifest.capabilities.find(capability => capability.name === 'multi-client')?.mode, 'library-only')
  assert.deepEqual(manifest.capabilities.find(capability => capability.name === 'signed-provider-claim')?.mode, 'library-only')
  assert.ok(manifest.dependencies.some(dependency => dependency.name === 'mineflayer' && dependency.version === '4.37.1'))
  assert.ok(manifest.sources.length <= 256)
})

test('runtime capability collector bracket toàn bộ file snapshot bằng Git HEAD và status', async () => {
  const source = await readFile('src/capability-manifest.ts', 'utf8')
  const collector = source.slice(
    source.indexOf('export function collectRuntimeCapabilityManifest'),
    source.indexOf('\nlet runtimeManifest')
  )
  const commitBefore = collector.indexOf('const commitBefore')
  const statusBefore = collector.indexOf('const statusBefore')
  const packageRead = collector.indexOf('const packageJson')
  const sourceRead = collector.indexOf('const sources')
  const commitAfter = collector.indexOf('const commitAfter')
  const statusAfter = collector.indexOf('const statusAfter')

  assert.ok(commitBefore >= 0 && commitBefore < packageRead)
  assert.ok(statusBefore >= 0 && statusBefore < packageRead)
  assert.ok(packageRead < sourceRead)
  assert.ok(sourceRead < commitAfter && sourceRead < statusAfter)
  assert.match(collector, /commitAfter !== commitBefore/)
  assert.match(collector, /statusAfter !== statusBefore/)
})
