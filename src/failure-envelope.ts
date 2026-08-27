import { z } from 'zod'

const MAX_DETAIL = 256
const CREDENTIAL_REF_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key)/i
const CREDENTIAL_ASSIGNMENT_PATTERN = /(password|passwd|secret|token|credential|api[ _-]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/i
const CREDENTIAL_ASSIGNMENT_REPLACE_PATTERN = /(password|passwd|secret|token|credential|api[ _-]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi
const BEARER_PATTERN = /\bbearer\s+[a-z0-9._~+/-]+=*/i
const BEARER_REPLACE_PATTERN = /\bbearer\s+[a-z0-9._~+/-]+=*/gi
const SAFE_NAME = /^[a-z0-9][a-z0-9._:-]{0,63}$/
const SAFE_CAUSE = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/
const SAFE_ARTIFACT = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/

export const failureCodeSchema = z.enum([
  'FAIL_PRODUCT',
  'FAIL_FIXTURE',
  'INCONCLUSIVE_PROTOCOL',
  'INCONCLUSIVE_OBSERVER',
  'INCONCLUSIVE_LIFECYCLE',
  'INCONCLUSIVE_PROVIDER_UNAVAILABLE'
])

export const failureEnvelopeSchema = z.strictObject({
  code: failureCodeSchema,
  phase: z.string().regex(SAFE_NAME).refine(value => !CREDENTIAL_REF_PATTERN.test(value), 'Credential-like phase rejected'),
  provider: z.string().regex(SAFE_NAME).refine(value => !CREDENTIAL_REF_PATTERN.test(value), 'Credential-like provider rejected'),
  causeClass: z.string().regex(SAFE_CAUSE).refine(value => !CREDENTIAL_REF_PATTERN.test(value), 'Credential-like cause class rejected'),
  boundedDetail: z.string().min(1).max(MAX_DETAIL).refine(
    value => !CREDENTIAL_ASSIGNMENT_PATTERN.test(value) && !BEARER_PATTERN.test(value),
    'Credential-like failure detail rejected'
  ),
  artifactRefs: z.array(z.string().regex(SAFE_ARTIFACT).refine(
    value => !CREDENTIAL_REF_PATTERN.test(value),
    'Credential-like artifact reference rejected'
  )).max(16),
  retryable: z.boolean(),
  trustBoundary: z.enum([
    'local-runtime',
    'external-provider',
    'trusted-probe',
    'lifecycle-orchestrator'
  ])
}).superRefine((value, context) => {
  if (new Set(value.artifactRefs).size !== value.artifactRefs.length) {
    context.addIssue({ code: 'custom', path: ['artifactRefs'], message: 'Duplicate artifact reference' })
  }
})

export type FailureEnvelopeCode = z.infer<typeof failureCodeSchema>
export type FailureEnvelope = z.infer<typeof failureEnvelopeSchema>

export interface FailureEnvelopeInput {
  code: FailureEnvelopeCode
  phase: string
  provider: string
  error: unknown
  artifactRefs?: readonly string[]
  retryable: boolean
  trustBoundary: FailureEnvelope['trustBoundary']
}

export function containsCredentialMaterial(value: string): boolean {
  return CREDENTIAL_ASSIGNMENT_PATTERN.test(value) || BEARER_PATTERN.test(value)
}

export function sanitizeCredentialText(value: string): string {
  const normalized = value
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(CREDENTIAL_ASSIGNMENT_REPLACE_PATTERN, '[REDACTED]')
    .replace(BEARER_REPLACE_PATTERN, '[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
  return (normalized || 'Provider failed').slice(0, MAX_DETAIL)
}

function errorDetail(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint') return String(error)
  return 'Provider failed with a non-Error cause'
}

function causeClass(error: unknown): string {
  if (error instanceof Error && SAFE_CAUSE.test(error.name)) return error.name
  if (error === null) return 'NullCause'
  const type = typeof error
  return SAFE_CAUSE.test(type) ? type : 'UnknownCause'
}

export function failureEnvelope(input: FailureEnvelopeInput): FailureEnvelope {
  return validateFailureEnvelope({
    code: input.code,
    phase: input.phase,
    provider: input.provider,
    causeClass: causeClass(input.error),
    boundedDetail: sanitizeCredentialText(errorDetail(input.error)),
    artifactRefs: [...(input.artifactRefs ?? [])],
    retryable: input.retryable,
    trustBoundary: input.trustBoundary
  })
}

export function validateFailureEnvelope(value: unknown): FailureEnvelope {
  return failureEnvelopeSchema.parse(value)
}
