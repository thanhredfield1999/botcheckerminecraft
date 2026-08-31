import { types } from 'node:util'
import minecraftProtocol, { type NewPingResult, type OldPingResult } from 'minecraft-protocol'
import {
  paperProcessProviderObservationMetadata,
  type PaperProcessProvider
} from './paper-process-provider.js'

const STATUS_HOST = '127.0.0.1'
const STATUS_VERSION = '1.21.11'
const STATUS_PROTOCOL = 774
const STATUS_CLOSE_TIMEOUT_MS = 5_000
const STATUS_NO_PONG_TIMEOUT_MS = 1_000
const MAX_REPORTED_PLAYERS = 10_000
const observationCapabilities = new WeakSet<object>()

export interface PaperProcessOnlinePlayerObservation {
  readonly schemaVersion: 1
  readonly root: string
  readonly targetBindingSha256: string
  readonly host: '127.0.0.1'
  readonly port: number
  readonly protocolVersion: '1.21.11'
  readonly reportedOnlinePlayers: number
  readonly reportedMaximumPlayers: number
  readonly observationSource: 'minecraft-server-list-status'
  readonly statusResponsesStableAcrossTwoReads: true
  readonly observationAtomic: false
  readonly observationFreshness: 'not-established'
  readonly onlinePlayerFactsAuthoritative: false
  readonly provesBukkitOnlinePlayers: false
  readonly provesZeroOnlinePlayers: false
  readonly usableForCleanPreflight: false
}

export interface PaperProcessOnlinePlayerObserver {
  observe(): Promise<Readonly<PaperProcessOnlinePlayerObservation>>
}

export class PaperProcessOnlinePlayerObservationError extends Error {
  constructor() {
    super('Paper process online player observation rejected')
    this.name = 'PaperProcessOnlinePlayerObservationError'
    Object.freeze(this)
  }
}

type StatusSnapshot = Readonly<{
  online: number
  maximum: number
}>

function strictObject(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || types.isProxy(input)) throw new Error()
  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) throw new Error()
  const actual = Object.keys(input).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || !actual.every((value, index) => value === expected[index])) {
    throw new Error()
  }
  const snapshot: Record<string, unknown> = {}
  for (const key of keys) snapshot[key] = (input as Record<string, unknown>)[key]
  return snapshot
}

function parseStatus(input: OldPingResult | NewPingResult): StatusSnapshot {
  const response = strictObject(input, [
    'description', 'players', 'version', 'favicon', 'enforcesSecureChat', 'previewsChat', 'latency'
  ].filter(key => Object.prototype.hasOwnProperty.call(input, key)))
  if (!Object.prototype.hasOwnProperty.call(response, 'players')
    || !Object.prototype.hasOwnProperty.call(response, 'version')) throw new Error()
  const version = strictObject(response.version, ['name', 'protocol'])
  if (version.name !== STATUS_VERSION || version.protocol !== STATUS_PROTOCOL) throw new Error()
  const players = strictObject(response.players, [
    'max', 'online', 'sample'
  ].filter(key => Object.prototype.hasOwnProperty.call(response.players, key)))
  const online = players.online
  const maximum = players.max
  if (!Number.isSafeInteger(online) || !Number.isSafeInteger(maximum)
    || (online as number) < 0 || (maximum as number) < 0
    || (online as number) > (maximum as number)
    || (maximum as number) > MAX_REPORTED_PLAYERS) throw new Error()
  return Object.freeze({ online: online as number, maximum: maximum as number })
}

async function status(port: number): Promise<StatusSnapshot> {
  const result = await minecraftProtocol.ping({
    host: STATUS_HOST,
    port,
    version: STATUS_VERSION,
    closeTimeout: STATUS_CLOSE_TIMEOUT_MS,
    noPongTimeout: STATUS_NO_PONG_TIMEOUT_MS
  })
  return parseStatus(result)
}

export function assertIssuedPaperProcessOnlinePlayerObservation(
  input: unknown
): asserts input is Readonly<PaperProcessOnlinePlayerObservation> {
  if (typeof input !== 'object' || input === null || !observationCapabilities.has(input)) {
    throw new Error('Paper process online player observation is invalid')
  }
}

export function createPaperProcessOnlinePlayerObserver(
  provider: PaperProcessProvider
): Readonly<PaperProcessOnlinePlayerObserver> {
  try {
    const metadata = paperProcessProviderObservationMetadata(provider)
    const observer: PaperProcessOnlinePlayerObserver = {
      async observe(): Promise<Readonly<PaperProcessOnlinePlayerObservation>> {
        try {
          const first = await status(metadata.port)
          const second = await status(metadata.port)
          if (first.online !== second.online || first.maximum !== second.maximum) throw new Error()
          const observation = Object.freeze({
            schemaVersion: 1 as const,
            root: metadata.approvedRoot,
            targetBindingSha256: metadata.targetBindingSha256,
            host: STATUS_HOST,
            port: metadata.port,
            protocolVersion: STATUS_VERSION,
            reportedOnlinePlayers: second.online,
            reportedMaximumPlayers: second.maximum,
            observationSource: 'minecraft-server-list-status' as const,
            statusResponsesStableAcrossTwoReads: true as const,
            observationAtomic: false as const,
            observationFreshness: 'not-established' as const,
            onlinePlayerFactsAuthoritative: false as const,
            provesBukkitOnlinePlayers: false as const,
            provesZeroOnlinePlayers: false as const,
            usableForCleanPreflight: false as const
          })
          observationCapabilities.add(observation)
          return observation
        } catch {
          throw new PaperProcessOnlinePlayerObservationError()
        }
      }
    }
    return Object.freeze(observer)
  } catch {
    throw new Error('Paper process online player observer configuration is invalid')
  }
}
