import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const GIT_COMMIT_PATTERN = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/
const NAME_PATTERN = /^[a-zA-Z0-9@][a-zA-Z0-9@/._:+-]{0,127}$/
const CAPABILITY_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/
const MAX_SOURCE_FILES = 256
const MAX_SOURCE_BYTES = 2 * 1024 * 1024
const MAX_TOTAL_SOURCE_BYTES = 32 * 1024 * 1024
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024

interface CapabilityManifestBase {
  git: { commit: string; dirty: boolean }
  runtime: { node: string; platform: string; arch: string }
  codeRoot: string
  packageJsonSha256: string
  loadedPackageJson: { path: string; sha256: string }
  packageLockSha256: string
  sourceFingerprint: string
  sources: Array<{ path: string; sha256: string }>
  dependencies: Array<{ name: string; version: string }>
  capabilities: Array<{ name: string; mode: 'runtime-wired' | 'library-only' }>
}

export interface AuxiliaryCodeManifest {
  component: string
  sourceRoot: string
  outputRoot: string
  mode: 'source-only' | 'source-and-compiled'
  buildScript: { path: string; sha256: string }
  sources: Array<{ path: string; sha256: string }>
  compiled: Array<{ path: string; sha256: string }>
}

export interface CapabilityManifestV1 extends CapabilityManifestBase {
  schemaVersion: 1
  auxiliaryCode?: never
}

export interface CapabilityManifestV2 extends CapabilityManifestBase {
  schemaVersion: 2
  auxiliaryCode: AuxiliaryCodeManifest[]
}

export type CapabilityManifest = CapabilityManifestV1 | CapabilityManifestV2

export interface CapabilityManifestFacts {
  packageJson: string | Uint8Array
  packageLock: string | Uint8Array
  git: { commit: string; dirty: boolean }
  runtime: { node: string; platform: string; arch: string }
  codeRoot: string
  loadedPackageJson: { path: string; content: string | Uint8Array }
  dependencies: Readonly<Record<string, string>>
  capabilities: Readonly<Record<string, 'runtime-wired' | 'library-only'>>
  sources: ReadonlyArray<{ path: string; content: string | Uint8Array }>
  auxiliaryCode?: ReadonlyArray<{
    component: string
    sourceRoot: string
    outputRoot: string
    mode: 'source-only' | 'source-and-compiled'
    buildScript: { path: string; content: string | Uint8Array }
    sources: ReadonlyArray<{ path: string; content: string | Uint8Array }>
    compiled: ReadonlyArray<{ path: string; content: string | Uint8Array }>
  }>
}

function bytes(value: string | Uint8Array): Buffer {
  return Buffer.from(value)
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(bytes(value)).digest('hex')
}

function boundedName(value: string, label: string, pattern = NAME_PATTERN): string {
  const normalized = value.trim()
  if (!pattern.test(normalized)) throw new Error(`Invalid ${label}: ${value}`)
  return normalized
}

function sourcePath(value: string): string {
  const normalized = value.replaceAll('\\', '/')
  if (
    normalized.length === 0
    || normalized.length > 200
    || normalized.startsWith('/')
    || /^[a-zA-Z]:/.test(normalized)
    || path.posix.normalize(normalized) !== normalized
    || normalized.split('/').some(part => part === '..' || part.length === 0)
  ) {
    throw new Error(`Invalid source path: ${value}`)
  }
  return normalized
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`)
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function buildCapabilityManifest(facts: CapabilityManifestFacts): CapabilityManifest {
  const commit = facts.git.commit.trim().toLocaleLowerCase()
  if (!GIT_COMMIT_PATTERN.test(commit)) throw new Error(`Invalid Git commit: ${facts.git.commit}`)

  const packageJson = bytes(facts.packageJson)
  const packageLock = bytes(facts.packageLock)
  const loadedPackageJson = bytes(facts.loadedPackageJson.content)
  if (packageJson.byteLength > MAX_PACKAGE_BYTES) throw new Error('package.json exceeds capability manifest bound')
  if (packageLock.byteLength > MAX_PACKAGE_BYTES) throw new Error('package-lock.json exceeds capability manifest bound')
  if (loadedPackageJson.byteLength > MAX_PACKAGE_BYTES) throw new Error('Loaded package.json exceeds capability manifest bound')
  if (facts.sources.length === 0 || facts.sources.length > MAX_SOURCE_FILES) throw new Error('Source file count exceeds capability manifest bound')
  const capabilityEntries = Object.entries(facts.capabilities)
  if (capabilityEntries.length === 0 || capabilityEntries.length > 64) throw new Error('Capability count exceeds bound')

  const codeRoot = sourcePath(facts.codeRoot)
  const loadedPackageJsonPath = sourcePath(facts.loadedPackageJson.path)
  const expectedLoadedPackageJsonPath = codeRoot === 'src' ? 'package.json' : `${codeRoot.split('/')[0]}/package.json`
  if (loadedPackageJsonPath !== expectedLoadedPackageJsonPath) {
    throw new Error(`Loaded package.json path does not match code root: ${loadedPackageJsonPath}`)
  }
  let totalSourceBytes = 0
  const sources = facts.sources.map(source => {
    const content = bytes(source.content)
    if (content.byteLength > MAX_SOURCE_BYTES) throw new Error(`Source exceeds byte bound: ${source.path}`)
    totalSourceBytes += content.byteLength
    return { path: sourcePath(source.path), sha256: sha256(content) }
  }).sort((left, right) => compareText(left.path, right.path))
  if (totalSourceBytes > MAX_TOTAL_SOURCE_BYTES) throw new Error('Total source bytes exceed capability manifest bound')
  assertUnique(sources.map(source => source.path), 'source path')
  if (!sources.every(source => source.path.startsWith(`${codeRoot}/`))) {
    throw new Error(`Capability source is outside code root: ${codeRoot}`)
  }

  const dependencies = Object.entries(facts.dependencies).map(([name, version]) => ({
    name: boundedName(name, 'dependency name'),
    version: boundedName(version, 'dependency version')
  })).sort((left, right) => compareText(left.name, right.name))
  if (dependencies.length > 128) throw new Error('Dependency count exceeds bound')
  assertUnique(dependencies.map(dependency => dependency.name), 'dependency name')

  const capabilities = capabilityEntries.map(([name, mode]) => ({
    name: boundedName(name, 'capability', CAPABILITY_PATTERN),
    mode
  })).sort((left, right) => compareText(left.name, right.name))
  assertUnique(capabilities.map(capability => capability.name), 'capability')

  let totalAuxiliaryBytes = 0
  const hashAuxiliary = (value: string | Uint8Array, label: string): string => {
    const content = bytes(value)
    if (content.byteLength > MAX_SOURCE_BYTES) throw new Error(`Auxiliary ${label} exceeds byte bound`)
    totalAuxiliaryBytes += content.byteLength
    if (totalAuxiliaryBytes > MAX_TOTAL_SOURCE_BYTES) {
      throw new Error('Auxiliary total byte bound exceeded')
    }
    return sha256(content)
  }
  if (facts.auxiliaryCode !== undefined && facts.auxiliaryCode.length === 0) {
    throw new Error('Auxiliary code must not be explicitly empty')
  }
  const auxiliaryFacts = [...(facts.auxiliaryCode ?? [])]
  if (auxiliaryFacts.length > 8) throw new Error('Auxiliary component count exceeds bound')
  const auxiliaryCode = auxiliaryFacts.map(component => {
    const componentName = boundedName(component.component, 'auxiliary component', CAPABILITY_PATTERN)
    const sourceRoot = sourcePath(component.sourceRoot)
    const outputRoot = sourcePath(component.outputRoot)
    const buildScriptPath = sourcePath(component.buildScript.path)
    if (sourceRoot === outputRoot) throw new Error('Auxiliary source root and output root must be distinct')
    if (!buildScriptPath.startsWith('scripts/')) {
      throw new Error('Auxiliary build script must be under scripts/')
    }
    if (component.sources.length === 0 || component.sources.length > 64 || component.compiled.length > 128) {
      throw new Error('Auxiliary code file count exceeds bound')
    }
    const auxiliarySources = component.sources.map(source => ({
      path: sourcePath(source.path), sha256: hashAuxiliary(source.content, 'source')
    })).sort((left, right) => compareText(left.path, right.path))
    const compiled = component.compiled.map(file => ({
      path: sourcePath(file.path), sha256: hashAuxiliary(file.content, 'compiled file')
    })).sort((left, right) => compareText(left.path, right.path))
    if (!auxiliarySources.every(source => source.path.startsWith(`${sourceRoot}/`))) {
      throw new Error(`Auxiliary source is outside source root: ${sourceRoot}`)
    }
    if (!compiled.every(file => file.path.startsWith(`${outputRoot}/`))) {
      throw new Error(`Auxiliary compiled file is outside output root: ${outputRoot}`)
    }
    if ((component.mode === 'source-only') !== (compiled.length === 0)) {
      throw new Error('Auxiliary code mode does not match compiled artifacts')
    }
    assertUnique(auxiliarySources.map(source => source.path), 'auxiliary source path')
    assertUnique(compiled.map(file => file.path), 'auxiliary compiled path')
    return {
      component: componentName,
      sourceRoot,
      outputRoot,
      mode: component.mode,
      buildScript: {
        path: buildScriptPath,
        sha256: hashAuxiliary(component.buildScript.content, 'build script')
      },
      sources: auxiliarySources,
      compiled
    }
  }).sort((left, right) => compareText(left.component, right.component))
  assertUnique(auxiliaryCode.map(component => component.component), 'auxiliary component')

  const runtime = {
    node: boundedName(facts.runtime.node, 'Node version'),
    platform: boundedName(facts.runtime.platform, 'runtime platform'),
    arch: boundedName(facts.runtime.arch, 'runtime architecture')
  }
  const sourceFingerprint = sha256(JSON.stringify(auxiliaryCode.length > 0
    ? { schemaVersion: 2, codeRoot, sources, auxiliaryCode }
    : { codeRoot, sources }))
  if (!SHA256_PATTERN.test(sourceFingerprint)) throw new Error('Invalid source fingerprint')

  const common = {
    git: { commit, dirty: facts.git.dirty },
    runtime,
    codeRoot,
    packageJsonSha256: sha256(packageJson),
    loadedPackageJson: { path: loadedPackageJsonPath, sha256: sha256(loadedPackageJson) },
    packageLockSha256: sha256(packageLock),
    sourceFingerprint,
    sources,
    dependencies,
    capabilities
  }
  return auxiliaryCode.length > 0
    ? { schemaVersion: 2, ...common, auxiliaryCode }
    : { schemaVersion: 1, ...common }
}

const CAPABILITY_MODULES: Readonly<Record<string, { module: string; mode: 'runtime-wired' | 'library-only' }>> = {
  'compatibility-matrix': { module: 'compatibility-matrix', mode: 'library-only' },
  'crash-recovery': { module: 'crash-recovery-contract', mode: 'library-only' },
  'evidence-bundle': { module: 'evidence-bundle', mode: 'runtime-wired' },
  'failure-envelope': { module: 'failure-envelope', mode: 'runtime-wired' },
  gameplay: { module: 'gameplay-contract', mode: 'library-only' },
  'google-cloud-kms-hsm-ed25519-signer': {
    module: 'google-cloud-kms-signing-backend',
    mode: 'library-only'
  },
  'google-cloud-kms-hsm-attestation-envelope-verifier': {
    module: 'google-cloud-kms-hsm-attestation-verifier',
    mode: 'library-only'
  },
  'google-cloud-kms-hsm-cavium-v2-statement-parser': {
    module: 'cavium-v2-attestation-statement-parser',
    mode: 'library-only'
  },
  'google-cloud-kms-hsm-attestation-binding-verifier': {
    module: 'google-cloud-kms-hsm-attestation-binding-verifier',
    mode: 'library-only'
  },
  'google-cloud-kms-hsm-attestation-snapshot-bridge': {
    module: 'google-cloud-kms-signing-backend',
    mode: 'library-only'
  },
  'google-cloud-kms-hsm-trust-root-policy': {
    module: 'google-cloud-kms-hsm-trust-root-policy',
    mode: 'library-only'
  },
  'google-cloud-kms-hsm-policy-attestation-bridge': {
    module: 'google-cloud-kms-hsm-trust-root-policy-attestation',
    mode: 'library-only'
  },
  'google-cloud-kms-hsm-live-preflight': {
    module: 'google-cloud-kms-live-preflight',
    mode: 'library-only'
  },
  'gui-journey': { module: 'runner', mode: 'runtime-wired' },
  'immutable-artifacts': { module: 'evidence-writer', mode: 'runtime-wired' },
  'jvm-artifact-observation-assessment': { module: 'jvm-artifact-observation', mode: 'library-only' },
  'livingnpc-telemetry': { module: 'livingnpc-telemetry', mode: 'library-only' },
  'multi-account': { module: 'multi-account-runner', mode: 'library-only' },
  'multi-client': { module: 'multi-client-runner', mode: 'library-only' },
  persistence: { module: 'persistence-contract', mode: 'library-only' },
  'protocol-diagnostics': { module: 'protocol-diagnostic', mode: 'runtime-wired' },
  'route-oracle': { module: 'route-oracle', mode: 'runtime-wired' },
  'signed-provider-claim': { module: 'signed-provider-claim', mode: 'library-only' },
  'signed-provider-canonical-signature-verification': {
    module: 'signed-provider-claim',
    mode: 'library-only'
  },
  'signed-provider-evidence-bundle-verifier': {
    module: 'signed-provider-evidence-bundle',
    mode: 'library-only'
  },
  'signed-provider-opaque-signing-adapter': {
    module: 'signed-provider-signing-adapter',
    mode: 'library-only'
  },
  'signed-provider-observer-signing-pipeline': {
    module: 'signed-provider-observer-signing-pipeline',
    mode: 'library-only'
  },
  'signed-provider-observation-bound-claim': {
    module: 'signed-provider-claim',
    mode: 'library-only'
  },
  'signed-provider-shared-challenge-state': {
    module: 'signed-provider-challenge-store',
    mode: 'library-only'
  },
  'target-artifact-binding': { module: 'target-binding', mode: 'runtime-wired' },
  transaction: { module: 'transaction-contract', mode: 'library-only' }
}

function stableReadFile(file: string): Buffer {
  const before = lstatSync(file)
  if (!before.isFile() || before.isSymbolicLink()) throw new Error(`Capability file must be a regular file: ${file}`)
  if (before.size > MAX_SOURCE_BYTES) throw new Error(`Capability file exceeds byte bound: ${file}`)
  const content = readFileSync(file)
  const after = lstatSync(file)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) {
    throw new Error(`Capability file changed while reading: ${file}`)
  }
  return content
}

function collectCodeFiles(rootDir: string, codeRoot: string): Array<{ path: string; content: Buffer }> {
  const absoluteCodeRoot = path.join(rootDir, codeRoot)
  const collected: Array<{ path: string; content: Buffer }> = []
  const extension = codeRoot === 'src' ? '.ts' : '.js'
  const visit = (directory: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name))
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name)
      const stat = lstatSync(absolute)
      if (stat.isSymbolicLink()) throw new Error(`Capability source symlink is not allowed: ${absolute}`)
      if (stat.isDirectory()) {
        visit(absolute)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith(extension)) continue
      collected.push({
        path: path.relative(rootDir, absolute).replaceAll('\\', '/'),
        content: stableReadFile(absolute)
      })
      if (collected.length > MAX_SOURCE_FILES) throw new Error('Source file count exceeds capability manifest bound')
    }
  }
  visit(absoluteCodeRoot)
  return collected
}

function collectFilesByExtension(
  rootDir: string,
  relativeRoot: string,
  extension: string,
  required: boolean
): Array<{ path: string; content: Buffer }> {
  const absoluteRoot = path.join(rootDir, relativeRoot)
  try {
    const rootStat = lstatSync(absoluteRoot)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error(`Auxiliary code root must be a regular directory: ${absoluteRoot}`)
    }
  } catch (error) {
    if (!required && (error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const collected: Array<{ path: string; content: Buffer }> = []
  const visit = (directory: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareText(left.name, right.name))
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name)
      const stat = lstatSync(absolute)
      if (stat.isSymbolicLink()) throw new Error(`Auxiliary code symlink is not allowed: ${absolute}`)
      if (stat.isDirectory()) {
        visit(absolute)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith(extension)) continue
      collected.push({
        path: path.relative(rootDir, absolute).replaceAll('\\', '/'),
        content: stableReadFile(absolute)
      })
      if (collected.length > 128) throw new Error('Auxiliary code file count exceeds bound')
    }
  }
  visit(absoluteRoot)
  return collected
}

function directDependencyVersions(packageJsonText: string, packageLockText: string): Record<string, string> {
  const packageJson = JSON.parse(packageJsonText) as { dependencies?: Record<string, string> }
  const packageLock = JSON.parse(packageLockText) as { packages?: Record<string, { version?: string }> }
  const result: Record<string, string> = {}
  for (const name of Object.keys(packageJson.dependencies ?? {}).sort()) {
    const version = packageLock.packages?.[`node_modules/${name}`]?.version
    if (typeof version !== 'string') throw new Error(`Exact locked dependency version unavailable: ${name}`)
    result[name] = version
  }
  return result
}

export interface RuntimeCapabilityManifestOptions {
  rootDir?: string
}

function gitOutput(rootDir: string, args: string[], maxBuffer: number): string {
  return execFileSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer,
    windowsHide: true
  })
}

export function collectRuntimeCapabilityManifest(options: RuntimeCapabilityManifestOptions = {}): CapabilityManifest {
  const rootDir = path.resolve(options.rootDir ?? process.cwd())
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const relativeModuleDir = path.relative(rootDir, moduleDir).replaceAll('\\', '/')
  if (relativeModuleDir !== 'src' && relativeModuleDir !== 'dist/src') {
    throw new Error(`Capability module is outside supported code roots: ${relativeModuleDir}`)
  }
  const codeRoot = relativeModuleDir
  const commitBefore = gitOutput(rootDir, ['rev-parse', 'HEAD'], 64 * 1024).trim()
  const statusBefore = gitOutput(rootDir, ['status', '--porcelain=v1', '--untracked-files=all'], 1024 * 1024)
  const packageJson = stableReadFile(path.join(rootDir, 'package.json'))
  const packageLock = stableReadFile(path.join(rootDir, 'package-lock.json'))
  const loadedPackageJsonPath = codeRoot === 'src' ? 'package.json' : 'dist/package.json'
  const loadedPackageJson = stableReadFile(path.join(rootDir, loadedPackageJsonPath))
  const sources = collectCodeFiles(rootDir, codeRoot)
  const javaSources = collectFilesByExtension(rootDir, 'java-src', '.java', true)
  const javaCompiled = codeRoot === 'dist/src'
    ? collectFilesByExtension(rootDir, 'dist/java', '.class', true)
    : []
  const javaBuildScript = stableReadFile(path.join(rootDir, 'scripts/build-java.mjs'))
  const commitAfter = gitOutput(rootDir, ['rev-parse', 'HEAD'], 64 * 1024).trim()
  const statusAfter = gitOutput(rootDir, ['status', '--porcelain=v1', '--untracked-files=all'], 1024 * 1024)
  if (commitAfter !== commitBefore || statusAfter !== statusBefore) {
    throw new Error('Git HEAD or working tree changed while collecting capability manifest')
  }
  const sourcePaths = new Set(sources.map(source => source.path))

  return buildCapabilityManifest({
    packageJson,
    packageLock,
    git: { commit: commitAfter, dirty: statusAfter.length > 0 },
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    codeRoot,
    loadedPackageJson: { path: loadedPackageJsonPath, content: loadedPackageJson },
    dependencies: directDependencyVersions(packageJson.toString('utf8'), packageLock.toString('utf8')),
    capabilities: Object.fromEntries([
      ...Object.entries(CAPABILITY_MODULES)
        .filter(([, capability]) => sourcePaths.has(`${codeRoot}/${capability.module}${codeRoot === 'src' ? '.ts' : '.js'}`))
        .map(([name, capability]) => [name, capability.mode] as const),
      ['jvm-artifact-observer', 'library-only'] as const,
      ...(javaSources.some(source => source.path
        === 'java-src/vn/heomc/botchecker/probe/JvmObservationBoundClaimBuilder.java')
        ? [['jvm-observation-bound-claim-builder', 'library-only'] as const]
        : []),
      ...(javaSources.some(source => source.path
        === 'java-src/vn/heomc/botchecker/probe/PaperJvmObservationPort.java')
        ? [['paper-jvm-observation-port', 'library-only'] as const]
        : []),
      ...(javaSources.some(source => source.path
        === 'java-src/vn/heomc/botchecker/probe/PaperJvmObservationClaimBridge.java')
        ? [['paper-jvm-observation-claim-bridge', 'library-only'] as const]
        : []),
      ...(sourcePaths.has(`${codeRoot}/paper-jvm-observation-result-codec${codeRoot === 'src' ? '.ts' : '.js'}`)
        && javaSources.some(source => source.path
          === 'java-src/vn/heomc/botchecker/probe/PaperJvmObservationResultCodec.java')
        ? [['paper-jvm-observation-result-codec', 'library-only'] as const]
        : []),
      ...(sourcePaths.has(`${codeRoot}/paper-jvm-observation-byte-provider${codeRoot === 'src' ? '.ts' : '.js'}`)
        && sourcePaths.has(`${codeRoot}/paper-jvm-observation-result-codec${codeRoot === 'src' ? '.ts' : '.js'}`)
        && sourcePaths.has(`${codeRoot}/signed-provider-observer-signing-pipeline${codeRoot === 'src' ? '.ts' : '.js'}`)
        && javaSources.some(source => source.path
          === 'java-src/vn/heomc/botchecker/probe/PaperJvmObservationResultCodec.java')
        ? [['paper-jvm-observation-byte-provider', 'library-only'] as const]
        : [])
    ]),
    sources,
    auxiliaryCode: [{
      component: 'jvm-artifact-observer',
      sourceRoot: 'java-src',
      outputRoot: 'dist/java',
      mode: codeRoot === 'src' ? 'source-only' : 'source-and-compiled',
      buildScript: { path: 'scripts/build-java.mjs', content: javaBuildScript },
      sources: javaSources,
      compiled: javaCompiled
    }]
  })
}

let runtimeManifest: CapabilityManifest | undefined

export function runtimeCapabilityManifest(): CapabilityManifest {
  runtimeManifest ??= collectRuntimeCapabilityManifest()
  return runtimeManifest
}
