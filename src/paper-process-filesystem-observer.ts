import { createHash } from 'node:crypto'
import fs, { type BigIntStats } from 'node:fs'
import path from 'node:path'
import { types } from 'node:util'
import { z } from 'zod'
import {
  assertPaperProcessProvider,
  type PaperProcessDryRunPreview,
  type PaperProcessProvider
} from './paper-process-provider.js'
import {
  artifactTargetBindingSha256,
  validateArtifactTargetBinding,
  type ArtifactTargetBinding
} from './target-binding.js'

const MAX_ARTIFACT_BYTES = 128 * 1024 * 1024
const MAX_AGGREGATE_BYTES = 256 * 1024 * 1024
const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key|bearer)/i
const PRODUCTION_ROOT_PARTS = new Set(['live', 'prod', 'production', 'server', 'minecraftserver'])
const observationCapabilities = new WeakSet<object>()

const absoluteRootSchema = z.string().min(1).max(1024).superRefine((value, context) => {
  if (value !== value.normalize('NFC')
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
    || path.normalize(value) !== value
    || value === path.parse(value).root
    || CREDENTIAL_PATTERN.test(value)
    || value.split(/[\\/]+/).some(part => PRODUCTION_ROOT_PARTS.has(part.toLowerCase()))) {
    context.addIssue({ code: 'custom', message: 'Invalid approved root' })
  }
})
const configSchema = z.strictObject({
  schemaVersion: z.literal(1),
  approvedRoot: absoluteRootSchema,
  targetBinding: z.unknown()
})

export interface PaperProcessFilesystemObservation {
  readonly schemaVersion: 1
  readonly root: string
  readonly targetBindingSha256: string
  readonly executableArtifactFileBytesObserved: true
  readonly configurationArtifactsObserved: false
  readonly observedArtifactRoles: readonly ('candidate' | 'paper' | 'probe')[]
  readonly filesystemObservationAtomic: false
  readonly filesystemObservationFreshness: 'not-established'
  readonly provesJvmLoadedBytes: false
  readonly artifactSha256: Readonly<{
    paper: string
    candidate: string
    probe?: string
  }>
}

export interface PaperProcessFilesystemObserver {
  observe(): Readonly<PaperProcessFilesystemObservation>
}

export type PaperProcessFilesystemDryRunPreview = Readonly<
  PaperProcessDryRunPreview & {
    readonly executableArtifactFileBytesObserved: true
    readonly configurationArtifactsObserved: false
    readonly observedArtifactRoles: readonly ('candidate' | 'paper' | 'probe')[]
    readonly filesystemObservationAtomic: false
    readonly filesystemObservationFreshness: 'not-established'
    readonly provesJvmLoadedBytes: false
  }
>

export class PaperProcessFilesystemObservationError extends Error {
  constructor() {
    super('Paper process filesystem observation rejected')
    this.name = 'PaperProcessFilesystemObservationError'
    Object.freeze(this)
  }
}

export class PaperProcessFilesystemPreflightError extends Error {
  constructor() {
    super('Paper process filesystem preflight rejected')
    this.name = 'PaperProcessFilesystemPreflightError'
    Object.freeze(this)
  }
}

interface PreparedArtifact {
  readonly role: 'paper' | 'candidate' | 'probe'
  readonly file: string
  readonly expectedSha256: string
  readonly before: BigIntStats
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function strictSnapshot(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || types.isProxy(input)) throw new Error()
  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) throw new Error()
  const actualKeys = Object.keys(input).sort(compareText)
  const expectedKeys = [...keys].sort(compareText)
  if (actualKeys.length !== expectedKeys.length
    || !actualKeys.every((value, index) => value === expectedKeys[index])) throw new Error()
  const snapshot: Record<string, unknown> = {}
  for (const key of keys) snapshot[key] = (input as Record<string, unknown>)[key]
  return snapshot
}

function parseConfiguration(input: unknown): z.infer<typeof configSchema> {
  return configSchema.parse(strictSnapshot(input, ['schemaVersion', 'approvedRoot', 'targetBinding']))
}

function assertCanonicalDirectory(directory: string): BigIntStats {
  const stat = fs.lstatSync(directory, { bigint: true })
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync.native(directory) !== directory) {
    throw new Error()
  }
  return stat
}

function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
}

function prepareArtifact(
  approvedRoot: string,
  logicalPath: string,
  role: PreparedArtifact['role'],
  expectedSha256: string
): PreparedArtifact {
  assertCanonicalDirectory(approvedRoot)
  const parts = logicalPath.split('/')
  let current = approvedRoot
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = path.join(current, parts[index]!)
    assertCanonicalDirectory(current)
  }
  const file = path.join(current, parts.at(-1)!)
  const relative = path.relative(approvedRoot, file)
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error()
  }
  const before = fs.lstatSync(file, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink()
    || before.nlink !== 1n
    || before.size <= 0n || before.size > BigInt(MAX_ARTIFACT_BYTES)
    || fs.realpathSync.native(file) !== file) {
    throw new Error()
  }
  return Object.freeze({ role, file, expectedSha256, before })
}

function readPreparedArtifact(prepared: PreparedArtifact, approvedRoot: string): string {
  const descriptor = fs.openSync(prepared.file, fs.constants.O_RDONLY)
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true })
    if (!opened.isFile() || opened.nlink !== 1n || !sameFile(prepared.before, opened)) throw new Error()
    const length = Number(opened.size)
    const content = Buffer.alloc(length)
    let offset = 0
    while (offset < length) {
      const read = fs.readSync(descriptor, content, offset, length - offset, offset)
      if (read <= 0) throw new Error()
      offset += read
    }
    const descriptorAfter = fs.fstatSync(descriptor, { bigint: true })
    if (!sameFile(opened, descriptorAfter)) throw new Error()

    const pathAfter = prepareArtifact(
      approvedRoot,
      path.relative(approvedRoot, prepared.file).split(path.sep).join('/'),
      prepared.role,
      prepared.expectedSha256
    )
    if (!sameFile(descriptorAfter, pathAfter.before)) throw new Error()
    const observedSha256 = createHash('sha256').update(content).digest('hex')
    if (observedSha256 !== prepared.expectedSha256) throw new Error()
    return observedSha256
  } finally {
    fs.closeSync(descriptor)
  }
}

function assertIssuedObservation(input: unknown): asserts input is Readonly<PaperProcessFilesystemObservation> {
  if (typeof input !== 'object' || input === null || !observationCapabilities.has(input)) throw new Error()
}

export function createPaperProcessFilesystemObserver(input: unknown): PaperProcessFilesystemObserver {
  try {
    const config = parseConfiguration(input)
    const binding = validateArtifactTargetBinding(config.targetBinding)
    if (binding.provider.kind !== 'paper-process') throw new Error()
    assertCanonicalDirectory(config.approvedRoot)
    const artifacts = binding.artifacts.filter(
      (artifact): artifact is ArtifactTargetBinding['artifacts'][number] & {
        role: 'paper' | 'candidate' | 'probe'
      } => artifact.role === 'paper' || artifact.role === 'candidate' || artifact.role === 'probe'
    )
    const targetBindingSha256 = artifactTargetBindingSha256(binding)
    const observer = {
      observe(): Readonly<PaperProcessFilesystemObservation> {
        try {
          const prepared = artifacts.map(artifact => prepareArtifact(
            config.approvedRoot,
            artifact.logicalPath,
            artifact.role,
            artifact.sha256
          ))
          const aggregateBytes = prepared.reduce((total, artifact) => total + artifact.before.size, 0n)
          if (aggregateBytes > BigInt(MAX_AGGREGATE_BYTES)) throw new Error()
          const hashes = new Map(
            prepared.map(artifact => [artifact.role, readPreparedArtifact(artifact, config.approvedRoot)] as const)
          )
          const paper = hashes.get('paper')
          const candidate = hashes.get('candidate')
          const probe = hashes.get('probe')
          if (!paper || !candidate) throw new Error()
          const observedArtifactRoles = Object.freeze(
            prepared.map(artifact => artifact.role).sort(compareText)
          )
          const artifactSha256 = Object.freeze({
            paper,
            candidate,
            ...(probe === undefined ? {} : { probe })
          })
          const observation = Object.freeze({
            schemaVersion: 1 as const,
            root: config.approvedRoot,
            targetBindingSha256,
            executableArtifactFileBytesObserved: true as const,
            configurationArtifactsObserved: false as const,
            observedArtifactRoles,
            filesystemObservationAtomic: false as const,
            filesystemObservationFreshness: 'not-established' as const,
            provesJvmLoadedBytes: false as const,
            artifactSha256
          })
          observationCapabilities.add(observation)
          return observation
        } catch {
          throw new PaperProcessFilesystemObservationError()
        }
      }
    }
    return Object.freeze(observer)
  } catch {
    throw new Error('Paper process filesystem observer configuration is invalid')
  }
}

export function preflightPaperProcessWithFilesystemObservation(
  provider: unknown,
  observationInput: unknown,
  processFactsInput: unknown
): PaperProcessFilesystemDryRunPreview {
  try {
    assertPaperProcessProvider(provider)
    assertIssuedObservation(observationInput)
    const processFacts = strictSnapshot(processFactsInput, [
      'schemaVersion', 'port', 'portListening', 'pid', 'sessionLockPresent',
      'onlinePlayers', 'authorizationId', 'requiredScope'
    ])
    const preview = provider.preflight({
      schemaVersion: processFacts.schemaVersion,
      root: observationInput.root,
      paperSha256: observationInput.artifactSha256.paper,
      candidateSha256: observationInput.artifactSha256.candidate,
      probeSha256: observationInput.artifactSha256.probe ?? null,
      port: processFacts.port,
      portListening: processFacts.portListening,
      pid: processFacts.pid,
      sessionLockPresent: processFacts.sessionLockPresent,
      onlinePlayers: processFacts.onlinePlayers,
      authorizationId: processFacts.authorizationId,
      requiredScope: processFacts.requiredScope
    })
    if (preview.targetBindingSha256 !== observationInput.targetBindingSha256) throw new Error()
    return Object.freeze({
      ...preview,
      executableArtifactFileBytesObserved: true as const,
      configurationArtifactsObserved: false as const,
      observedArtifactRoles: observationInput.observedArtifactRoles,
      filesystemObservationAtomic: false as const,
      filesystemObservationFreshness: 'not-established' as const,
      provesJvmLoadedBytes: false as const
    })
  } catch {
    throw new PaperProcessFilesystemPreflightError()
  }
}
