import { z } from 'zod'
import {
  canonicalJvmArtifactObservationV1,
  parseJvmArtifactObservationV1,
  type JvmArtifactObservationV1
} from './jvm-artifact-observation.js'

const MAX_CANONICAL_BYTES = 16 * 1024
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/
const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key|bearer)/i

const safeId = z.string().regex(SAFE_ID)
  .refine(value => value === value.normalize('NFC'), 'Identifier must be NFC normalized')
  .refine(value => !CREDENTIAL_PATTERN.test(value), 'Credential-like identifier rejected')

const resultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  observedAtMs: z.number().int().safe().nonnegative(),
  claimedServerInstanceId: safeId,
  claimedBootId: safeId,
  jvmArtifactObservation: z.unknown()
})

export interface PaperJvmObservationResultV1 {
  readonly schemaVersion: 1
  readonly observedAtMs: number
  readonly claimedServerInstanceId: string
  readonly claimedBootId: string
  readonly jvmArtifactObservation: JvmArtifactObservationV1
}

function canonicalObject(value: PaperJvmObservationResultV1): unknown {
  return {
    schemaVersion: 1,
    observedAtMs: value.observedAtMs,
    claimedServerInstanceId: value.claimedServerInstanceId,
    claimedBootId: value.claimedBootId,
    jvmArtifactObservation: JSON.parse(
      canonicalJvmArtifactObservationV1(value.jvmArtifactObservation).toString('utf8')
    )
  }
}

function canonicalPaperJvmObservationResultInternal(input: unknown): Buffer {
  const parsed = resultSchema.parse(input)
  const result: PaperJvmObservationResultV1 = {
    schemaVersion: 1,
    observedAtMs: parsed.observedAtMs,
    claimedServerInstanceId: parsed.claimedServerInstanceId,
    claimedBootId: parsed.claimedBootId,
    jvmArtifactObservation: parseJvmArtifactObservationV1(parsed.jvmArtifactObservation)
  }
  const bytes = Buffer.from(JSON.stringify(canonicalObject(result)), 'utf8')
  if (bytes.length > MAX_CANONICAL_BYTES) throw new Error('Paper observation result exceeds canonical byte bound')
  return bytes
}

export function canonicalPaperJvmObservationResultV1(input: unknown): Buffer {
  try {
    return canonicalPaperJvmObservationResultInternal(input)
  } catch {
    throw new Error('Paper observation result is invalid')
  }
}

export function parseCanonicalPaperJvmObservationResultV1(input: Uint8Array): PaperJvmObservationResultV1 {
  let owned: Buffer
  try {
    if (!(input instanceof Uint8Array) || input.byteLength === 0 || input.byteLength > MAX_CANONICAL_BYTES) {
      throw new Error()
    }
    owned = Buffer.from(input)
  } catch {
    throw new Error('Paper observation result bytes are invalid')
  }
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(owned))
  } catch {
    throw new Error('Paper observation result JSON is invalid')
  }
  let result: PaperJvmObservationResultV1
  try {
    const parsed = resultSchema.parse(raw)
    result = Object.freeze({
      schemaVersion: 1 as const,
      observedAtMs: parsed.observedAtMs,
      claimedServerInstanceId: parsed.claimedServerInstanceId,
      claimedBootId: parsed.claimedBootId,
      jvmArtifactObservation: parseJvmArtifactObservationV1(parsed.jvmArtifactObservation)
    })
  } catch {
    throw new Error('Paper observation result is invalid')
  }
  const canonical = canonicalPaperJvmObservationResultInternal(result)
  if (!owned.equals(canonical)) throw new Error('Paper observation result is not canonical')
  return result
}
