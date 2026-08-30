import path from 'node:path'
import { types } from 'node:util'
import { z } from 'zod'
import { failureEnvelope, type FailureEnvelope } from './failure-envelope.js'

const MAX_PROVIDERS = 32
const resolvedPlanCapabilities = new WeakSet<object>()
const registryResolutionCapabilities = new WeakMap<object, WeakSet<object>>()
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/
const SAFE_VERSION = /^[a-zA-Z0-9][a-zA-Z0-9._:+-]{0,127}$/
const SAFE_CAPABILITY = /^[a-z][a-z0-9._:-]{0,63}$/
const SAFE_PATH_PART = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/
const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key|bearer)/i

const safeId = z.string().min(1).max(128).regex(SAFE_ID)
  .refine(value => value === value.normalize('NFC'), 'Identifier must be NFC normalized')
  .refine(value => !CREDENTIAL_PATTERN.test(value), 'Credential-like identifier rejected')
const safeVersion = z.string().min(1).max(128).regex(SAFE_VERSION)
  .refine(value => value === value.normalize('NFC'), 'Version must be NFC normalized')
  .refine(value => !CREDENTIAL_PATTERN.test(value), 'Credential-like version rejected')
const capability = z.string().regex(SAFE_CAPABILITY)
  .refine(value => !CREDENTIAL_PATTERN.test(value), 'Credential-like capability rejected')
const targetRoot = z.string().min(1).max(240).superRefine((value, context) => {
  if (value !== value.normalize('NFC')
    || value.startsWith('/')
    || /^[a-zA-Z]:/.test(value)
    || value.includes('\\')
    || path.posix.normalize(value) !== value
    || value.split('/').some(part => part === '.' || part === '..' || !SAFE_PATH_PART.test(part))
    || CREDENTIAL_PATTERN.test(value)) {
    context.addIssue({ code: 'custom', message: 'Provider target root is invalid' })
  }
})
const providerKind = z.enum([
  'minecraft-client',
  'paper-process',
  'server-probe',
  'filesystem-snapshot',
  'sqlite-readonly',
  'log-observer',
  'vision-frame'
])
const mutationClass = z.enum([
  'observe-only',
  'read-only',
  'client-session',
  'isolated-process-lifecycle'
])

const declarationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: providerKind,
  id: safeId,
  version: safeVersion,
  instanceId: safeId.optional(),
  capabilities: z.array(capability).min(1).max(32),
  authorization: z.strictObject({
    id: safeId,
    scope: z.array(capability).min(1).max(32)
  }),
  targetRoot,
  mutationClass
}).superRefine((value, context) => {
  if (new Set(value.capabilities).size !== value.capabilities.length) {
    context.addIssue({ code: 'custom', path: ['capabilities'], message: 'Duplicate provider capability' })
  }
  if (new Set(value.authorization.scope).size !== value.authorization.scope.length) {
    context.addIssue({ code: 'custom', path: ['authorization', 'scope'], message: 'Duplicate provider authorization scope' })
  }
})

const requirementSchema = z.strictObject({
  kind: providerKind,
  id: safeId,
  version: safeVersion,
  instanceId: safeId.optional(),
  capabilities: z.array(capability).min(1).max(32),
  authorizationId: safeId,
  requiredScope: z.array(capability).min(1).max(32),
  targetRoot,
  mutationClass
}).superRefine((value, context) => {
  if (new Set(value.capabilities).size !== value.capabilities.length) {
    context.addIssue({ code: 'custom', path: ['capabilities'], message: 'Duplicate required capability' })
  }
  if (new Set(value.requiredScope).size !== value.requiredScope.length) {
    context.addIssue({ code: 'custom', path: ['requiredScope'], message: 'Duplicate required scope' })
  }
})

const authorizedPlanSchema = z.strictObject({
  schemaVersion: z.literal(1),
  scenario: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
    .refine(value => !CREDENTIAL_PATTERN.test(value), 'Credential-like scenario rejected'),
  providers: z.array(requirementSchema).min(1).max(MAX_PROVIDERS)
}).superRefine((value, context) => {
  const identities = value.providers.map(providerIdentity)
  if (new Set(identities).size !== identities.length) {
    context.addIssue({ code: 'custom', path: ['providers'], message: 'Duplicate provider requirement' })
  }
})

export type ProviderDeclaration = z.infer<typeof declarationSchema>
export type ProviderRequirement = z.infer<typeof requirementSchema>
export type AuthorizedPlan = z.infer<typeof authorizedPlanSchema>

export interface ProviderDeclarationSnapshot extends Omit<
  ProviderDeclaration,
  'capabilities' | 'authorization'
> {
  readonly capabilities: readonly string[]
  readonly authorization: Readonly<{
    id: string
    scope: readonly string[]
  }>
}

export interface ProviderRegistration {
  readonly declaration: unknown
  readonly port: unknown
}

export interface ResolvedProvider {
  readonly declaration: Readonly<ProviderDeclarationSnapshot>
  readonly port: unknown
}

export interface ResolvedAuthorizedPlan {
  readonly schemaVersion: 1
  readonly scenario: string
  readonly providers: ReadonlyArray<Readonly<ResolvedProvider>>
}

export class ProviderAdmissionError extends Error {
  readonly failure: FailureEnvelope

  constructor() {
    super('Required provider is unavailable or unauthorized')
    this.name = 'ProviderAdmissionError'
    const failure = failureEnvelope({
      code: 'INCONCLUSIVE_PROVIDER_UNAVAILABLE',
      phase: 'plan-admission',
      provider: 'provider-registry',
      error: new Error('Required provider is unavailable or unauthorized'),
      retryable: false,
      trustBoundary: 'external-provider'
    })
    Object.freeze(failure.artifactRefs)
    this.failure = Object.freeze(failure)
    Object.freeze(this)
  }
}

export class InvalidAuthorizedPlanError extends Error {
  constructor() {
    super('Authorized plan is invalid')
    this.name = 'InvalidAuthorizedPlanError'
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function providerIdentity(value: {
  kind: string
  id: string
  version: string
  instanceId?: string
}): string {
  return `${value.kind}\u0000${value.id}\u0000${value.version}\u0000${value.instanceId ?? ''}`
}

function freezeDeclaration(input: unknown): Readonly<ProviderDeclarationSnapshot> {
  const parsed = declarationSchema.parse(input)
  return Object.freeze({
    schemaVersion: 1 as const,
    kind: parsed.kind,
    id: parsed.id,
    version: parsed.version,
    ...(parsed.instanceId === undefined ? {} : { instanceId: parsed.instanceId }),
    capabilities: Object.freeze([...parsed.capabilities].sort(compareText)),
    authorization: Object.freeze({
      id: parsed.authorization.id,
      scope: Object.freeze([...parsed.authorization.scope].sort(compareText))
    }),
    targetRoot: parsed.targetRoot,
    mutationClass: parsed.mutationClass
  })
}

function sameTextSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && [...left].sort(compareText).every((value, index) => value === [...right].sort(compareText)[index])
}

function declarationMatches(
  declaration: Readonly<ProviderDeclarationSnapshot>,
  requirement: ProviderRequirement
): boolean {
  return declaration.kind === requirement.kind
    && declaration.id === requirement.id
    && declaration.version === requirement.version
    && declaration.instanceId === requirement.instanceId
    && sameTextSet(declaration.capabilities, requirement.capabilities)
    && declaration.authorization.id === requirement.authorizationId
    && sameTextSet(declaration.authorization.scope, requirement.requiredScope)
    && declaration.targetRoot === requirement.targetRoot
    && declaration.mutationClass === requirement.mutationClass
}

export interface ProviderRegistry {
  resolve(input: unknown): Readonly<ResolvedAuthorizedPlan>
}

export function assertResolvedAuthorizedPlan(
  input: unknown
): asserts input is Readonly<ResolvedAuthorizedPlan> {
  if ((typeof input !== 'object' && typeof input !== 'function')
    || input === null
    || !resolvedPlanCapabilities.has(input)) {
    throw new InvalidAuthorizedPlanError()
  }
}

export function assertProviderRegistryResolution(
  registry: ProviderRegistry,
  input: unknown
): asserts input is Readonly<ResolvedAuthorizedPlan> {
  if ((typeof input !== 'object' && typeof input !== 'function')
    || input === null
    || !registryResolutionCapabilities.get(registry as object)?.has(input)) {
    throw new InvalidAuthorizedPlanError()
  }
}

export function createProviderRegistry(
  registrationsInput: readonly ProviderRegistration[]
): ProviderRegistry {
  let registrations: ReadonlyArray<Readonly<ResolvedProvider>>
  try {
    if (!Array.isArray(registrationsInput)
      || types.isProxy(registrationsInput)
      || registrationsInput.length === 0
      || registrationsInput.length > MAX_PROVIDERS) throw new Error()
    const registrationCount = registrationsInput.length
    const snapshots: Array<Readonly<ResolvedProvider>> = []
    for (let index = 0; index < registrationCount; index++) {
      const registration = registrationsInput[index]
      const declarationInput = registration.declaration
      const port = registration.port
      if ((typeof port !== 'object' || port === null) && typeof port !== 'function') throw new Error()
      snapshots.push(Object.freeze({ declaration: freezeDeclaration(declarationInput), port }))
    }
    const identities = snapshots.map(value => providerIdentity(value.declaration))
    if (new Set(identities).size !== identities.length) throw new Error()
    registrations = Object.freeze(snapshots)
  } catch {
    throw new Error('Provider registry is invalid')
  }

  const issuedResolutions = new WeakSet<object>()
  const registry = Object.freeze({
    resolve(input: unknown): Readonly<ResolvedAuthorizedPlan> {
      let plan: AuthorizedPlan
      try {
        plan = authorizedPlanSchema.parse(input)
      } catch {
        throw new InvalidAuthorizedPlanError()
      }
      const providers = plan.providers.map(requirement => {
        const registration = registrations.find(candidate => declarationMatches(candidate.declaration, requirement))
        if (!registration) throw new ProviderAdmissionError()
        return registration
      })
      const resolved = Object.freeze({
        schemaVersion: 1 as const,
        scenario: plan.scenario,
        providers: Object.freeze(providers)
      })
      resolvedPlanCapabilities.add(resolved)
      issuedResolutions.add(resolved)
      return resolved
    }
  })
  registryResolutionCapabilities.set(registry, issuedResolutions)
  return registry
}
