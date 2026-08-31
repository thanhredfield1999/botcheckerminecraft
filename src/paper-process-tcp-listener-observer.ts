import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { types } from 'node:util'
import { z } from 'zod'
import {
  preflightPaperProcessWithDeclaredArtifactFileObservations,
  type PaperProcessDeclaredArtifactFilesDryRunPreview
} from './paper-process-filesystem-observer.js'
import {
  artifactTargetBindingSha256,
  validateArtifactTargetBinding
} from './target-binding.js'

const WINDOWS_NETSTAT_EXE = 'C:\\Windows\\System32\\netstat.exe'
const NETSTAT_TIMEOUT_MS = 5_000
const NETSTAT_MAX_BUFFER_BYTES = 1024 * 1024
const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key|bearer)/i
const PRODUCTION_ROOT_PARTS = new Set(['live', 'prod', 'production', 'server', 'minecraftserver'])
const observationCapabilities = new WeakSet<object>()

const absoluteRootSchema = z.string().min(1).max(1024).superRefine((value, context) => {
  if (value !== value.normalize('NFC')
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
    || path.normalize(value) !== value
    || value === path.parse(value).root
    || CREDENTIAL_PATTERN.test(value)
    || value.split(/[\\/]+/).some(part => PRODUCTION_ROOT_PARTS.has(part.toLowerCase()))) {
    context.addIssue({ code: 'custom', message: 'Invalid approved root' })
  }
})
const configSchema = z.strictObject({
  schemaVersion: z.literal(1),
  approvedRoot: absoluteRootSchema,
  port: z.number().int().min(1).max(65_535),
  targetBinding: z.unknown()
})

export interface PaperProcessTcpListenerObservation {
  readonly schemaVersion: 1
  readonly root: string
  readonly targetBindingSha256: string
  readonly port: number
  readonly configuredTcpPortListenerOwnersObserved: true
  readonly portListening: boolean
  readonly owningPids: readonly number[]
  readonly observationSource: 'windows-netstat-ano'
  readonly observationStableAcrossTwoReads: true
  readonly observationAtomic: false
  readonly observationFreshness: 'not-established'
  readonly tcpListenerFactsAuthoritative: false
  readonly provesPaperProcessIdentity: false
}

export interface PaperProcessTcpListenerObserver {
  observe(): Readonly<PaperProcessTcpListenerObservation>
}

export type PaperProcessDeclaredArtifactsAndTcpListenerDryRunPreview = Readonly<
  PaperProcessDeclaredArtifactFilesDryRunPreview & {
    readonly configuredTcpPortListenerOwnersObserved: true
    readonly configuredTcpPortListening: boolean
    readonly configuredTcpPortOwningPids: readonly number[]
    readonly tcpListenerObservationStableAcrossTwoReads: true
    readonly tcpListenerObservationAtomic: false
    readonly tcpListenerObservationFreshness: 'not-established'
    readonly tcpListenerFactsAuthoritative: false
    readonly provesPaperProcessIdentity: false
  }
>

export class PaperProcessTcpListenerObservationError extends Error {
  constructor() {
    super('Paper process TCP listener observation rejected')
    this.name = 'PaperProcessTcpListenerObservationError'
    Object.freeze(this)
  }
}

export class PaperProcessDeclaredArtifactAndTcpListenerPreflightError extends Error {
  constructor() {
    super('Paper process declared artifact and TCP listener preflight rejected')
    this.name = 'PaperProcessDeclaredArtifactAndTcpListenerPreflightError'
    Object.freeze(this)
  }
}

function compareNumber(left: number, right: number): number {
  return left - right
}

function strictSnapshot(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || types.isProxy(input)) throw new Error()
  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) throw new Error()
  const actualKeys = Object.keys(input).sort()
  const expectedKeys = [...keys].sort()
  if (actualKeys.length !== expectedKeys.length
    || !actualKeys.every((value, index) => value === expectedKeys[index])) throw new Error()
  const snapshot: Record<string, unknown> = {}
  for (const key of keys) snapshot[key] = (input as Record<string, unknown>)[key]
  return snapshot
}

function parseConfiguration(input: unknown): z.infer<typeof configSchema> {
  return configSchema.parse(strictSnapshot(input, [
    'schemaVersion', 'approvedRoot', 'port', 'targetBinding'
  ]))
}

function listenerPids(output: string, port: number): readonly number[] {
  if (Buffer.byteLength(output, 'utf8') > NETSTAT_MAX_BUFFER_BYTES) throw new Error()
  const pids = new Set<number>()
  let recognizedTcpRows = 0
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0
      || /^Active Connections$/i.test(trimmed)
      || /^Proto\s+Local Address\s+Foreign Address\s+State\s+PID$/i.test(trimmed)) continue
    const row = /^TCP\s+(\S+)\s+\S+\s+(\S+)\s+(\d+)$/i.exec(trimmed)
    if (!row) throw new Error()
    recognizedTcpRows += 1
    const localPort = /:(\d+)$/.exec(row[1]!)
    const parsedLocalPort = localPort ? Number(localPort[1]) : Number.NaN
    const pid = Number(row[3])
    if (!Number.isSafeInteger(parsedLocalPort)
      || parsedLocalPort < 1
      || parsedLocalPort > 65_535
      || !Number.isSafeInteger(pid)
      || pid < 0) throw new Error()
    if (row[2]!.toUpperCase() !== 'LISTENING' || parsedLocalPort !== port) continue
    if (pid === 0) throw new Error()
    pids.add(pid)
  }
  if (recognizedTcpRows === 0) throw new Error()
  return Object.freeze([...pids].sort(compareNumber))
}

function readWindowsNetstatListenerPids(port: number): readonly number[] {
  if (process.platform !== 'win32') throw new Error()
  const output = execFileSync(WINDOWS_NETSTAT_EXE, ['-ano', '-p', 'tcp'], {
    encoding: 'utf8',
    timeout: NETSTAT_TIMEOUT_MS,
    maxBuffer: NETSTAT_MAX_BUFFER_BYTES,
    windowsHide: true
  })
  return listenerPids(output, port)
}

function samePids(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((pid, index) => pid === right[index])
}

export function assertIssuedPaperProcessTcpListenerObservation(
  input: unknown
): asserts input is Readonly<PaperProcessTcpListenerObservation> {
  if (typeof input !== 'object' || input === null || !observationCapabilities.has(input)) {
    throw new Error('Paper process TCP listener observation is invalid')
  }
}

export function createWindowsPaperProcessTcpListenerObserver(
  input: unknown
): Readonly<PaperProcessTcpListenerObserver> {
  try {
    const config = parseConfiguration(input)
    const binding = validateArtifactTargetBinding(config.targetBinding)
    if (binding.provider.kind !== 'paper-process') throw new Error()
    const targetBindingSha256 = artifactTargetBindingSha256(binding)
    const observer: PaperProcessTcpListenerObserver = {
      observe(): Readonly<PaperProcessTcpListenerObservation> {
        try {
          const first = readWindowsNetstatListenerPids(config.port)
          const second = readWindowsNetstatListenerPids(config.port)
          if (!samePids(first, second)) throw new Error()
          const observation = Object.freeze({
            schemaVersion: 1 as const,
            root: config.approvedRoot,
            targetBindingSha256,
            port: config.port,
            configuredTcpPortListenerOwnersObserved: true as const,
            portListening: second.length > 0,
            owningPids: second,
            observationSource: 'windows-netstat-ano' as const,
            observationStableAcrossTwoReads: true as const,
            observationAtomic: false as const,
            observationFreshness: 'not-established' as const,
            tcpListenerFactsAuthoritative: false as const,
            provesPaperProcessIdentity: false as const
          })
          observationCapabilities.add(observation)
          return observation
        } catch {
          throw new PaperProcessTcpListenerObservationError()
        }
      }
    }
    return Object.freeze(observer)
  } catch {
    throw new Error('Paper process TCP listener observer configuration is invalid')
  }
}

export function preflightPaperProcessWithDeclaredArtifactAndTcpListenerObservations(
  provider: unknown,
  executableObservationInput: unknown,
  configurationObservationInput: unknown,
  tcpListenerObservationInput: unknown,
  remainingFactsInput: unknown
): PaperProcessDeclaredArtifactsAndTcpListenerDryRunPreview {
  try {
    assertIssuedPaperProcessTcpListenerObservation(tcpListenerObservationInput)
    const remainingFacts = strictSnapshot(remainingFactsInput, [
      'schemaVersion', 'sessionLockPresent', 'onlinePlayers', 'authorizationId', 'requiredScope'
    ])
    const preview = preflightPaperProcessWithDeclaredArtifactFileObservations(
      provider,
      executableObservationInput,
      configurationObservationInput,
      {
        schemaVersion: remainingFacts.schemaVersion,
        port: tcpListenerObservationInput.port,
        portListening: tcpListenerObservationInput.portListening,
        pid: tcpListenerObservationInput.owningPids[0] ?? null,
        sessionLockPresent: remainingFacts.sessionLockPresent,
        onlinePlayers: remainingFacts.onlinePlayers,
        authorizationId: remainingFacts.authorizationId,
        requiredScope: remainingFacts.requiredScope
      }
    )
    if (preview.approvedRoot !== tcpListenerObservationInput.root
      || preview.targetBindingSha256 !== tcpListenerObservationInput.targetBindingSha256) {
      throw new Error()
    }
    return Object.freeze({
      ...preview,
      configuredTcpPortListenerOwnersObserved: true as const,
      configuredTcpPortListening: tcpListenerObservationInput.portListening,
      configuredTcpPortOwningPids: tcpListenerObservationInput.owningPids,
      tcpListenerObservationStableAcrossTwoReads: true as const,
      tcpListenerObservationAtomic: false as const,
      tcpListenerObservationFreshness: 'not-established' as const,
      tcpListenerFactsAuthoritative: false as const,
      provesPaperProcessIdentity: false as const
    })
  } catch {
    throw new PaperProcessDeclaredArtifactAndTcpListenerPreflightError()
  }
}
