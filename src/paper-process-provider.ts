import path from 'node:path'
import { types } from 'node:util'
import { z } from 'zod'
import {
  artifactTargetBindingSha256,
  validateArtifactTargetBinding,
  type ArtifactTargetBinding
} from './target-binding.js'
import type { ProviderDeclarationSnapshot } from './provider-registry.js'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/
const SAFE_VERSION = /^[a-zA-Z0-9][a-zA-Z0-9._:+-]{0,127}$/
const SAFE_SCOPE = /^[a-z][a-z0-9._:-]{0,63}$/
const SAFE_PATH_PART = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/
const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key|bearer)/i
const PRODUCTION_ROOT_PARTS = new Set(['live', 'prod', 'production', 'server', 'minecraftserver'])
const paperProcessProviderCapabilities = new WeakSet<object>()
const OPERATIONS = Object.freeze([
  'backup-fixture',
  'start-paper',
  'wait-ready',
  'run-journey',
  'clean-stop',
  'verify-natural-exit',
  'restore-fixture'
] as const)

const safeId = z.string().min(1).max(128).regex(SAFE_ID)
  .refine(value => value === value.normalize('NFC'))
  .refine(value => !CREDENTIAL_PATTERN.test(value))
const safeVersion = z.string().min(1).max(128).regex(SAFE_VERSION)
  .refine(value => value === value.normalize('NFC'))
  .refine(value => !CREDENTIAL_PATTERN.test(value))
const scopeSchema = z.array(z.string().regex(SAFE_SCOPE)
  .refine(value => !CREDENTIAL_PATTERN.test(value)))
  .min(1)
  .max(32)
  .superRefine((scope, context) => {
    if (new Set(scope).size !== scope.length) {
      context.addIssue({ code: 'custom', message: 'Duplicate scope' })
    }
  })
const logicalRootSchema = z.string().min(1).max(240).superRefine((value, context) => {
  if (value !== value.normalize('NFC')
    || value.startsWith('/')
    || /^[a-zA-Z]:/.test(value)
    || value.includes('\\')
    || path.posix.normalize(value) !== value
    || value.split('/').some(part => part === '.' || part === '..' || !SAFE_PATH_PART.test(part))
    || CREDENTIAL_PATTERN.test(value)) {
    context.addIssue({ code: 'custom', message: 'Invalid logical root' })
  }
})
const absoluteRootSchema = z.string().min(1).max(1024).superRefine((value, context) => {
  if (value !== value.normalize('NFC')
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
    || path.normalize(value) !== value
    || value === path.parse(value).root
    || CREDENTIAL_PATTERN.test(value)
    || value.split(/[\\/]+/).some(part => PRODUCTION_ROOT_PARTS.has(part.toLocaleLowerCase()))) {
    context.addIssue({ code: 'custom', message: 'Invalid approved root' })
  }
})
const authorizationSchema = z.strictObject({
  id: safeId,
  scope: scopeSchema
})
const configSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: safeId,
  version: safeVersion,
  instanceId: safeId,
  approvedRoot: absoluteRootSchema,
  logicalRoot: logicalRootSchema,
  port: z.number().int().min(1).max(65_535),
  authorization: authorizationSchema,
  targetBinding: z.unknown()
})
const factsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  root: absoluteRootSchema,
  paperSha256: z.string().regex(SHA256_PATTERN),
  candidateSha256: z.string().regex(SHA256_PATTERN),
  probeSha256: z.string().regex(SHA256_PATTERN).nullable(),
  port: z.number().int().min(1).max(65_535),
  portListening: z.boolean(),
  pid: z.number().int().positive().nullable(),
  sessionLockPresent: z.boolean(),
  onlinePlayers: z.number().int().nonnegative().max(10_000),
  authorizationId: safeId,
  requiredScope: scopeSchema
})

export type PaperProcessPreflightFacts = z.infer<typeof factsSchema>

export interface PaperProcessDryRunPreview {
  readonly schemaVersion: 1
  readonly providerId: string
  readonly instanceId: string
  readonly approvedRoot: string
  readonly port: number
  readonly bootTokenRequired: true
  readonly factsAuthoritative: false
  readonly approvalAuthoritative: false
  readonly mutationAllowed: false
  readonly targetBindingSha256: string
  readonly operations: readonly typeof OPERATIONS[number][]
  readonly artifactSha256: Readonly<{
    paper: string
    candidate: string
    probe?: string
  }>
}

export interface PaperProcessProvider {
  readonly declaration: Readonly<ProviderDeclarationSnapshot>
  preflight(input: unknown): Readonly<PaperProcessDryRunPreview>
}

export class PaperProcessPreflightError extends Error {
  constructor() {
    super('Paper process preflight rejected')
    this.name = 'PaperProcessPreflightError'
    Object.freeze(this)
  }
}

export function assertPaperProcessProvider(input: unknown): asserts input is PaperProcessProvider {
  if (typeof input !== 'object' || input === null || !paperProcessProviderCapabilities.has(input)) {
    throw new Error('Paper process provider is invalid')
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function sameTextSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const sortedLeft = [...left].sort(compareText)
  const sortedRight = [...right].sort(compareText)
  return sortedLeft.every((value, index) => value === sortedRight[index])
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

function snapshotScope(input: unknown): unknown[] {
  if (!Array.isArray(input) || types.isProxy(input) || input.length < 1 || input.length > 32) {
    throw new Error()
  }
  const count = input.length
  const snapshot: unknown[] = []
  for (let index = 0; index < count; index++) snapshot.push(input[index])
  return snapshot
}

function snapshotAuthorization(input: unknown): Record<string, unknown> {
  const snapshot = strictSnapshot(input, ['id', 'scope'])
  snapshot.scope = snapshotScope(snapshot.scope)
  return snapshot
}

function parseConfiguration(input: unknown): z.infer<typeof configSchema> {
  const snapshot = strictSnapshot(input, [
    'schemaVersion', 'id', 'version', 'instanceId', 'approvedRoot', 'logicalRoot',
    'port', 'authorization', 'targetBinding'
  ])
  snapshot.authorization = snapshotAuthorization(snapshot.authorization)
  return configSchema.parse(snapshot)
}

function parseFacts(input: unknown): PaperProcessPreflightFacts {
  const snapshot = strictSnapshot(input, [
    'schemaVersion', 'root', 'paperSha256', 'candidateSha256', 'probeSha256', 'port',
    'portListening', 'pid', 'sessionLockPresent', 'onlinePlayers', 'authorizationId',
    'requiredScope'
  ])
  snapshot.requiredScope = snapshotScope(snapshot.requiredScope)
  return factsSchema.parse(snapshot)
}

function artifactHash(binding: ArtifactTargetBinding, role: 'paper' | 'candidate' | 'probe'): string | undefined {
  return binding.artifacts.find(artifact => artifact.role === role)?.sha256
}

export function createPaperProcessProvider(input: unknown): PaperProcessProvider {
  try {
    const config = parseConfiguration(input)
    const binding = validateArtifactTargetBinding(config.targetBinding)
    if (binding.provider.kind !== 'paper-process'
      || binding.provider.id !== config.id
      || binding.provider.version !== config.version
      || binding.provider.instanceId !== config.instanceId
      || binding.authorization.id !== config.authorization.id
      || !sameTextSet(binding.authorization.scope, config.authorization.scope)) throw new Error()

    const targetBindingSha256 = artifactTargetBindingSha256(binding)
    const expectedPaperSha256 = artifactHash(binding, 'paper')
    const expectedCandidateSha256 = artifactHash(binding, 'candidate')
    const expectedProbeSha256 = artifactHash(binding, 'probe')
    if (!expectedPaperSha256 || !expectedCandidateSha256) throw new Error()

    const sortedScope = Object.freeze([...config.authorization.scope].sort(compareText))
    const declaration = Object.freeze({
      schemaVersion: 1 as const,
      kind: 'paper-process' as const,
      id: config.id,
      version: config.version,
      instanceId: config.instanceId,
      capabilities: Object.freeze(['dry-run-preflight']),
      authorization: Object.freeze({ id: config.authorization.id, scope: sortedScope }),
      targetRoot: config.logicalRoot,
      mutationClass: 'isolated-process-lifecycle' as const
    })

    const provider = Object.freeze({
      declaration,
      preflight(factsInput: unknown): Readonly<PaperProcessDryRunPreview> {
        try {
          const facts = parseFacts(factsInput)
          if (facts.root !== config.approvedRoot
            || facts.paperSha256 !== expectedPaperSha256
            || facts.candidateSha256 !== expectedCandidateSha256
            || facts.probeSha256 !== (expectedProbeSha256 ?? null)
            || facts.port !== config.port
            || facts.portListening
            || facts.pid !== null
            || facts.sessionLockPresent
            || facts.onlinePlayers !== 0
            || facts.authorizationId !== config.authorization.id
            || !sameTextSet(facts.requiredScope, config.authorization.scope)) {
            throw new Error()
          }
          const artifactSha256 = Object.freeze({
            paper: expectedPaperSha256,
            candidate: expectedCandidateSha256,
            ...(expectedProbeSha256 === undefined ? {} : { probe: expectedProbeSha256 })
          })
          return Object.freeze({
            schemaVersion: 1 as const,
            providerId: config.id,
            instanceId: config.instanceId,
            approvedRoot: config.approvedRoot,
            port: config.port,
            bootTokenRequired: true as const,
            factsAuthoritative: false as const,
            approvalAuthoritative: false as const,
            mutationAllowed: false as const,
            targetBindingSha256,
            operations: OPERATIONS,
            artifactSha256
          })
        } catch {
          throw new PaperProcessPreflightError()
        }
      }
    })
    paperProcessProviderCapabilities.add(provider)
    return provider
  } catch {
    throw new Error('Paper process provider configuration is invalid')
  }
}
