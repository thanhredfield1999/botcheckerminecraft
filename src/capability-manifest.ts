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

export interface CapabilityManifest {
  schemaVersion: 1
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

  const runtime = {
    node: boundedName(facts.runtime.node, 'Node version'),
    platform: boundedName(facts.runtime.platform, 'runtime platform'),
    arch: boundedName(facts.runtime.arch, 'runtime architecture')
  }
  const sourceFingerprint = sha256(JSON.stringify({ codeRoot, sources }))
  if (!SHA256_PATTERN.test(sourceFingerprint)) throw new Error('Invalid source fingerprint')

  return {
    schemaVersion: 1,
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
}

const CAPABILITY_MODULES: Readonly<Record<string, { module: string; mode: 'runtime-wired' | 'library-only' }>> = {
  'compatibility-matrix': { module: 'compatibility-matrix', mode: 'library-only' },
  'crash-recovery': { module: 'crash-recovery-contract', mode: 'library-only' },
  'evidence-bundle': { module: 'evidence-bundle', mode: 'runtime-wired' },
  'failure-envelope': { module: 'failure-envelope', mode: 'runtime-wired' },
  gameplay: { module: 'gameplay-contract', mode: 'library-only' },
  'gui-journey': { module: 'runner', mode: 'runtime-wired' },
  'immutable-artifacts': { module: 'evidence-writer', mode: 'runtime-wired' },
  'livingnpc-telemetry': { module: 'livingnpc-telemetry', mode: 'library-only' },
  'multi-account': { module: 'multi-account-runner', mode: 'library-only' },
  'multi-client': { module: 'multi-client-runner', mode: 'library-only' },
  persistence: { module: 'persistence-contract', mode: 'library-only' },
  'protocol-diagnostics': { module: 'protocol-diagnostic', mode: 'runtime-wired' },
  'route-oracle': { module: 'route-oracle', mode: 'runtime-wired' },
  'signed-provider-claim': { module: 'signed-provider-claim', mode: 'library-only' },
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
    capabilities: Object.fromEntries(Object.entries(CAPABILITY_MODULES)
      .filter(([, capability]) => sourcePaths.has(`${codeRoot}/${capability.module}${codeRoot === 'src' ? '.ts' : '.js'}`))
      .map(([name, capability]) => [name, capability.mode])),
    sources
  })
}

let runtimeManifest: CapabilityManifest | undefined

export function runtimeCapabilityManifest(): CapabilityManifest {
  runtimeManifest ??= collectRuntimeCapabilityManifest()
  return runtimeManifest
}
