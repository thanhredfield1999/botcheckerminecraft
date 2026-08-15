import { createHash } from 'node:crypto'

export interface ProtocolDecodeDiagnostic {
  field?: string
  frameLength?: number
  frameSha256?: string
}

export function summarizeProtocolDecodeError(error: unknown): ProtocolDecodeDiagnostic {
  if (typeof error !== 'object' || error === null) return {}

  const candidate = error as { field?: unknown; buffer?: unknown }
  const diagnostic: ProtocolDecodeDiagnostic = {}
  if (typeof candidate.field === 'string') diagnostic.field = candidate.field.slice(0, 512)
  if (!Buffer.isBuffer(candidate.buffer)) return diagnostic

  diagnostic.frameLength = candidate.buffer.length
  diagnostic.frameSha256 = createHash('sha256').update(candidate.buffer).digest('hex')
  return diagnostic
}
