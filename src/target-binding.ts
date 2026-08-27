import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { EvidenceBinding } from './types.js'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/
const SAFE_VERSION = /^[a-zA-Z0-9][a-zA-Z0-9._:+-]{0,127}$/
const SAFE_SCOPE = /^[a-z][a-z0-9._:-]{0,63}$/
const SAFE_PATH_PART = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/
const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key|bearer)/i
const MAX_BINDING_FILE_BYTES = 256 * 1024
const MAX_ARTIFACTS = 128

const safeIdentifier = (label: string) => z.string().min(1).max(128).regex(SAFE_ID)
  .refine(value => value === value.normalize('NFC'), `${label} must be NFC normalized`)
  .refine(value => !CREDENTIAL_PATTERN.test(value), `Credential-like ${label} rejected`)

const safeVersion = z.string().min(1).max(128).regex(SAFE_VERSION)
  .refine(value => value === value.normalize('NFC'), 'Provider version must be NFC normalized')
  .refine(value => !CREDENTIAL_PATTERN.test(value), 'Credential-like provider version rejected')

const logicalPathSchema = z.string().min(1).max(240).superRefine((value, context) => {
  const normalized = value.normalize('NFC')
  if (value !== normalized) {
    context.addIssue({ code: 'custom', message: 'Logical path must be NFC normalized' })
    return
  }
  if (
    value.startsWith('/')
    || /^[a-zA-Z]:/.test(value)
    || value.includes('\\')
    || path.posix.normalize(value) !== value
    || value.split('/').some(part => !SAFE_PATH_PART.test(part) || part === '.' || part === '..')
  ) {
    context.addIssue({ code: 'custom', message: 'Invalid logical path' })
  }
  if (CREDENTIAL_PATTERN.test(value)) {
    context.addIssue({ code: 'custom', message: 'Credential-like logical path rejected' })
  }
})

const targetArtifactSchema = z.strictObject({
  logicalId: safeIdentifier('artifact logical ID'),
  role: z.enum(['paper', 'candidate', 'probe', 'config']),
  logicalPath: logicalPathSchema,
  sha256: z.string().regex(SHA256_PATTERN)
})

const providerSchema = z.strictObject({
  kind: z.enum([
    'minecraft-client',
    'paper-process',
    'server-probe',
    'filesystem-snapshot',
    'sqlite-readonly',
    'log-observer',
    'vision-frame'
  ]),
  id: safeIdentifier('provider ID'),
  version: safeVersion,
  instanceId: safeIdentifier('provider instance ID').optional()
})

const authorizationSchema = z.strictObject({
  id: safeIdentifier('authorization ID'),
  scope: z.array(z.string().regex(SAFE_SCOPE)
    .refine(value => !CREDENTIAL_PATTERN.test(value), 'Credential-like authorization scope rejected'))
    .min(1)
    .max(32)
})

const artifactTargetBindingInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  bindingId: safeIdentifier('binding ID'),
  provider: providerSchema,
  authorization: authorizationSchema,
  artifacts: z.array(targetArtifactSchema).min(1).max(MAX_ARTIFACTS)
}).superRefine((value, context) => {
  const logicalIds = value.artifacts.map(artifact => artifact.logicalId)
  if (new Set(logicalIds).size !== logicalIds.length) {
    context.addIssue({ code: 'custom', path: ['artifacts'], message: 'Duplicate artifact logical ID' })
  }
  const logicalPaths = value.artifacts.map(artifact => artifact.logicalPath)
  if (new Set(logicalPaths).size !== logicalPaths.length) {
    context.addIssue({ code: 'custom', path: ['artifacts'], message: 'Duplicate artifact logical path' })
  }
  const scope = value.authorization.scope
  if (new Set(scope).size !== scope.length) {
    context.addIssue({ code: 'custom', path: ['authorization', 'scope'], message: 'Duplicate authorization scope' })
  }
  const roleCount = (role: 'paper' | 'candidate' | 'probe' | 'config') =>
    value.artifacts.filter(artifact => artifact.role === role).length
  if (roleCount('candidate') !== 1) {
    context.addIssue({ code: 'custom', path: ['artifacts'], message: 'Exactly one candidate artifact is required' })
  }
  if (roleCount('paper') !== 1) {
    context.addIssue({ code: 'custom', path: ['artifacts'], message: 'Exactly one Paper artifact is required' })
  }
  if (roleCount('probe') > 1) {
    context.addIssue({ code: 'custom', path: ['artifacts'], message: 'At most one probe artifact is allowed' })
  }
  if (roleCount('config') === 0) {
    context.addIssue({ code: 'custom', path: ['artifacts'], message: 'At least one config artifact is required' })
  }
})

const artifactTargetBindingSchema = z.strictObject({
  schemaVersion: z.literal(1),
  evidenceGrade: z.literal('artifact-bound'),
  releaseEligible: z.literal(false),
  bindingId: safeIdentifier('binding ID'),
  provider: providerSchema,
  authorization: authorizationSchema,
  artifacts: z.array(targetArtifactSchema).min(1).max(MAX_ARTIFACTS)
})

export type ArtifactTargetBindingInput = z.input<typeof artifactTargetBindingInputSchema>
export type ArtifactTargetBinding = z.infer<typeof artifactTargetBindingSchema>

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function buildArtifactTargetBinding(input: unknown): ArtifactTargetBinding {
  const parsed = artifactTargetBindingInputSchema.parse(input)
  return artifactTargetBindingSchema.parse({
    schemaVersion: 1,
    evidenceGrade: 'artifact-bound',
    releaseEligible: false,
    bindingId: parsed.bindingId,
    provider: {
      kind: parsed.provider.kind,
      id: parsed.provider.id,
      version: parsed.provider.version,
      ...(parsed.provider.instanceId ? { instanceId: parsed.provider.instanceId } : {})
    },
    authorization: {
      id: parsed.authorization.id,
      scope: [...parsed.authorization.scope].sort(compareText)
    },
    artifacts: [...parsed.artifacts]
      .map(artifact => ({ ...artifact }))
      .sort((left, right) => compareText(left.logicalId, right.logicalId))
  })
}

export function validateArtifactTargetBinding(input: unknown): ArtifactTargetBinding {
  const parsed = artifactTargetBindingSchema.parse(input)
  return buildArtifactTargetBinding({
    schemaVersion: parsed.schemaVersion,
    bindingId: parsed.bindingId,
    provider: parsed.provider,
    authorization: parsed.authorization,
    artifacts: parsed.artifacts
  })
}

export function canonicalArtifactTargetBinding(binding: ArtifactTargetBinding): string {
  return JSON.stringify(validateArtifactTargetBinding(binding))
}

export function artifactTargetBindingSha256(binding: ArtifactTargetBinding): string {
  return createHash('sha256').update(canonicalArtifactTargetBinding(binding)).digest('hex')
}

export function exactArtifactTargetBindingMatch(
  actual: ArtifactTargetBinding,
  expected: ArtifactTargetBinding
): boolean {
  return canonicalArtifactTargetBinding(actual) === canonicalArtifactTargetBinding(expected)
}

export function evidenceBinding(targetBinding?: ArtifactTargetBinding): EvidenceBinding {
  if (!targetBinding) return { evidenceGrade: 'development-unbound', releaseEligible: false }
  const binding = validateArtifactTargetBinding(targetBinding)
  return {
    evidenceGrade: 'artifact-bound',
    releaseEligible: false,
    targetBinding: binding,
    targetBindingSha256: artifactTargetBindingSha256(binding)
  }
}

export function loadArtifactTargetBindingFile(file: string): ArtifactTargetBinding {
  const before = lstatSync(file)
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error('Target binding path must be a regular file')
  }
  if (before.size > MAX_BINDING_FILE_BYTES) throw new Error('Target binding file exceeds byte bound')
  const content = readFileSync(file)
  const after = lstatSync(file)
  if (
    !after.isFile()
    || after.isSymbolicLink()
    || before.size !== after.size
    || before.mtimeMs !== after.mtimeMs
    || before.ino !== after.ino
    || content.byteLength !== after.size
  ) {
    throw new Error('Target binding file changed while reading')
  }
  return buildArtifactTargetBinding(JSON.parse(content.toString('utf8')))
}
