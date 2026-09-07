import net, { type Socket } from 'node:net'
import { types } from 'node:util'
import {
  decodePaperBukkitOnlinePlayerResponseFrameV1,
  encodePaperBukkitOnlinePlayerRequestFrameV1,
  type PaperBukkitOnlinePlayerChallengeV1,
  type PaperBukkitOnlinePlayerEnvelopeV1
} from './paper-bukkit-online-player-transport-codec.js'

const LOOPBACK_HOST = '127.0.0.1'
const MIN_TIMEOUT_MS = 1
const MAX_TIMEOUT_MS = 60_000
const MAX_RESPONSE_FRAME_BYTES = 11 + 16 * 1024 + 64
const signalAbortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get

export interface PaperBukkitOnlinePlayerLoopbackClient {
  request(
    challenge: PaperBukkitOnlinePlayerChallengeV1,
    signal: AbortSignal
  ): Promise<PaperBukkitOnlinePlayerEnvelopeV1>
}

function strictOptions(input: unknown): Readonly<{ port: number, timeoutMs: number }> {
  try {
    if (typeof input !== 'object' || input === null || types.isProxy(input)) throw new Error()
    const prototype = Object.getPrototypeOf(input)
    if (prototype !== Object.prototype && prototype !== null) throw new Error()
    const keys = Object.keys(input).sort()
    if (keys.length !== 2 || keys[0] !== 'port' || keys[1] !== 'timeoutMs') throw new Error()
    const snapshot = input as Record<string, unknown>
    const port = snapshot.port
    const timeoutMs = snapshot.timeoutMs
    if (!Number.isSafeInteger(port) || (port as number) < 1 || (port as number) > 65_535
      || !Number.isSafeInteger(timeoutMs) || (timeoutMs as number) < MIN_TIMEOUT_MS
      || (timeoutMs as number) > MAX_TIMEOUT_MS) throw new Error()
    return Object.freeze({ port: port as number, timeoutMs: timeoutMs as number })
  } catch {
    throw new Error('Paper Bukkit loopback client options are invalid')
  }
}

function validSignal(input: unknown): AbortSignal {
  try {
    if (!(input instanceof AbortSignal) || types.isProxy(input) || !signalAbortedGetter) throw new Error()
    signalAbortedGetter.call(input)
    return input
  } catch {
    throw new Error('Paper Bukkit loopback request signal is invalid')
  }
}

function isAborted(signal: AbortSignal): boolean {
  try {
    return signalAbortedGetter?.call(signal) === true
  } catch {
    return true
  }
}

export function createPaperBukkitOnlinePlayerLoopbackClient(
  input: unknown
): PaperBukkitOnlinePlayerLoopbackClient {
  const options = strictOptions(input)
  let active = false

  return Object.freeze({
    async request(challenge: PaperBukkitOnlinePlayerChallengeV1, signalInput: AbortSignal) {
      if (active) throw new Error('Paper Bukkit loopback client is busy')
      const signal = validSignal(signalInput)
      if (isAborted(signal)) throw new Error('Paper Bukkit loopback request cancelled')
      let requestFrame: Buffer
      try {
        requestFrame = encodePaperBukkitOnlinePlayerRequestFrameV1(challenge)
      } catch {
        throw new Error('Paper Bukkit loopback request is invalid')
      }
      active = true
      try {
        return await exchange(options.port, options.timeoutMs, requestFrame, signal)
      } finally {
        active = false
      }
    }
  })
}

function exchange(
  port: number,
  timeoutMs: number,
  requestFrame: Buffer,
  signal: AbortSignal
): Promise<PaperBukkitOnlinePlayerEnvelopeV1> {
  return new Promise((resolve, reject) => {
    let socket: Socket | undefined
    let settled = false
    let responseBytes = 0
    const chunks: Buffer[] = []

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
      socket?.removeAllListeners()
      socket?.setTimeout(0)
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      socket?.destroy()
      reject(error)
    }
    const succeed = (value: PaperBukkitOnlinePlayerEnvelopeV1) => {
      if (settled) return
      settled = true
      cleanup()
      socket?.destroy()
      resolve(value)
    }
    const onAbort = () => fail(new Error('Paper Bukkit loopback request cancelled'))

    signal.addEventListener('abort', onAbort, { once: true })
    if (isAborted(signal)) {
      onAbort()
      return
    }

    try {
      socket = net.createConnection({
        host: LOOPBACK_HOST,
        port,
        family: 4,
        allowHalfOpen: true
      })
      socket.setNoDelay(true)
      socket.setTimeout(timeoutMs)
      socket.once('connect', () => {
        if (!settled) socket?.end(requestFrame)
      })
      socket.on('data', chunk => {
        if (settled) return
        const owned = Buffer.from(chunk)
        responseBytes += owned.byteLength
        if (!Number.isSafeInteger(responseBytes) || responseBytes > MAX_RESPONSE_FRAME_BYTES) {
          fail(new Error('Paper Bukkit loopback response is invalid'))
          return
        }
        chunks.push(owned)
      })
      socket.once('end', () => {
        if (settled) return
        try {
          succeed(decodePaperBukkitOnlinePlayerResponseFrameV1(Buffer.concat(chunks, responseBytes)))
        } catch {
          fail(new Error('Paper Bukkit loopback response is invalid'))
        }
      })
      socket.once('timeout', () => fail(new Error('Paper Bukkit loopback request timed out')))
      socket.once('error', () => fail(new Error('Paper Bukkit loopback request failed')))
      socket.once('close', hadError => {
        if (!settled && !hadError) fail(new Error('Paper Bukkit loopback response is invalid'))
      })
    } catch {
      fail(new Error('Paper Bukkit loopback request failed'))
    }
  })
}
