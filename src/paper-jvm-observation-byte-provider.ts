import { types } from 'node:util'
import { parseCanonicalPaperJvmObservationResultV1 } from './paper-jvm-observation-result-codec.js'
import type {
  SignedProviderObservationProvider,
  SignedProviderObservationRequest
} from './signed-provider-observer-signing-pipeline.js'

export type PaperJvmObservationByteSource = (
  request: Readonly<SignedProviderObservationRequest>
) => Uint8Array | Promise<Uint8Array>

const abortSignalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get

function snapshotSignal(request: Readonly<SignedProviderObservationRequest>): AbortSignal {
  try {
    const signal = request.signal
    if (!(signal instanceof AbortSignal) || types.isProxy(signal) || !abortSignalAborted) throw new Error()
    abortSignalAborted.call(signal)
    return signal
  } catch {
    throw new Error('Paper observation byte request is invalid')
  }
}

function signalAborted(signal: AbortSignal): boolean {
  try {
    return abortSignalAborted?.call(signal) === true
  } catch {
    throw new Error('Paper observation byte request is invalid')
  }
}

export function createPaperJvmObservationByteProvider(
  source: PaperJvmObservationByteSource
): SignedProviderObservationProvider {
  if (typeof source !== 'function') throw new Error('Paper observation byte source is invalid')

  return async request => {
    const signal = snapshotSignal(request)
    if (signalAborted(signal)) throw new Error('Paper observation byte request cancelled')

    let bytes: Uint8Array
    try {
      bytes = await source(request)
    } catch {
      throw new Error('Paper observation byte source failed')
    }

    if (signalAborted(signal)) throw new Error('Paper observation byte request cancelled')
    try {
      return parseCanonicalPaperJvmObservationResultV1(bytes)
    } catch {
      throw new Error('Paper observation byte source returned invalid bytes')
    }
  }
}
