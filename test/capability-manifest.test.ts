import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
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
  assert.equal(manifest.sourceFingerprint, createHash('sha256').update(JSON.stringify({
    codeRoot: manifest.codeRoot,
    sources: manifest.sources
  })).digest('hex'))
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
  assert.equal(manifest.schemaVersion, 2)
  assert.equal(manifest.codeRoot, 'src')
  assert.equal(manifest.sourceFingerprint, createHash('sha256').update(JSON.stringify({
    schemaVersion: 2,
    codeRoot: manifest.codeRoot,
    sources: manifest.sources,
    auxiliaryCode: manifest.auxiliaryCode
  })).digest('hex'))
  assert.equal(manifest.packageJsonSha256, createHash('sha256').update(packageJson).digest('hex'))
  assert.equal(manifest.loadedPackageJson.path, 'package.json')
  assert.equal(manifest.loadedPackageJson.sha256, manifest.packageJsonSha256)
  assert.equal(manifest.packageLockSha256, createHash('sha256').update(packageLock).digest('hex'))
  assert.ok(manifest.sources.some(source => source.path === 'src/runner.ts'))
  assert.deepEqual(manifest.capabilities.find(capability => capability.name === 'immutable-artifacts')?.mode, 'runtime-wired')
  assert.deepEqual(manifest.capabilities.find(capability => capability.name === 'route-oracle')?.mode, 'runtime-wired')
  assert.deepEqual(manifest.capabilities.find(capability => capability.name === 'multi-client')?.mode, 'library-only')
  assert.deepEqual(manifest.capabilities.find(capability => capability.name === 'signed-provider-claim')?.mode, 'library-only')
  assert.deepEqual(
    manifest.capabilities.find(capability => capability.name === 'signed-provider-shared-challenge-state'),
    { name: 'signed-provider-shared-challenge-state', mode: 'library-only' }
  )
  assert.deepEqual(
    manifest.capabilities.find(capability => capability.name === 'signed-provider-observation-bound-claim'),
    { name: 'signed-provider-observation-bound-claim', mode: 'library-only' }
  )
  assert.deepEqual(
    manifest.capabilities.find(capability => capability.name === 'signed-provider-canonical-signature-verification'),
    { name: 'signed-provider-canonical-signature-verification', mode: 'library-only' }
  )
  assert.deepEqual(
    manifest.capabilities.find(capability => capability.name === 'signed-provider-opaque-signing-adapter'),
    { name: 'signed-provider-opaque-signing-adapter', mode: 'library-only' }
  )
  assert.deepEqual(
    manifest.capabilities.find(capability => capability.name === 'google-cloud-kms-hsm-ed25519-signer'),
    { name: 'google-cloud-kms-hsm-ed25519-signer', mode: 'library-only' }
  )
  assert.deepEqual(
    manifest.capabilities.find(capability => capability.name === 'google-cloud-kms-hsm-live-preflight'),
    { name: 'google-cloud-kms-hsm-live-preflight', mode: 'library-only' }
  )
  assert.deepEqual(
    manifest.capabilities.find(capability => capability.name === 'google-cloud-kms-hsm-attestation-envelope-verifier'),
    { name: 'google-cloud-kms-hsm-attestation-envelope-verifier', mode: 'library-only' }
  )
  assert.ok(manifest.sources.some(source => source.path === 'src/signed-provider-challenge-store.ts'))
  assert.ok(manifest.dependencies.some(dependency => dependency.name === 'mineflayer' && dependency.version === '4.37.1'))
  assert.ok(manifest.dependencies.some(dependency => dependency.name === '@google-cloud/kms' && dependency.version === '6.0.0'))
  assert.ok(manifest.dependencies.some(dependency => dependency.name === 'fast-crc32c' && dependency.version === '2.0.0'))
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

test('package runtime floor hỗ trợ node:sqlite DatabaseSync security options', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
    engines?: { node?: string }
  }
  const storeSource = await readFile('src/signed-provider-challenge-store.ts', 'utf8')
  assert.equal(packageJson.engines?.node, '>=22.18.0')
  assert.match(storeSource, /assertSupportedNodeRuntime\(\)/)
  assert.match(storeSource, /typeof .*isTransaction.*!== 'boolean'/)
  assert.match(storeSource, /PRAGMA busy_timeout/)
  assert.match(storeSource, /busyTimeout\.timeout !== this\.busyTimeoutMs/)
})

test('Java observation core được build và bind vào capability provenance', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
    scripts: Record<string, string>
  }
  assert.equal(packageJson.scripts['build:java'], 'node scripts/build-java.mjs')
  assert.match(packageJson.scripts.build ?? '', /npm run build:java/)

  const manifest = collectRuntimeCapabilityManifest({ rootDir: process.cwd() }) as unknown as {
    capabilities: Array<{ name: string; mode: string }>
    auxiliaryCode?: Array<{
      component: string
      sourceRoot: string
      outputRoot: string
      mode: string
      sources: Array<{ path: string; sha256: string }>
      compiled: Array<{ path: string; sha256: string }>
    }>
  }
  assert.deepEqual(
    manifest.capabilities.find(capability => capability.name === 'jvm-artifact-observer'),
    { name: 'jvm-artifact-observer', mode: 'library-only' }
  )
  assert.deepEqual(
    manifest.capabilities.find(capability => capability.name === 'jvm-artifact-observation-assessment'),
    { name: 'jvm-artifact-observation-assessment', mode: 'library-only' }
  )
  assert.deepEqual(
    manifest.capabilities.find(capability => capability.name === 'jvm-observation-bound-claim-builder'),
    { name: 'jvm-observation-bound-claim-builder', mode: 'library-only' }
  )
  const java = manifest.auxiliaryCode?.find(component => component.component === 'jvm-artifact-observer')
  assert.equal(java?.sourceRoot, 'java-src')
  assert.equal(java?.outputRoot, 'dist/java')
  assert.equal(java?.mode, 'source-only')
  assert.ok(java?.sources.some(source =>
    source.path === 'java-src/vn/heomc/botchecker/probe/JvmArtifactObserver.java'
    && sha256.test(source.sha256)))
  assert.ok(java?.sources.some(source =>
    source.path === 'java-src/vn/heomc/botchecker/probe/JvmObservationBoundClaimBuilder.java'
    && sha256.test(source.sha256)))
  assert.deepEqual(java?.compiled, [])
})

test('compiled capability collector bind Java class output, source và build script', async () => {
  const buildOptions = {
    cwd: process.cwd(),
    encoding: 'utf8' as const,
    timeout: 120_000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true
  }
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], buildOptions)
  execFileSync(process.execPath, ['scripts/build-java.mjs'], buildOptions)
  const compiledModule = await import(`../dist/src/capability-manifest.js?compiled=${Date.now()}`) as {
    collectRuntimeCapabilityManifest(options: { rootDir: string }): {
      schemaVersion: number
      codeRoot: string
      auxiliaryCode?: Array<{
        component: string
        mode: string
        buildScript: { path: string; sha256: string }
        sources: Array<{ path: string; sha256: string }>
        compiled: Array<{ path: string; sha256: string }>
      }>
    }
  }
  const manifest = compiledModule.collectRuntimeCapabilityManifest({ rootDir: process.cwd() })
  const java = manifest.auxiliaryCode?.find(component => component.component === 'jvm-artifact-observer')
  assert.equal(manifest.schemaVersion, 2)
  assert.equal(manifest.codeRoot, 'dist/src')
  assert.equal(java?.mode, 'source-and-compiled')
  assert.equal(java?.buildScript.path, 'scripts/build-java.mjs')
  assert.ok(java?.sources.some(source => source.path.endsWith('/JvmArtifactObserver.java')))
  assert.ok(java?.compiled.some(file => file.path.endsWith('/JvmArtifactObserver.class')))
  assert.ok(java?.sources.some(source => source.path.endsWith('/JvmObservationBoundClaimBuilder.java')))
  assert.ok(java?.compiled.some(file => file.path.endsWith('/JvmObservationBoundClaimBuilder.class')))
})

test('Java production observation-bound builder không có key hoặc signing API', async () => {
  const source = await readFile(
    'java-src/vn/heomc/botchecker/probe/JvmObservationBoundClaimBuilder.java',
    'utf8'
  )
  const capabilitySource = await readFile('src/capability-manifest.ts', 'utf8')
  assert.doesNotMatch(source, /java\.security|PrivateKey|KeyFactory|Signature|PKCS|PEM|JKS|KeyStore/)
  assert.doesNotMatch(source, /Files\.|Path\.|System\.getenv|System\.getProperty/)
  assert.match(source, /JvmArtifactObserver\.EVIDENCE_GRADE\.equals\(observation\.grade\(\)\)/)
  assert.match(source, /observation\.authoritative\(\)/)
  assert.match(source, /observation\.provesLoadedBytecode\(\)/)
  assert.match(source, /observation\.releaseEligible\(\)/)
  assert.match(capabilitySource, /javaSources\.some\(source => source\.path[\s\S]*JvmObservationBoundClaimBuilder/)
})

test('opaque signing adapter không có private-key loader hoặc runtime wiring', async () => {
  const source = await readFile('src/signed-provider-signing-adapter.ts', 'utf8')
  assert.doesNotMatch(source, /node:fs|process\.env|createPrivateKey|PrivateKey|PKCS|JKS|PEM|KeyStore/)
  assert.doesNotMatch(source, /SignedProviderClaimVerifier|verifyAndConsume|runner|report|server|Paper|Bukkit/)
  assert.match(source, /verifyCanonicalSignedProviderClaimSignature/)

  const sourceFiles = (await readdir('src', { recursive: true }))
    .filter(file => file.endsWith('.ts') && !file.endsWith('signed-provider-signing-adapter.ts'))
    .map(file => `src/${file}`)
  for (const file of sourceFiles) {
    const runtimeSource = await readFile(file, 'utf8')
    assert.doesNotMatch(
      runtimeSource,
      /(?:from\s+['"][^'"]*signed-provider-signing-adapter|(?:import|require)\(\s*['"][^'"]*signed-provider-signing-adapter)/
    )
  }
})

test('Google Cloud KMS signer không nhận private key, credential hoặc runtime wiring', async () => {
  const source = await readFile('src/google-cloud-kms-signing-backend.ts', 'utf8')
  assert.doesNotMatch(
    source,
    /node:fs|process\.env|createPrivateKey|generateKeyPair|privateKey|keyFilename|credentials|accessToken|client_email|private_key/
  )
  assert.doesNotMatch(source, /runner|report|server|Paper|Bukkit|verifyAndConsume/)
  assert.match(source, /new KeyManagementServiceClient\(\)/)
  assert.match(source, /EC_SIGN_ED25519/)
  assert.match(source, /protectionLevel/)

  const sourceFiles = (await readdir('src', { recursive: true }))
    .filter(file => file.endsWith('.ts') && !file.endsWith('google-cloud-kms-signing-backend.ts'))
    .map(file => `src/${file}`)
  const importers: string[] = []
  for (const file of sourceFiles) {
    const runtimeSource = await readFile(file, 'utf8')
    if (/(?:from\s+['"][^'"]*google-cloud-kms-signing-backend|(?:import|require)\(\s*['"][^'"]*google-cloud-kms-signing-backend)/.test(runtimeSource)) {
      importers.push(file)
    }
  }
  assert.deepEqual(importers, ['src/google-cloud-kms-live-preflight.ts'])
})

test('Google Cloud KMS live preflight chỉ là manual CLI, không có app runtime wiring', async () => {
  const preflight = await readFile('src/google-cloud-kms-live-preflight.ts', 'utf8')
  assert.doesNotMatch(preflight, /runner|report|server|Paper|Bukkit|verifyAndConsume|node:fs|process\.env/)

  const sourceFiles = (await readdir('src', { recursive: true }))
    .filter(file => file.endsWith('.ts') && !file.endsWith('google-cloud-kms-live-preflight.ts'))
    .map(file => `src/${file}`)
  for (const file of sourceFiles) {
    const runtimeSource = await readFile(file, 'utf8')
    assert.doesNotMatch(
      runtimeSource,
      /(?:from\s+['"][^'"]*google-cloud-kms-live-preflight|(?:import|require)\(\s*['"][^'"]*google-cloud-kms-live-preflight)/
    )
  }
})

test('Google Cloud KMS HSM attestation verifier không có runtime, network hoặc private-key wiring', async () => {
  const source = await readFile('src/google-cloud-kms-hsm-attestation-verifier.ts', 'utf8')
  assert.doesNotMatch(source, /node:fs|node:child_process|fetch\(|https?:|process\.env/)
  assert.doesNotMatch(source, /createPrivateKey|generateKeyPair|BEGIN PRIVATE KEY/)
  assert.doesNotMatch(source, /google-cloud-kms-live-preflight|server|runner|report|Paper|Bukkit/)

  const productionFiles = [
    ...(await readdir('src', { recursive: true }))
      .filter(file => file.endsWith('.ts') && !file.endsWith('google-cloud-kms-hsm-attestation-verifier.ts'))
      .map(file => `src/${file}`),
    ...(await readdir('scripts', { recursive: true }))
      .filter(file => /\.(?:[cm]?js|ts)$/.test(file))
      .map(file => `scripts/${file}`)
  ]
  const importers: string[] = []
  for (const file of productionFiles) {
    const runtimeSource = await readFile(file, 'utf8')
    if (/(?:from\s+['"][^'"]*google-cloud-kms-hsm-attestation-verifier|(?:import|require)\(\s*['"][^'"]*google-cloud-kms-hsm-attestation-verifier)/.test(runtimeSource)) {
      importers.push(file)
    }
  }
  assert.deepEqual(importers, [])
})

test('capability manifest reject auxiliary aggregate vượt total byte bound', () => {
  const boundedFile = new Uint8Array(2 * 1024 * 1024)
  assert.throws(() => buildCapabilityManifest({
    ...facts(),
    auxiliaryCode: [{
      component: 'jvm-artifact-observer',
      sourceRoot: 'java-src',
      outputRoot: 'dist/java',
      mode: 'source-only',
      buildScript: { path: 'scripts/build-java.mjs', content: 'build' },
      sources: Array.from({ length: 17 }, (_, index) => ({
        path: `java-src/Observer${index}.java`, content: boundedFile
      })),
      compiled: []
    }]
  }), /auxiliary total byte bound/i)
})

test('capability manifest validate auxiliary count và roots trước khi hash content', () => {
  assert.throws(() => buildCapabilityManifest({
    ...facts(), auxiliaryCode: []
  }), /auxiliary.*empty|empty.*auxiliary/i)

  const tooManySources = Array.from({ length: 65 }, (_, index) => ({
    path: `java-src/Observer${index}.java`, content: 'source'
  }))
  Object.defineProperty(tooManySources[0], 'content', {
    get() { throw new Error('SOURCE_CONTENT_TOUCHED_BEFORE_COUNT_VALIDATION') }
  })
  assert.throws(() => buildCapabilityManifest({
    ...facts(),
    auxiliaryCode: [{
      component: 'jvm-artifact-observer', sourceRoot: 'java-src', outputRoot: 'dist/java',
      mode: 'source-only', buildScript: { path: 'scripts/build-java.mjs', content: 'build' },
      sources: tooManySources, compiled: []
    }]
  }), /auxiliary code file count exceeds bound/i)

  const component = (index: number) => ({
    component: `observer-${index}`, sourceRoot: `java-src-${index}`, outputRoot: `dist/java-${index}`,
    mode: 'source-only' as const,
    buildScript: { path: `scripts/build-java-${index}.mjs`, content: 'build' },
    sources: [{ path: `java-src-${index}/Observer.java`, content: 'source' }], compiled: []
  })
  assert.throws(() => buildCapabilityManifest({
    ...facts(), auxiliaryCode: Array.from({ length: 9 }, (_, index) => component(index))
  }), /auxiliary component count exceeds bound/i)

  assert.throws(() => buildCapabilityManifest({
    ...facts(), auxiliaryCode: [{
      ...component(0), buildScript: { path: 'java-src-0/build.mjs', content: 'build' }
    }]
  }), /build script.*scripts/i)
  assert.throws(() => buildCapabilityManifest({
    ...facts(), auxiliaryCode: [{ ...component(0), outputRoot: 'java-src-0' }]
  }), /source root.*output root|roots.*distinct/i)
})
