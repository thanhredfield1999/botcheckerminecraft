import { lstatSync, readdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { types } from 'node:util'
import { z } from 'zod'

const SHA256 = /^[a-f0-9]{64}$/
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/
const VERSION = /^[a-zA-Z0-9][a-zA-Z0-9._:+-]{0,127}$/
const ENVIRONMENT_VARIABLE = /^[A-Z][A-Z0-9_]{0,127}$/
const FORBIDDEN_FIELD = /(?:secret|token|credential|api[_-]?key|bearer|private[_-]?key)/i

const adapterSchema = z.strictObject({
  audience: z.string().min(1).max(128).regex(ID),
  verifierInstanceId: z.string().min(1).max(128).regex(ID),
  keyId: z.string().regex(SHA256),
  bindingId: z.string().min(1).max(128).regex(ID),
  targetBindingSha256: z.string().regex(SHA256),
  providerId: z.string().min(1).max(128).regex(ID),
  providerVersion: z.string().min(1).max(128).regex(VERSION),
  providerInstanceId: z.string().min(1).max(128).regex(ID),
  trustStoreId: z.string().min(1).max(128).regex(ID),
  trustStoreVersion: z.string().min(1).max(128).regex(VERSION),
  trustStoreSha256: z.string().regex(SHA256),
  serverInstanceId: z.string().min(1).max(128).regex(ID)
})

const companionSchema = z.strictObject({
  alias: z.string().min(1).max(128).regex(ID),
  passwordEnvironmentVariable: z.string().regex(ENVIRONMENT_VARIABLE)
})

const inputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  isolatedRoot: z.string().min(1).max(1024),
  paperJarPath: z.string().min(1).max(1024),
  keyStorePath: z.string().min(1).max(1024),
  port: z.number().int().min(1).max(65_535),
  adapter: adapterSchema,
  companion: companionSchema
})

type ControlledPaperHarnessInput = z.infer<typeof inputSchema>

export interface ControlledPaperHarnessPreflight {
  readonly schemaVersion: 1
  readonly ready: boolean
  readonly blocked: readonly ('PAPER_JAR_MISSING' | 'KEYSTORE_MISSING')[]
  readonly mutationAllowed: false
  readonly runtimeExecuted: false
}

export interface ControlledPaperRunPlan {
  readonly schemaVersion: 1
  readonly isolatedRoot: string
  readonly paperJarPath: string
  readonly keyStorePath: string
  readonly port: number
  readonly operations: readonly [
    'materialize-isolated-root',
    'write-non-secret-config',
    'await-explicit-runtime-approval'
  ]
  readonly mutationAllowed: false
  readonly runtimeExecuted: false
}

export interface ControlledPaperHarnessOptions {
  readonly repositoryRoot: string
}

function ownRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || types.isProxy(input)) throw new Error()
  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) throw new Error()
  return input as Record<string, unknown>
}

function rejectForbiddenFields(input: unknown, allowPasswordEnvironmentVariable = false): void {
  const record = ownRecord(input)
  for (const [key, value] of Object.entries(record)) {
    if (FORBIDDEN_FIELD.test(key) && !(allowPasswordEnvironmentVariable && key === 'passwordEnvironmentVariable')) {
      throw new Error()
    }
    if (typeof value === 'object' && value !== null) {
      rejectForbiddenFields(value, key === 'companion')
    }
  }
}

function parse(input: unknown): ControlledPaperHarnessInput {
  try {
    rejectForbiddenFields(input)
    const parsed = inputSchema.parse(input)
    if (!path.isAbsolute(parsed.isolatedRoot) || !path.isAbsolute(parsed.paperJarPath) || !path.isAbsolute(parsed.keyStorePath)) {
      throw new Error()
    }
    return parsed
  } catch {
    throw new Error('Controlled Paper harness configuration is invalid')
  }
}

function isRegularFile(file: string): boolean {
  try {
    const stat = lstatSync(file)
    return stat.isFile() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

function assertExternalIsolatedRoot(input: ControlledPaperHarnessInput, options: ControlledPaperHarnessOptions): void {
  try {
    const repositoryRoot = realpathSync(options.repositoryRoot)
    const rootStat = lstatSync(input.isolatedRoot)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error()
    const isolatedRoot = realpathSync(input.isolatedRoot)
    if (readdirSync(isolatedRoot).length !== 0) throw new Error()
    const relative = path.relative(repositoryRoot, isolatedRoot)
    if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
      throw new Error()
    }
  } catch {
    throw new Error('Controlled Paper harness configuration is invalid')
  }
}

function assertExternalArtifactPaths(input: ControlledPaperHarnessInput, options: ControlledPaperHarnessOptions): void {
  try {
    const repositoryRoot = realpathSync(options.repositoryRoot)
    const isolatedRoot = realpathSync(input.isolatedRoot)
    for (const artifactPath of [input.paperJarPath, input.keyStorePath]) {
      const absoluteArtifactPath = path.join(realpathSync(path.dirname(artifactPath)), path.basename(artifactPath))
      const repositoryRelative = path.relative(repositoryRoot, absoluteArtifactPath)
      const rootRelative = path.relative(isolatedRoot, absoluteArtifactPath)
      const isInsideRepository = repositoryRelative === '' || (!repositoryRelative.startsWith(`..${path.sep}`) && repositoryRelative !== '..' && !path.isAbsolute(repositoryRelative))
      const isInsideIsolatedRoot = rootRelative === '' || (!rootRelative.startsWith(`..${path.sep}`) && rootRelative !== '..' && !path.isAbsolute(rootRelative))
      if (isInsideRepository || isInsideIsolatedRoot) {
        throw new Error()
      }
    }
  } catch {
    throw new Error('Controlled Paper harness configuration is invalid')
  }
}

function validate(input: unknown, options: ControlledPaperHarnessOptions): ControlledPaperHarnessInput {
  const parsed = parse(input)
  assertExternalIsolatedRoot(parsed, options)
  assertExternalArtifactPaths(parsed, options)
  return parsed
}

export function preflightControlledPaperHarness(
  input: unknown,
  options: ControlledPaperHarnessOptions
): ControlledPaperHarnessPreflight {
  const config = validate(input, options)
  const blocked: ('PAPER_JAR_MISSING' | 'KEYSTORE_MISSING')[] = []
  if (!isRegularFile(config.paperJarPath)) blocked.push('PAPER_JAR_MISSING')
  if (!isRegularFile(config.keyStorePath)) blocked.push('KEYSTORE_MISSING')
  return Object.freeze({
    schemaVersion: 1 as const,
    ready: blocked.length === 0,
    blocked: Object.freeze(blocked),
    mutationAllowed: false as const,
    runtimeExecuted: false as const
  })
}

export function buildControlledPaperRunPlan(
  input: unknown,
  options: ControlledPaperHarnessOptions
): ControlledPaperRunPlan {
  const config = validate(input, options)
  const preflight = preflightControlledPaperHarness(config, options)
  if (!preflight.ready) throw new Error('Controlled Paper harness preflight blocked')
  return Object.freeze({
    schemaVersion: 1 as const,
    isolatedRoot: path.resolve(config.isolatedRoot),
    paperJarPath: path.resolve(config.paperJarPath),
    keyStorePath: path.resolve(config.keyStorePath),
    port: config.port,
    operations: Object.freeze([
      'materialize-isolated-root',
      'write-non-secret-config',
      'await-explicit-runtime-approval'
    ]) as ControlledPaperRunPlan['operations'],
    mutationAllowed: false as const,
    runtimeExecuted: false as const
  })
}
