import { createHash } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import {
  artifactTargetBindingSha256,
  validateArtifactTargetBinding,
  type ArtifactTargetBinding
} from './target-binding.js'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/
const SAFE_PATH_PART = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/
const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key|bearer)/i
const JAVA_BINARY_NAME = /^[\p{L}_$][\p{L}\p{N}_$]*(?:\.[\p{L}_$][\p{L}\p{N}_$]*)*$/u
const MAX_OBSERVED_BYTES = 64 * 1024 * 1024
const CLASS_RESOURCE_ORIGIN = 'anchor-class-getResourceAsStream;loader-mediated;parent-delegation-possible;runtime-version-selection-unknown;may-differ-from-defined-bytecode;origin-not-proven'
const LIMITATIONS = Object.freeze([
  'declared-identity-is-caller-supplied',
  'codesource-file-is-not-loaded-bytecode-proof',
  'class-resource-is-loader-mediated-informational-evidence',
  'snapshot-is-best-effort-non-atomic'
] as const)

const logicalPathSchema = z.string().min(1).max(240).superRefine((value, context) => {
  if (
    value !== value.normalize('NFC')
    || value.startsWith('/')
    || /^[a-zA-Z]:/.test(value)
    || value.includes('\\')
    || path.posix.normalize(value) !== value
    || value.split('/').some(part => part === '.' || part === '..' || !SAFE_PATH_PART.test(part))
  ) context.addIssue({ code: 'custom', message: 'Invalid declared logical path' })
  if (CREDENTIAL_PATTERN.test(value)) {
    context.addIssue({ code: 'custom', message: 'Credential-like logical path rejected' })
  }
})

const observationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  grade: z.literal('codesource-file-and-class-resource-observed'),
  authoritative: z.literal(false),
  provesLoadedBytecode: z.literal(false),
  releaseEligible: z.literal(false),
  assumptions: z.tuple([
    z.literal('standard-non-instrumented-anchor-classloader'),
    z.literal('java-agent-absence-verified:false')
  ]),
  declared: z.strictObject({
    role: z.enum(['paper', 'candidate', 'probe']),
    logicalId: z.string().regex(SAFE_ID)
      .refine(value => !CREDENTIAL_PATTERN.test(value), 'Credential-like logical ID rejected'),
    logicalPath: logicalPathSchema
  }),
  observedClassBinaryName: z.string().min(1).max(512)
    .refine(value => value === value.normalize('NFC'), 'Observed class name must be NFC normalized')
    .regex(JAVA_BINARY_NAME),
  codeSourceUriFingerprint: z.string().regex(SHA256_PATTERN),
  codeSourceFileSha256: z.string().regex(SHA256_PATTERN),
  codeSourceFileBytes: z.number().int().safe().positive().max(MAX_OBSERVED_BYTES),
  classResourceSha256: z.string().regex(SHA256_PATTERN),
  classResourceBytes: z.number().int().safe().positive().max(MAX_OBSERVED_BYTES),
  classResourceOrigin: z.literal(CLASS_RESOURCE_ORIGIN),
  classResourceInformational: z.literal(true),
  sameLoaderMediated: z.literal(true),
  mayDifferFromDefinedBytecode: z.literal(true),
  internalEntryConsistency: z.enum(['MATCH', 'MISMATCH', 'NOT_A_JAR']),
  atomicSnapshot: z.literal(false)
}).superRefine((value, context) => {
  if (value.codeSourceFileBytes + value.classResourceBytes > MAX_OBSERVED_BYTES) {
    context.addIssue({ code: 'custom', message: 'Observation total byte budget exceeds bound' })
  }
})

type ParsedJvmArtifactObservationV1 = z.infer<typeof observationSchema>

export type JvmArtifactObservationV1 = Readonly<
  Omit<ParsedJvmArtifactObservationV1, 'assumptions' | 'declared'> & {
    readonly assumptions: readonly [
      'standard-non-instrumented-anchor-classloader',
      'java-agent-absence-verified:false'
    ]
    readonly declared: Readonly<ParsedJvmArtifactObservationV1['declared']>
  }
>

interface JvmArtifactObservationAssessmentBase {
  readonly schemaVersion: 1
  readonly authoritative: false
  readonly provesLoadedBytecode: false
  readonly releaseEligible: false
  readonly bindingId: string
  readonly targetBindingSha256: string
  readonly observationSha256: string
  readonly codeSourceUriFingerprint: string
  readonly codeSourceFileSha256: string
  readonly codeSourceFileBytes: number
  readonly classResourceSha256: string
  readonly classResourceBytes: number
  readonly internalEntryConsistency: JvmArtifactObservationV1['internalEntryConsistency']
  readonly classResourceAssessment:
    | 'BASE_ENTRY_MATCH_INFORMATIONAL'
    | 'BASE_ENTRY_MISMATCH_INFORMATIONAL'
    | 'NOT_A_JAR_INFORMATIONAL'
  readonly observedClassBinaryName: string
  readonly limitations: typeof LIMITATIONS
}

interface JvmArtifactObservationExactArtifactAssessment
  extends JvmArtifactObservationAssessmentBase {
  readonly artifact: Readonly<{
    logicalId: string
    role: JvmArtifactObservationV1['declared']['role']
    logicalPath: string
    expectedSha256: string
    observedCodeSourceFileSha256: string
  }>
}

export interface JvmArtifactObservationMatchAssessment
  extends JvmArtifactObservationExactArtifactAssessment {
  readonly status: 'TARGET_FILE_MATCH_NON_AUTHORITATIVE'
}

export interface JvmArtifactObservationHashMismatchAssessment
  extends JvmArtifactObservationExactArtifactAssessment {
  readonly status: 'MISMATCH_NON_AUTHORITATIVE'
  readonly reason: 'HASH_MISMATCH'
}

export interface JvmArtifactObservationIdentityMismatchAssessment
  extends JvmArtifactObservationAssessmentBase {
  readonly status: 'MISMATCH_NON_AUTHORITATIVE'
  readonly reason: 'DECLARED_IDENTITY_MISMATCH'
  readonly declared: JvmArtifactObservationV1['declared']
  readonly observedCodeSourceFileSha256: string
}

export type JvmArtifactObservationAssessment =
  | JvmArtifactObservationMatchAssessment
  | JvmArtifactObservationHashMismatchAssessment
  | JvmArtifactObservationIdentityMismatchAssessment

export function parseJvmArtifactObservationV1(input: unknown): JvmArtifactObservationV1 {
  const parsed = observationSchema.parse(input)
  return Object.freeze({
    ...parsed,
    assumptions: Object.freeze([
      'standard-non-instrumented-anchor-classloader',
      'java-agent-absence-verified:false'
    ] as const),
    declared: Object.freeze({ ...parsed.declared })
  })
}

export function canonicalJvmArtifactObservationV1(input: unknown): Buffer {
  const value = parseJvmArtifactObservationV1(input)
  return Buffer.from(JSON.stringify({
    schemaVersion: value.schemaVersion,
    grade: value.grade,
    authoritative: value.authoritative,
    provesLoadedBytecode: value.provesLoadedBytecode,
    releaseEligible: value.releaseEligible,
    assumptions: [...value.assumptions],
    declared: {
      role: value.declared.role,
      logicalId: value.declared.logicalId,
      logicalPath: value.declared.logicalPath
    },
    observedClassBinaryName: value.observedClassBinaryName,
    codeSourceUriFingerprint: value.codeSourceUriFingerprint,
    codeSourceFileSha256: value.codeSourceFileSha256,
    codeSourceFileBytes: value.codeSourceFileBytes,
    classResourceSha256: value.classResourceSha256,
    classResourceBytes: value.classResourceBytes,
    classResourceOrigin: value.classResourceOrigin,
    classResourceInformational: value.classResourceInformational,
    sameLoaderMediated: value.sameLoaderMediated,
    mayDifferFromDefinedBytecode: value.mayDifferFromDefinedBytecode,
    internalEntryConsistency: value.internalEntryConsistency,
    atomicSnapshot: value.atomicSnapshot
  }), 'utf8')
}

function classResourceAssessment(
  consistency: JvmArtifactObservationV1['internalEntryConsistency']
): JvmArtifactObservationAssessmentBase['classResourceAssessment'] {
  if (consistency === 'MATCH') return 'BASE_ENTRY_MATCH_INFORMATIONAL'
  if (consistency === 'MISMATCH') return 'BASE_ENTRY_MISMATCH_INFORMATIONAL'
  return 'NOT_A_JAR_INFORMATIONAL'
}

export function assessJvmArtifactObservationAgainstBinding(
  observationInput: unknown,
  bindingInput: ArtifactTargetBinding
): JvmArtifactObservationAssessment {
  const observation = parseJvmArtifactObservationV1(observationInput)
  const binding = validateArtifactTargetBinding(bindingInput)
  const artifact = binding.artifacts.find(candidate =>
    candidate.logicalId === observation.declared.logicalId
    && candidate.role === observation.declared.role
    && candidate.logicalPath === observation.declared.logicalPath)
  const common = {
    schemaVersion: 1,
    authoritative: false,
    provesLoadedBytecode: false,
    releaseEligible: false,
    bindingId: binding.bindingId,
    targetBindingSha256: artifactTargetBindingSha256(binding),
    observationSha256: createHash('sha256')
      .update(canonicalJvmArtifactObservationV1(observation)).digest('hex'),
    codeSourceUriFingerprint: observation.codeSourceUriFingerprint,
    codeSourceFileSha256: observation.codeSourceFileSha256,
    codeSourceFileBytes: observation.codeSourceFileBytes,
    classResourceSha256: observation.classResourceSha256,
    classResourceBytes: observation.classResourceBytes,
    internalEntryConsistency: observation.internalEntryConsistency,
    classResourceAssessment: classResourceAssessment(observation.internalEntryConsistency),
    observedClassBinaryName: observation.observedClassBinaryName,
    limitations: LIMITATIONS
  } as const
  if (!artifact) {
    return Object.freeze({
      ...common,
      status: 'MISMATCH_NON_AUTHORITATIVE' as const,
      reason: 'DECLARED_IDENTITY_MISMATCH' as const,
      declared: observation.declared,
      observedCodeSourceFileSha256: observation.codeSourceFileSha256
    })
  }
  const exact = {
    ...common,
    artifact: Object.freeze({
      logicalId: artifact.logicalId,
      role: observation.declared.role,
      logicalPath: artifact.logicalPath,
      expectedSha256: artifact.sha256,
      observedCodeSourceFileSha256: observation.codeSourceFileSha256
    })
  } as const
  return artifact.sha256 === observation.codeSourceFileSha256
    ? Object.freeze({ ...exact, status: 'TARGET_FILE_MATCH_NON_AUTHORITATIVE' as const })
    : Object.freeze({
        ...exact,
        status: 'MISMATCH_NON_AUTHORITATIVE' as const,
        reason: 'HASH_MISMATCH' as const
      })
}
