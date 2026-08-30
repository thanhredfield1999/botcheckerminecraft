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
  assert.deepEqual(
    manifest.capabilities.find(capability => capability.name === 'authorized-provider-registry'),
    { name: 'authorized-provider-registry', mode: 'runtime-wired' }
  )
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
    manifest.capabilities.find(capability => capability.name === 'signed-provider-observer-signing-pipeline'),
    { name: 'signed-provider-observer-signing-pipeline', mode: 'library-only' }
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
  assert.deepEqual(
    manifest.capabilities.find(capability => capability.name === 'google-cloud-kms-hsm-cavium-v2-statement-parser'),
    { name: 'google-cloud-kms-hsm-cavium-v2-statement-parser', mode: 'library-only' }
  )
  assert.deepEqual(
    manifest.capabilities.find(capability => capability.name === 'google-cloud-kms-hsm-attestation-binding-verifier'),
    { name: 'google-cloud-kms-hsm-attestation-binding-verifier', mode: 'library-only' }
  )
  assert.deepEqual(
    manifest.capabilities.find(capability => capability.name === 'google-cloud-kms-hsm-attestation-snapshot-bridge'),
    { name: 'google-cloud-kms-hsm-attestation-snapshot-bridge', mode: 'library-only' }
  )
  assert.deepEqual(
    manifest.capabilities.find(capability => capability.name === 'google-cloud-kms-hsm-trust-root-policy'),
    { name: 'google-cloud-kms-hsm-trust-root-policy', mode: 'library-only' }
  )
  assert.deepEqual(
    manifest.capabilities.find(capability => capability.name === 'google-cloud-kms-hsm-policy-attestation-bridge'),
    { name: 'google-cloud-kms-hsm-policy-attestation-bridge', mode: 'library-only' }
  )
  assert.deepEqual(
    manifest.capabilities.find(capability => capability.name === 'signed-provider-evidence-bundle-verifier'),
    { name: 'signed-provider-evidence-bundle-verifier', mode: 'library-only' }
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
  assert.deepEqual(
    manifest.capabilities.find(capability => capability.name === 'paper-jvm-observation-port'),
    { name: 'paper-jvm-observation-port', mode: 'library-only' }
  )
  assert.deepEqual(
    manifest.capabilities.find(capability => capability.name === 'paper-jvm-observation-claim-bridge'),
    { name: 'paper-jvm-observation-claim-bridge', mode: 'library-only' }
  )
  assert.deepEqual(
    manifest.capabilities.find(capability => capability.name === 'paper-jvm-observation-result-codec'),
    { name: 'paper-jvm-observation-result-codec', mode: 'library-only' }
  )
  assert.deepEqual(
    manifest.capabilities.find(capability => capability.name === 'paper-jvm-observation-byte-provider'),
    { name: 'paper-jvm-observation-byte-provider', mode: 'library-only' }
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
  assert.ok(java?.sources.some(source =>
    source.path === 'java-src/vn/heomc/botchecker/probe/PaperJvmObservationPort.java'
    && sha256.test(source.sha256)))
  assert.ok(java?.sources.some(source =>
    source.path === 'java-src/vn/heomc/botchecker/probe/PaperJvmObservationClaimBridge.java'
    && sha256.test(source.sha256)))
  assert.ok(java?.sources.some(source =>
    source.path === 'java-src/vn/heomc/botchecker/probe/PaperJvmObservationResultCodec.java'
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
  assert.ok(java?.sources.some(source => source.path.endsWith('/PaperJvmObservationPort.java')))
  assert.ok(java?.compiled.some(file => file.path.endsWith('/PaperJvmObservationPort.class')))
  assert.ok(java?.sources.some(source => source.path.endsWith('/PaperJvmObservationClaimBridge.java')))
  assert.ok(java?.compiled.some(file => file.path.endsWith('/PaperJvmObservationClaimBridge.class')))
  assert.ok(java?.sources.some(source => source.path.endsWith('/PaperJvmObservationResultCodec.java')))
  assert.ok(java?.compiled.some(file => file.path.endsWith('/PaperJvmObservationResultCodec.class')))
})

test('Paper JVM observation port chỉ là library boundary không runtime/signing wiring', async () => {
  const source = await readFile(
    'java-src/vn/heomc/botchecker/probe/PaperJvmObservationPort.java',
    'utf8'
  )
  assert.doesNotMatch(source, /org\.bukkit|io\.papermc|PrivateKey|KeyFactory|Signature|PKCS|PEM|JKS|KeyStore/)
  assert.doesNotMatch(source, /java\.net|java\.nio\.file|System\.getenv|System\.getProperty/)
  assert.doesNotMatch(source, /runner|report|HTTP|Socket|ServerSocket/)
  assert.match(source, /PAPER_PRIMARY_THREAD_REQUIRED/)
  assert.match(source, /PAPER_PRIMARY_THREAD_IO_REJECTED/)
  assert.match(source, /JvmArtifactObserver\.observe/)
  assert.match(source, /observation\.authoritative\(\)/)
  assert.match(source, /observation\.provesLoadedBytecode\(\)/)
  assert.match(source, /observation\.releaseEligible\(\)/)
})

test('Paper JVM observation claim bridge chỉ compose canonical library input', async () => {
  const source = await readFile(
    'java-src/vn/heomc/botchecker/probe/PaperJvmObservationClaimBridge.java',
    'utf8'
  )
  assert.doesNotMatch(source, /org\.bukkit|io\.papermc|PrivateKey|KeyFactory|Signature|PKCS|PEM|JKS|KeyStore/)
  assert.doesNotMatch(source, /java\.net|java\.nio\.file|System\.getenv|System\.getProperty/)
  assert.doesNotMatch(source, /SignedProviderClaimVerifier|verifyAndConsume|consume\s*\(|runner|report|HTTP|Socket|ServerSocket/)
  assert.match(source, /JvmObservationBoundClaimBuilder\.Input/)
  assert.match(source, /JvmObservationBoundClaimBuilder\.canonicalJsonUtf8V2/)
  assert.match(source, /claims\.observedAtMs\(\) != result\.observedAtMs\(\)/)
})

test('Paper JVM observation result codecs chỉ là transport-neutral libraries', async () => {
  const javaSource = await readFile(
    'java-src/vn/heomc/botchecker/probe/PaperJvmObservationResultCodec.java',
    'utf8'
  )
  const nodeSource = await readFile('src/paper-jvm-observation-result-codec.ts', 'utf8')
  const combined = `${javaSource}\n${nodeSource}`
  assert.doesNotMatch(combined, /org\.bukkit|io\.papermc|PrivateKey|KeyFactory|Signature|PKCS|PEM|JKS|KeyStore/)
  assert.doesNotMatch(combined, /node:http|node:net|java\.net|ServerSocket|HttpClient|Socket|fetch\s*\(/)
  assert.doesNotMatch(combined, /System\.getenv|System\.getProperty|process\.env|verifyAndConsume|consume\s*\(/)
  assert.match(javaSource, /MAX_CANONICAL_BYTES = 16 \* 1024/)
  assert.match(nodeSource, /MAX_CANONICAL_BYTES = 16 \* 1024/)
  assert.match(nodeSource, /new TextDecoder\('utf-8', \{ fatal: true \}\)/)

  const sourceFiles = (await readdir('src', { recursive: true }))
    .filter(file => file.endsWith('.ts') && !file.endsWith('paper-jvm-observation-result-codec.ts'))
    .map(file => `src/${file}`)
  const importers: string[] = []
  for (const file of sourceFiles) {
    const source = await readFile(file, 'utf8')
    if (/(?:from\s+['"][^'"]*paper-jvm-observation-result-codec|(?:import|require)\(\s*['"][^'"]*paper-jvm-observation-result-codec)/.test(source)) {
      importers.push(file)
    }
  }
  assert.deepEqual(importers, ['src/paper-jvm-observation-byte-provider.ts'])
})

test('authorized provider registry chỉ admission metadata và được server runtime wire', async () => {
  const registrySource = await readFile('src/provider-registry.ts', 'utf8')
  const serverSource = await readFile('src/server.ts', 'utf8')
  const files = (await readdir('src')).filter(file => file.endsWith('.ts')).sort()
  const importers: string[] = []
  for (const file of files) {
    const source = await readFile(`src/${file}`, 'utf8')
    if (/(?:from\s+['"][^'"]*provider-registry|(?:import|require)\(\s*['"][^'"]*provider-registry)/.test(source)) {
      importers.push(`src/${file}`)
    }
  }

  assert.deepEqual(importers, ['src/runner.ts', 'src/server.ts'])
  assert.match(serverSource, /providerRegistry\.resolve/)
  assert.doesNotMatch(registrySource, /node:http|node:net|node:fs|fetch\s*\(|process\.env|org\.bukkit|io\.papermc/)
  assert.doesNotMatch(registrySource, /\.start\s*\(|\.stop\s*\(|\.restart\s*\(|\.observe\s*\(|\.invoke\s*\(/)
})

test('Paper JVM canonical-byte provider chỉ compose codec vào observer contract', async () => {
  const source = await readFile('src/paper-jvm-observation-byte-provider.ts', 'utf8')
  const capabilitySource = await readFile('src/capability-manifest.ts', 'utf8')
  assert.doesNotMatch(source, /node:http|node:net|node:fs|fetch\s*\(|process\.env|PrivateKey|Signature|verifyAndConsume|consume\s*\(/)
  assert.doesNotMatch(source, /PaperJvmObservationPort|org\.bukkit|io\.papermc|createServer|TestRun|TestReport|ServerSocket/)
  assert.match(source, /parseCanonicalPaperJvmObservationResultV1/)
  assert.match(source, /SignedProviderObservationProvider/)
  assert.match(source, /Paper observation byte source failed/)
  assert.match(
    capabilitySource,
    /paper-jvm-observation-byte-provider[\s\S]*PaperJvmObservationResultCodec\.java/
  )

  const sourceFiles = (await readdir('src', { recursive: true }))
    .filter(file => file.endsWith('.ts') && !file.endsWith('paper-jvm-observation-byte-provider.ts'))
    .map(file => `src/${file}`)
  const importers: string[] = []
  for (const file of sourceFiles) {
    const candidate = await readFile(file, 'utf8')
    if (/(?:from\s+['"][^'"]*paper-jvm-observation-byte-provider|(?:import|require)\(\s*['"][^'"]*paper-jvm-observation-byte-provider)/.test(candidate)) {
      importers.push(file)
    }
  }
  assert.deepEqual(importers, [])
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

test('opaque signing adapter chỉ có observer pipeline library-only làm importer', async () => {
  const source = await readFile('src/signed-provider-signing-adapter.ts', 'utf8')
  assert.doesNotMatch(source, /node:fs|process\.env|createPrivateKey|PrivateKey|PKCS|JKS|PEM|KeyStore/)
  assert.doesNotMatch(source, /SignedProviderClaimVerifier|verifyAndConsume|runner|report|server|Paper|Bukkit/)
  assert.match(source, /verifyCanonicalSignedProviderClaimSignature/)

  const sourceFiles = (await readdir('src', { recursive: true }))
    .filter(file => file.endsWith('.ts') && !file.endsWith('signed-provider-signing-adapter.ts'))
    .map(file => `src/${file}`)
  const importers: string[] = []
  for (const file of sourceFiles) {
    const runtimeSource = await readFile(file, 'utf8')
    if (/(?:from\s+['"][^'"]*signed-provider-signing-adapter|(?:import|require)\(\s*['"][^'"]*signed-provider-signing-adapter)/.test(runtimeSource)) {
      importers.push(file)
    }
  }
  assert.deepEqual(importers, ['src/signed-provider-observer-signing-pipeline.ts'])
  const pipeline = await readFile(importers[0]!, 'utf8')
  assert.doesNotMatch(
    pipeline,
    /node:fs|process\.env|from\s+['"][^'"]*\/(?:runner|report|server)\.js['"]|Paper|Bukkit|verifyAndConsume/
  )
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
  assert.deepEqual(importers, [
    'src/google-cloud-kms-hsm-trust-root-policy-attestation.ts',
    'src/google-cloud-kms-live-preflight.ts'
  ])
})

test('Google Cloud KMS live preflight chỉ là manual CLI, không có app runtime wiring', async () => {
  const preflight = await readFile('src/google-cloud-kms-live-preflight.ts', 'utf8')
  assert.doesNotMatch(preflight, /runner|report|server|Paper|Bukkit|verifyAndConsume|node:fs|process\.env/)
  assert.doesNotMatch(
    preflight,
    /attestAndVerifyGoogleCloudKmsHsmEd25519KeyBinding|verifyGoogleCloudKmsHsmEd25519KeyAttestationBinding|requiredAttestationBinding|CALLER_PINNED_CAVIUM_V2/
  )

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
  const d4bFixture = await readFile(
    'test/fixtures/google-cloud-kms-attestation-d4b-negative-fixture.ts',
    'utf8'
  )
  assert.doesNotMatch(source, /node:fs|node:child_process|fetch\(|https?:|process\.env/)
  assert.doesNotMatch(source, /createPrivateKey|generateKeyPair|BEGIN PRIVATE KEY/)
  assert.doesNotMatch(source, /google-cloud-kms-live-preflight|server|runner|report|Paper|Bukkit/)
  assert.doesNotMatch(d4bFixture, /BEGIN PRIVATE KEY|BEGIN ENCRYPTED PRIVATE KEY/)

  const productionFiles = [
    ...(await readdir('src', { recursive: true }))
      .filter(file => file.endsWith('.ts')
        && !file.endsWith('google-cloud-kms-hsm-attestation-verifier.ts')
        && !file.endsWith('google-cloud-kms-hsm-attestation-binding-verifier.ts'))
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

test('Cavium V2 statement parser chỉ là library, không có runtime hoặc network wiring', async () => {
  const source = await readFile('src/cavium-v2-attestation-statement-parser.ts', 'utf8')
  assert.doesNotMatch(source, /node:fs|node:child_process|fetch\(|https?:|process\.env/)
  assert.doesNotMatch(source, /createPrivateKey|generateKeyPair|BEGIN PRIVATE KEY/)
  assert.doesNotMatch(source, /google-cloud-kms-live-preflight|server|runner|report|Paper|Bukkit/)

  const productionFiles = [
    ...(await readdir('src', { recursive: true }))
      .filter(file => file.endsWith('.ts')
        && !file.endsWith('cavium-v2-attestation-statement-parser.ts')
        && !file.endsWith('google-cloud-kms-hsm-attestation-binding-verifier.ts'))
      .map(file => `src/${file}`),
    ...(await readdir('scripts', { recursive: true }))
      .filter(file => /\.(?:[cm]?js|ts)$/.test(file))
      .map(file => `scripts/${file}`)
  ]
  const importers: string[] = []
  for (const file of productionFiles) {
    const runtimeSource = await readFile(file, 'utf8')
    if (/(?:from\s+['"][^'"]*cavium-v2-attestation-statement-parser|(?:import|require)\(\s*['"][^'"]*cavium-v2-attestation-statement-parser)/.test(runtimeSource)) {
      importers.push(file)
    }
  }
  assert.deepEqual(importers, [])
})

test('D4c-b attestation binding compositor chỉ có exact signing-backend importer', async () => {
  const source = await readFile('src/google-cloud-kms-hsm-attestation-binding-verifier.ts', 'utf8')
  const fixture = await readFile(
    'test/fixtures/google-cloud-kms-attestation-d4cb-fixture.ts',
    'utf8'
  )
  assert.match(source, /from '.\/google-cloud-kms-hsm-attestation-verifier\.js'/)
  assert.match(source, /from '.\/cavium-v2-attestation-statement-parser\.js'/)
  assert.doesNotMatch(source, /node:fs|node:child_process|fetch\(|https?:|process\.env/)
  assert.doesNotMatch(source, /createPrivateKey|generateKeyPair|BEGIN PRIVATE KEY/)
  assert.doesNotMatch(source, /google-cloud-kms-live-preflight|server|runner|report|Paper|Bukkit/)
  assert.doesNotMatch(fixture, /BEGIN PRIVATE KEY|BEGIN ENCRYPTED PRIVATE KEY/)

  const productionFiles = [
    ...(await readdir('src', { recursive: true }))
      .filter(file => file.endsWith('.ts')
        && !file.endsWith('google-cloud-kms-hsm-attestation-binding-verifier.ts'))
      .map(file => `src/${file}`),
    ...(await readdir('scripts', { recursive: true }))
      .filter(file => /\.(?:[cm]?js|ts)$/.test(file))
      .map(file => `scripts/${file}`)
  ]
  const importers: string[] = []
  for (const file of productionFiles) {
    const runtimeSource = await readFile(file, 'utf8')
    if (/(?:from\s+['"][^'"]*google-cloud-kms-hsm-attestation-binding-verifier|(?:import|require)\(\s*['"][^'"]*google-cloud-kms-hsm-attestation-binding-verifier)/.test(runtimeSource)) {
      importers.push(file)
    }
  }
  assert.deepEqual(importers, ['src/google-cloud-kms-signing-backend.ts'])
})

test('Google Cloud KMS resource-name validator chỉ được exact KMS libraries import', async () => {
  const source = await readFile('src/google-cloud-kms-resource-name.ts', 'utf8')
  assert.doesNotMatch(source, /node:fs|node:child_process|fetch\(|https?:|process\.env/)
  const importers: string[] = []
  for (const file of (await readdir('src', { recursive: true }))
    .filter(file => file.endsWith('.ts') && !file.endsWith('google-cloud-kms-resource-name.ts'))
    .map(file => `src/${file}`)) {
    const runtimeSource = await readFile(file, 'utf8')
    if (/(?:from\s+['"][^'"]*google-cloud-kms-resource-name|(?:import|require)\(\s*['"][^'"]*google-cloud-kms-resource-name)/.test(runtimeSource)) {
      importers.push(file)
    }
  }
  assert.deepEqual(importers.sort(), [
    'src/google-cloud-kms-hsm-attestation-binding-verifier.ts',
    'src/google-cloud-kms-live-preflight.ts',
    'src/google-cloud-kms-signing-backend.ts'
  ])
})

test('D4d trust-root policy và compositor giữ exact library-only import graph', async () => {
  const policySource = await readFile('src/google-cloud-kms-hsm-trust-root-policy.ts', 'utf8')
  const compositorSource = await readFile(
    'src/google-cloud-kms-hsm-trust-root-policy-attestation.ts',
    'utf8'
  )
  for (const source of [policySource, compositorSource]) {
    assert.doesNotMatch(source, /node:fs|node:child_process|fetch\(|https?:|process\.env/)
    assert.doesNotMatch(source, /createPrivateKey|generateKeyPair|BEGIN PRIVATE KEY/)
    assert.doesNotMatch(source, /createGoogleCloudKmsAdcClient|asymmetricSign\(/)
  }
  const sourceFiles = (await readdir('src', { recursive: true }))
    .filter(file => file.endsWith('.ts'))
    .map(file => `src/${file}`)
  const policyImporters: string[] = []
  const compositorImporters: string[] = []
  for (const file of sourceFiles) {
    const source = await readFile(file, 'utf8')
    if (file !== 'src/google-cloud-kms-hsm-trust-root-policy.ts'
      && /from ['"][^'"]*google-cloud-kms-hsm-trust-root-policy\.js['"]/.test(source)) {
      policyImporters.push(file)
    }
    if (file !== 'src/google-cloud-kms-hsm-trust-root-policy-attestation.ts'
      && /from ['"][^'"]*google-cloud-kms-hsm-trust-root-policy-attestation\.js['"]/.test(source)) {
      compositorImporters.push(file)
    }
  }
  assert.deepEqual(policyImporters, ['src/google-cloud-kms-hsm-trust-root-policy-attestation.ts'])
  assert.deepEqual(compositorImporters, [])
})

test('P0.4 signed-provider bundle verifier giữ library-only import graph', async () => {
  const moduleName = 'signed-provider-evidence-bundle'
  const source = await readFile(`src/${moduleName}.ts`, 'utf8')
  assert.doesNotMatch(
    source,
    /node:child_process|process\.env|createPrivateKey|generateKeyPair|KeyManagementServiceClient|asymmetricSign\s*\(/
  )
  assert.doesNotMatch(source, /from\s+['"].*(?:runner|server|report-persistence)/)

  const productionFiles = [
    ...(await readdir('src', { recursive: true }))
      .filter(file => file.endsWith('.ts') && !file.endsWith(`${moduleName}.ts`))
      .map(file => `src/${file}`),
    ...(await readdir('scripts', { recursive: true }))
      .filter(file => /\.(?:[cm]?js|ts)$/.test(file))
      .map(file => `scripts/${file}`)
  ]
  const importers: string[] = []
  for (const file of productionFiles) {
    const runtimeSource = await readFile(file, 'utf8')
    if (/(?:from\s+['"][^'"]*signed-provider-evidence-bundle|(?:import|require)\(\s*['"][^'"]*signed-provider-evidence-bundle)/.test(runtimeSource)) {
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
