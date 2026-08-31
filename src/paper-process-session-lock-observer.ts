import { execFileSync } from 'node:child_process'
import fs, { type BigIntStats } from 'node:fs'
import path from 'node:path'
import { types } from 'node:util'
import type {
  PaperProcessConfigurationFilesystemObservation,
  PaperProcessFilesystemObservation
} from './paper-process-filesystem-observer.js'
import {
  paperProcessProviderObservationMetadata,
  type PaperProcessProvider
} from './paper-process-provider.js'
import {
  preflightPaperProcessWithDeclaredArtifactAndTcpListenerObservations,
  type PaperProcessDeclaredArtifactsAndTcpListenerDryRunPreview,
  type PaperProcessTcpListenerObservation
} from './paper-process-tcp-listener-observer.js'

const WINDOWS_POWERSHELL_EXE = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
const POWERSHELL_TIMEOUT_MS = 5_000
const POWERSHELL_MAX_BUFFER_BYTES = 1024
const SESSION_LOCK_MARKER = Buffer.from('☃', 'utf8')
const observationCapabilities = new WeakSet<object>()
const LOCK_PROBE_SCRIPT = [
  '& {',
  '$ErrorActionPreference="Stop"',
  '[Console]::InputEncoding=[System.Text.UTF8Encoding]::new($false)',
  '$p=[Console]::In.ReadToEnd()',
  'if ([string]::IsNullOrEmpty($p) -or $p.Contains([char]0)) { throw "invalid path" }',
  'if (-not [System.IO.File]::Exists($p)) { [Console]::Out.Write("MISSING"); return }',
  '$s=[System.IO.File]::Open($p,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::ReadWrite)',
  'try {',
  '  try { $s.Lock(0,1); $s.Unlock(0,1); [Console]::Out.Write("UNLOCKED") }',
  '  catch [System.IO.IOException] {',
  '    if (($_.Exception.HResult -band 0xffffffffL) -eq 0x80070021L) { [Console]::Out.Write("LOCKED") }',
  '    else { throw }',
  '  }',
  '} finally { $s.Dispose() }',
  '}'
].join('\n')

type ProbeResult = 'MISSING' | 'UNLOCKED' | 'LOCKED'
type ProbeSnapshot = Readonly<{
  state: ProbeResult
  file: BigIntStats | undefined
}>

export interface PaperProcessSessionLockObservation {
  readonly schemaVersion: 1
  readonly root: string
  readonly targetBindingSha256: string
  readonly sessionLockLogicalPath: string
  readonly sessionLockFilePresent: boolean
  readonly sessionLockMarkerValidated: boolean
  readonly activeSessionLockObserved: boolean
  readonly observationSource: 'windows-byte-range-lock-probe'
  readonly observationStableAcrossTwoReads: true
  readonly observationTemporarilyAcquiresLockWhenClean: true
  readonly observationAtomic: false
  readonly observationFreshness: 'not-established'
  readonly sessionLockFactsAuthoritative: false
  readonly provesPaperProcessIdentity: false
}

export interface PaperProcessSessionLockObserver {
  observe(): Readonly<PaperProcessSessionLockObservation>
}

export type PaperProcessDeclaredArtifactTcpAndSessionLockDryRunPreview = Readonly<
  PaperProcessDeclaredArtifactsAndTcpListenerDryRunPreview & {
    readonly configuredSessionLockByteRangeStateObserved: true
    readonly configuredSessionLockLogicalPath: string
    readonly configuredSessionLockFilePresent: boolean
    readonly configuredSessionLockMarkerValidated: boolean
    readonly activeSessionLockObserved: false
    readonly sessionLockObservationStableAcrossTwoReads: true
    readonly sessionLockObservationTemporarilyAcquiresLockWhenClean: true
    readonly sessionLockObservationAtomic: false
    readonly sessionLockObservationFreshness: 'not-established'
    readonly sessionLockFactsAuthoritative: false
  }
>

export class PaperProcessSessionLockObservationError extends Error {
  constructor() {
    super('Paper process session lock observation rejected')
    this.name = 'PaperProcessSessionLockObservationError'
    Object.freeze(this)
  }
}

export class PaperProcessDeclaredArtifactTcpAndSessionLockPreflightError extends Error {
  constructor() {
    super('Paper process declared artifact, TCP and session lock preflight rejected')
    this.name = 'PaperProcessDeclaredArtifactTcpAndSessionLockPreflightError'
    Object.freeze(this)
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function strictSnapshot(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || types.isProxy(input)) throw new Error()
  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) throw new Error()
  const actualKeys = Object.keys(input).sort(compareText)
  const expectedKeys = [...keys].sort(compareText)
  if (actualKeys.length !== expectedKeys.length
    || !actualKeys.every((value, index) => value === expectedKeys[index])) throw new Error()
  const snapshot: Record<string, unknown> = {}
  for (const key of keys) snapshot[key] = (input as Record<string, unknown>)[key]
  return snapshot
}

function assertCanonicalDirectory(directory: string): BigIntStats {
  const stat = fs.lstatSync(directory, { bigint: true })
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync.native(directory) !== directory) {
    throw new Error()
  }
  return stat
}

function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
}

function lockFile(root: string, logicalPath: string): string {
  assertCanonicalDirectory(root)
  const parts = logicalPath.split('/')
  let current = root
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = path.join(current, parts[index]!)
    try {
      assertCanonicalDirectory(current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return path.join(root, ...parts)
      throw error
    }
  }
  const file = path.join(current, parts.at(-1)!)
  const relative = path.relative(root, file)
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error()
  }
  return file
}

function fileSnapshot(file: string): BigIntStats | undefined {
  try {
    const stat = fs.lstatSync(file, { bigint: true })
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n
      || stat.size !== BigInt(SESSION_LOCK_MARKER.byteLength)
      || fs.realpathSync.native(file) !== file) {
      throw new Error()
    }
    return stat
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function assertUnlockedMarker(file: string, expected: BigIntStats): void {
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY)
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true })
    if (!sameFile(expected, opened)) throw new Error()
    const marker = Buffer.alloc(SESSION_LOCK_MARKER.byteLength)
    if (fs.readSync(descriptor, marker, 0, marker.byteLength, 0) !== marker.byteLength
      || !marker.equals(SESSION_LOCK_MARKER)
      || !sameFile(opened, fs.fstatSync(descriptor, { bigint: true }))) throw new Error()
  } finally {
    fs.closeSync(descriptor)
  }
}

function probe(root: string, logicalPath: string): ProbeSnapshot {
  const file = lockFile(root, logicalPath)
  const before = fileSnapshot(file)
  const output = execFileSync(WINDOWS_POWERSHELL_EXE, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', LOCK_PROBE_SCRIPT
  ], {
    encoding: 'utf8',
    input: file,
    timeout: POWERSHELL_TIMEOUT_MS,
    maxBuffer: POWERSHELL_MAX_BUFFER_BYTES,
    windowsHide: true
  })
  if (Buffer.byteLength(output, 'utf8') > POWERSHELL_MAX_BUFFER_BYTES
    || (output !== 'MISSING' && output !== 'UNLOCKED' && output !== 'LOCKED')) throw new Error()
  const fileAfter = lockFile(root, logicalPath)
  if (fileAfter !== file) throw new Error()
  const after = fileSnapshot(fileAfter)
  if (output === 'MISSING') {
    if (before !== undefined || after !== undefined) throw new Error()
  } else if (before === undefined || after === undefined || !sameFile(before, after)) {
    throw new Error()
  }
  if (output === 'UNLOCKED') assertUnlockedMarker(file, after!)
  return { state: output, file: after }
}

export function assertIssuedPaperProcessSessionLockObservation(
  input: unknown
): asserts input is Readonly<PaperProcessSessionLockObservation> {
  if (typeof input !== 'object' || input === null || !observationCapabilities.has(input)) {
    throw new Error('Paper process session lock observation is invalid')
  }
}

export function createWindowsPaperProcessSessionLockObserver(
  provider: PaperProcessProvider
): Readonly<PaperProcessSessionLockObserver> {
  try {
    if (process.platform !== 'win32') throw new Error()
    const metadata = paperProcessProviderObservationMetadata(provider)
    const observer: PaperProcessSessionLockObserver = {
      observe(): Readonly<PaperProcessSessionLockObservation> {
        try {
          const first = probe(metadata.approvedRoot, metadata.sessionLockLogicalPath)
          const second = probe(metadata.approvedRoot, metadata.sessionLockLogicalPath)
          if (first.state !== second.state
            || (first.file === undefined) !== (second.file === undefined)
            || (first.file !== undefined && second.file !== undefined
              && !sameFile(first.file, second.file))) throw new Error()
          const observation = Object.freeze({
            schemaVersion: 1 as const,
            root: metadata.approvedRoot,
            targetBindingSha256: metadata.targetBindingSha256,
            sessionLockLogicalPath: metadata.sessionLockLogicalPath,
            sessionLockFilePresent: second.state !== 'MISSING',
            sessionLockMarkerValidated: second.state === 'UNLOCKED',
            activeSessionLockObserved: second.state === 'LOCKED',
            observationSource: 'windows-byte-range-lock-probe' as const,
            observationStableAcrossTwoReads: true as const,
            observationTemporarilyAcquiresLockWhenClean: true as const,
            observationAtomic: false as const,
            observationFreshness: 'not-established' as const,
            sessionLockFactsAuthoritative: false as const,
            provesPaperProcessIdentity: false as const
          })
          observationCapabilities.add(observation)
          return observation
        } catch {
          throw new PaperProcessSessionLockObservationError()
        }
      }
    }
    return Object.freeze(observer)
  } catch {
    throw new Error('Paper process session lock observer configuration is invalid')
  }
}

export function preflightPaperProcessWithDeclaredArtifactTcpAndSessionLockObservations(
  provider: PaperProcessProvider,
  executableObservationInput: Readonly<PaperProcessFilesystemObservation>,
  configurationObservationInput: Readonly<PaperProcessConfigurationFilesystemObservation>,
  tcpListenerObservationInput: Readonly<PaperProcessTcpListenerObservation>,
  sessionLockObservationInput: unknown,
  remainingFactsInput: unknown
): PaperProcessDeclaredArtifactTcpAndSessionLockDryRunPreview {
  try {
    assertIssuedPaperProcessSessionLockObservation(sessionLockObservationInput)
    const metadata = paperProcessProviderObservationMetadata(provider)
    if (sessionLockObservationInput.root !== metadata.approvedRoot
      || sessionLockObservationInput.targetBindingSha256 !== metadata.targetBindingSha256
      || sessionLockObservationInput.sessionLockLogicalPath !== metadata.sessionLockLogicalPath
      || !sessionLockObservationInput.sessionLockFilePresent
      || !sessionLockObservationInput.sessionLockMarkerValidated
      || sessionLockObservationInput.activeSessionLockObserved) throw new Error()
    const remainingFacts = strictSnapshot(remainingFactsInput, [
      'schemaVersion', 'onlinePlayers', 'authorizationId', 'requiredScope'
    ])
    const preview = preflightPaperProcessWithDeclaredArtifactAndTcpListenerObservations(
      provider,
      executableObservationInput,
      configurationObservationInput,
      tcpListenerObservationInput,
      {
        schemaVersion: remainingFacts.schemaVersion,
        sessionLockPresent: sessionLockObservationInput.activeSessionLockObserved,
        onlinePlayers: remainingFacts.onlinePlayers,
        authorizationId: remainingFacts.authorizationId,
        requiredScope: remainingFacts.requiredScope
      }
    )
    return Object.freeze({
      ...preview,
      configuredSessionLockByteRangeStateObserved: true as const,
      configuredSessionLockLogicalPath: sessionLockObservationInput.sessionLockLogicalPath,
      configuredSessionLockFilePresent: sessionLockObservationInput.sessionLockFilePresent,
      configuredSessionLockMarkerValidated: sessionLockObservationInput.sessionLockMarkerValidated,
      activeSessionLockObserved: false as const,
      sessionLockObservationStableAcrossTwoReads: true as const,
      sessionLockObservationTemporarilyAcquiresLockWhenClean: true as const,
      sessionLockObservationAtomic: false as const,
      sessionLockObservationFreshness: 'not-established' as const,
      sessionLockFactsAuthoritative: false as const
    })
  } catch {
    throw new PaperProcessDeclaredArtifactTcpAndSessionLockPreflightError()
  }
}
