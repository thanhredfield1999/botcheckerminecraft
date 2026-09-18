import { createHash } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { types } from 'node:util'
import { createBot } from 'mineflayer'
import { createPaperBukkitOnlinePlayerVerifiedOnlinePlayerSource } from '../paper-bukkit-online-player-runtime.js'
import { createPaperBukkitOnlinePlayerLoopbackClient } from '../paper-bukkit-online-player-loopback-client.js'
import { artifactTargetBindingSha256, buildArtifactTargetBinding, type ArtifactTargetBinding } from '../target-binding.js'

const SHA256 = /^[a-f0-9]{64}$/
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/
const VERSION = /^[a-zA-Z0-9][a-zA-Z0-9._:+-]{0,127}$/
const ENVIRONMENT_VARIABLE = /^[A-Z][A-Z0-9_]{0,127}$/
const CREDENTIAL = /(password|passwd|secret|token|credential|api[_-]?key|bearer)/i

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

export interface ControlledPaperPolicyInput {
  readonly companionPluginName: string
  readonly port: number
  readonly socketTimeoutMs: number
  readonly snapshotTimeoutMs: number
  readonly maxLedgerEntries: number
  readonly verifierAudience: string
  readonly verifierInstanceId: string
  readonly keyId: string
  readonly bindingId: string
  readonly targetBindingSha256: string
  readonly providerId: string
  readonly providerVersion: string
  readonly providerInstanceId: string
  readonly trustStoreId: string
  readonly trustStoreVersion: string
  readonly trustStoreSha256: string
  readonly serverInstanceId: string
}

export interface ControlledPaperCompanionInput {
  readonly keyStorePath: string
  readonly alias: string
  readonly passwordEnvironmentVariable: string
}

function cleanId(value: string, label: string): void {
  if (typeof value !== 'string' || !ID.test(value) || CREDENTIAL.test(value)) {
    throw new Error(`Controlled Paper ${label} is invalid`)
  }
}

function cleanVersion(value: string, label: string): void {
  if (typeof value !== 'string' || !VERSION.test(value) || CREDENTIAL.test(value)) {
    throw new Error(`Controlled Paper ${label} is invalid`)
  }
}

function cleanSha256(value: string, label: string): void {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new Error(`Controlled Paper ${label} is invalid`)
  }
}

function cleanPort(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new Error('Controlled Paper port is invalid')
  }
}

export function adapterConfigYaml(policyInput: ControlledPaperPolicyInput): string {
  cleanId(policyInput.companionPluginName, 'companion plugin')
  cleanPort(policyInput.port)
  if (!Number.isSafeInteger(policyInput.socketTimeoutMs) || policyInput.socketTimeoutMs < 1 || policyInput.socketTimeoutMs > 60_000
    || !Number.isSafeInteger(policyInput.snapshotTimeoutMs) || policyInput.snapshotTimeoutMs < 1 || policyInput.snapshotTimeoutMs > 60_000
    || !Number.isSafeInteger(policyInput.maxLedgerEntries) || policyInput.maxLedgerEntries < 1 || policyInput.maxLedgerEntries > 1_024) {
    throw new Error('Controlled Paper transport bounds are invalid')
  }
  cleanId(policyInput.verifierAudience, 'verifier audience')
  cleanId(policyInput.verifierInstanceId, 'verifier instance ID')
  cleanSha256(policyInput.keyId, 'key ID')
  cleanId(policyInput.bindingId, 'binding ID')
  cleanSha256(policyInput.targetBindingSha256, 'target binding')
  cleanId(policyInput.providerId, 'provider ID')
  cleanVersion(policyInput.providerVersion, 'provider version')
  cleanId(policyInput.providerInstanceId, 'provider instance ID')
  cleanId(policyInput.trustStoreId, 'trust store ID')
  cleanVersion(policyInput.trustStoreVersion, 'trust store version')
  cleanSha256(policyInput.trustStoreSha256, 'trust store SHA-256')
  cleanId(policyInput.serverInstanceId, 'server instance ID')

  return `# BotChecker Paper adapter — generated NON-SECRET configuration for a controlled journey.
companion-plugin-name: ${policyInput.companionPluginName}

transport:
  port: ${policyInput.port}
  socket-timeout-ms: ${policyInput.socketTimeoutMs}
  snapshot-timeout-ms: ${policyInput.snapshotTimeoutMs}
  max-ledger-entries: ${policyInput.maxLedgerEntries}

verifier:
  audience: ${policyInput.verifierAudience}
  instance-id: ${policyInput.verifierInstanceId}

key:
  id: ${policyInput.keyId}

binding:
  id: ${policyInput.bindingId}
  target-binding-sha256: ${policyInput.targetBindingSha256}

provider:
  id: ${policyInput.providerId}
  version: ${policyInput.providerVersion}
  instance-id: ${policyInput.providerInstanceId}

trust-store:
  id: ${policyInput.trustStoreId}
  version: ${policyInput.trustStoreVersion}
  sha256: ${policyInput.trustStoreSha256}

server:
  instance-id: ${policyInput.serverInstanceId}
`
}

export function companionConfigYaml(companionInput: ControlledPaperCompanionInput): string {
  if (typeof companionInput.keyStorePath !== 'string'
    || !path.isAbsolute(companionInput.keyStorePath)
    || companionInput.keyStorePath.length > 1_024
    || companionInput.keyStorePath.includes('\n')
    || CREDENTIAL.test(companionInput.keyStorePath)) {
    throw new Error('Controlled Paper keystore path is invalid')
  }
  cleanId(companionInput.alias, 'keystore alias')
  if (typeof companionInput.passwordEnvironmentVariable !== 'string'
    || !ENVIRONMENT_VARIABLE.test(companionInput.passwordEnvironmentVariable)) {
    throw new Error('Controlled Paper password environment variable is invalid')
  }
  return `# BotChecker KeyStore companion — NON-SECRET metadata for a controlled journey.
keystore:
  path: ${companionInput.keyStorePath}
  alias: ${companionInput.alias}
  password-environment-variable: ${companionInput.passwordEnvironmentVariable}
`
}

export function serverPropertiesText(port: number): string {
  cleanPort(port)
  return `# BotChecker controlled Paper journey — minimal server properties.
server-port=${port}
online-mode=false
motd=BotChecker controlled Paper journey
level-type=minecraft\\:flat
generate-structures=false
spawn-protection=0
view-distance=4
simulation-distance=4
max-players=8
allow-nether=false
level-name=world
`
}

export function eulaText(): string {
  return 'eula=true\n'
}

export function buildPaperSpawnArgs(options: {
  readonly javaExecutable: string
  readonly paperJarPath: string
  readonly pluginsDir: string
  readonly worldDir: string
  readonly memoryMb: number
}): string[] {
  if (options.javaExecutable.length < 1 || options.paperJarPath.length < 1
    || options.pluginsDir.length < 1 || options.worldDir.length < 1) {
    throw new Error('Controlled Paper spawn path is invalid')
  }
  if (!Number.isSafeInteger(options.memoryMb) || options.memoryMb < 256 || options.memoryMb > 8_192) {
    throw new Error('Controlled Paper memory bound is invalid')
  }
  return [
    options.javaExecutable,
    '-Xms256M',
    `-Xmx${options.memoryMb}M`,
    '-jar',
    options.paperJarPath,
    'nogui',
    '--plugins',
    options.pluginsDir,
    '--world-dir',
    options.worldDir
  ]
}

export function paperLogReady(line: string): boolean {
  return /Done \(\d+[.,]\d+s\)!/.test(line)
}

export interface PaperStopEvidence {
  readonly adapterDisabled: boolean
  readonly companionDisabled: boolean
}

export function classifyPaperStopEvidence(logText: string): PaperStopEvidence {
  return Object.freeze({
    adapterDisabled: logText.includes('Disabling BotCheckerPaperAdapter'),
    companionDisabled: logText.includes('Disabling BotCheckerKeyStoreCompanion')
  })
}

export interface PaperReadinessProbe {
  readonly portListening: boolean
  readonly logDone: boolean
  readonly exited: boolean
}

export async function waitForPaperReady(options: {
  readonly poll: () => Promise<PaperReadinessProbe>
  readonly deadlineMs: number
}): Promise<{ readonly ready: true }> {
  if (!Number.isSafeInteger(options.deadlineMs) || options.deadlineMs < 1) {
    throw new Error('Controlled Paper readiness deadline is invalid')
  }
  const started = Date.now()
  while (Date.now() - started < options.deadlineMs) {
    const probe = await options.poll()
    if (probe.exited) throw new Error('Paper process đã thoát')
    if (probe.portListening && probe.logDone) return Object.freeze({ ready: true as const })
    await sleep(500)
  }
  throw new Error('Paper không sẵn sàng trong thời gian cho phép')
}

export function buildStopCommand(): string {
  return 'stop\n'
}

const USERNAME = /^[A-Za-z0-9_]{1,16}$/
const MC_VERSION = /^\d+\.\d+(\.\d+)?$/

export interface ControlledPaperJoinClientInput {
  readonly username: string
  readonly version?: string
}

export function validateJoinClientInput(input: unknown): ControlledPaperJoinClientInput {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Controlled Paper join client is invalid')
  }
  const record = input as Record<string, unknown>
  const username = record.username
  const version = record.version
  if (typeof username !== 'string' || !USERNAME.test(username)
    || (version !== undefined && (typeof version !== 'string' || !MC_VERSION.test(version)))) {
    throw new Error('Controlled Paper join client is invalid')
  }
  return Object.freeze(
    version === undefined
      ? { username }
      : { username, version }
  )
}

export function validateJoinClientsInput(input: unknown): readonly ControlledPaperJoinClientInput[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 4 || types.isProxy(input)) {
    throw new Error('Controlled Paper join clients are invalid')
  }
  const clients = input.map(item => validateJoinClientInput(item))
  const usernames = new Set(clients.map(client => client.username))
  if (usernames.size !== clients.length) {
    throw new Error('Controlled Paper join clients are invalid')
  }
  return Object.freeze(clients.map(client => Object.freeze(client)))
}

/** Trích bootId duy nhất theo thứ tự các boot; một boot id giống nhau bị coi là một. */
export function distinctBootIds(claims: readonly { readonly bootId: string }[]): readonly string[] {
  if (!Array.isArray(claims) || claims.length < 1) {
    throw new Error('Controlled Paper boot claims are invalid')
  }
  const seen: string[] = []
  for (const claim of claims) {
    if (typeof claim?.bootId !== 'string' || claim.bootId.length === 0) {
      throw new Error('Controlled Paper boot claim is invalid')
    }
    if (!seen.includes(claim.bootId)) seen.push(claim.bootId)
  }
  return Object.freeze(seen)
}

function sha256Bytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Join một client thật vào server controlled (offline mode) để Bukkit online-player set có người. */
async function joinMinecraftClient(
  join: ControlledPaperJoinClientInput,
  port: number,
  timeoutMs: number
): Promise<{ readonly quit: () => void }> {
  const bot = createBot({
    host: '127.0.0.1',
    port,
    username: join.username,
    auth: 'offline',
    version: join.version ?? '1.21.11'
  })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Controlled Paper client join timed out'))
    }, timeoutMs)
    const cleanup = () => clearTimeout(timer)
    bot.once('spawn', () => {
      cleanup()
      resolve()
    })
    bot.once('error', () => {
      cleanup()
      reject(new Error('Controlled Paper client join failed'))
    })
    bot.once('kicked', () => {
      cleanup()
      reject(new Error('Controlled Paper client was kicked'))
    })
    bot.once('end', () => {
      cleanup()
      reject(new Error('Controlled Paper client disconnected during join'))
    })
  })
  // Chờ Paper xử lý login và cập nhật online-player set trước khi issue challenge.
  await sleep(1_500)
  return Object.freeze({
    quit: () => {
      try { bot.quit('observation-complete') } catch { /* đóng im lặng */ }
    }
  })
}

function readBoundedLog(logPath: string): string {
  try {
    const bytes = readFileSync(logPath)
    const tail = bytes.subarray(Math.max(0, bytes.byteLength - 2_000_000))
    return tail.toString('utf8')
  } catch {
    return ''
  }
}

export interface ControlledPaperJourneyOptions {
  readonly isolatedRoot: string
  readonly paperJarPath: string
  readonly adapterJarPath: string
  readonly companionJarPath: string
  readonly javaExecutable: string
  readonly policy: ControlledPaperPolicyInput
  readonly companion: ControlledPaperCompanionInput
  readonly trustStore: unknown
  readonly keyId: string
  readonly memoryMb: number
  readonly minecraftPort: number
  readonly joinClients?: readonly ControlledPaperJoinClientInput[]
  readonly readyDeadlineMs: number
  readonly stopDeadlineMs: number
  readonly stopMode?: 'graceful' | 'crash'
  readonly password: string
  readonly runId: string
  readonly authorizationId: string
}

export interface ControlledPaperJourneyEvidence {
  readonly schemaVersion: 1
  readonly runId: string
  readonly ready: boolean
  readonly claim: {
    readonly verified: boolean
    readonly onlinePlayers: number
    readonly claimedServerInstanceId: string
    readonly claimedBootId: string
    readonly targetBindingSha256: string
    readonly replayRejected: boolean
  }
  readonly join: {
    readonly requested: boolean
    readonly usernames: readonly string[]
    readonly expectedPlayers: number
  }
  readonly failure: string | null
  readonly stop: {
    readonly exitCode: number | null
    readonly exitSignal: string | null
    readonly adapterDisabled: boolean
    readonly companionDisabled: boolean
  }
  readonly artifacts: {
    readonly paperJarSha256: string
    readonly adapterJarSha256: string
    readonly companionJarSha256: string
  }
  readonly bindingSha256: string
  readonly startedAtMs: number
  readonly finishedAtMs: number
  readonly releaseEligible: false
  readonly factsAuthoritative: false
}

function materializeLayout(options: ControlledPaperJourneyOptions): { readonly pluginsDir: string, readonly worldDir: string, readonly logPath: string } {
  const root = path.resolve(options.isolatedRoot)
  const pluginsDir = path.join(root, 'plugins')
  const worldDir = path.join(root, 'world')
  const logPath = path.join(root, 'logs', 'latest.log')
  for (const directory of [pluginsDir, worldDir, path.dirname(logPath)]) {
    mkdirSync(directory, { recursive: true })
  }
  mkdirSync(path.join(pluginsDir, 'BotCheckerPaperAdapter'), { recursive: true })
  mkdirSync(path.join(pluginsDir, 'BotCheckerKeyStoreCompanion'), { recursive: true })
  copyFileSync(options.adapterJarPath, path.join(pluginsDir, 'BotCheckerPaperAdapter.jar'))
  copyFileSync(options.companionJarPath, path.join(pluginsDir, 'BotCheckerKeyStoreCompanion.jar'))
  writeFileSync(path.join(root, 'eula.txt'), eulaText())
  writeFileSync(path.join(root, 'server.properties'), serverPropertiesText(options.minecraftPort))
  writeFileSync(
    path.join(pluginsDir, 'BotCheckerPaperAdapter', 'config.yml'),
    adapterConfigYaml(options.policy)
  )
  writeFileSync(
    path.join(pluginsDir, 'BotCheckerKeyStoreCompanion', 'config.yml'),
    companionConfigYaml(options.companion)
  )
  return Object.freeze({ pluginsDir, worldDir, logPath })
}

function probePort(port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port, family: 4 })
    let settled = false
    const settle = (value: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => settle(true))
    socket.once('timeout', () => settle(false))
    socket.once('error', () => settle(false))
  })
}

async function stopPaperGracefully(
  child: ChildProcess,
  options: { readonly stopDeadlineMs: number, readonly crash: boolean }
): Promise<{ readonly exitCode: number | null, readonly exitSignal: string | null }> {
  const exited = new Promise<{ exitCode: number | null, exitSignal: string | null }>(resolve => {
    child.once('exit', (exitCode, exitSignal) => resolve({ exitCode, exitSignal }))
  })
  if (options.crash) {
    // Crash có chủ đích: kill cứng đúng PID do executor spawn (không kill hàng loạt).
    try { child.kill() } catch { /* best effort */ }
  } else {
    child.stdin?.write(buildStopCommand())
  }
  let result = await Promise.race([
    exited,
    sleep(options.stopDeadlineMs).then(() => ({ exitCode: null as number | null, exitSignal: 'TIMEOUT' as const }))
  ])
  if (result.exitSignal === 'TIMEOUT') {
    try { child.kill() } catch { /* best effort */ }
    result = await Promise.race([
      exited,
      sleep(5_000).then(() => ({ exitCode: null as number | null, exitSignal: 'KILL_TIMEOUT' as const }))
    ])
  }
  return result
}

function buildBinding(options: ControlledPaperJourneyOptions): ArtifactTargetBinding {
  return buildControlledPaperBinding({
    ...options,
    companionConfigYamlText: companionConfigYaml(options.companion)
  })
}

/** Tạo binding artifact chuẩn từ chính các file sẽ deploy (hash thật, không placeholder). */
export function buildControlledPaperBinding(options: {
  readonly paperJarPath: string
  readonly adapterJarPath: string
  readonly policy: ControlledPaperPolicyInput
  readonly authorizationId: string
  readonly companionConfigYamlText?: string
}): ArtifactTargetBinding {
  return buildArtifactTargetBinding({
    schemaVersion: 1,
    bindingId: options.policy.bindingId,
    provider: {
      kind: 'server-probe',
      id: options.policy.providerId,
      version: options.policy.providerVersion,
      instanceId: options.policy.providerInstanceId
    },
    authorization: {
      id: options.authorizationId,
      scope: ['artifact-bind']
    },
    artifacts: [
      { logicalId: 'paper', role: 'paper', logicalPath: 'server/paper.jar', sha256: sha256Bytes(readFileSync(options.paperJarPath)) },
      { logicalId: 'adapter', role: 'candidate', logicalPath: 'plugins/BotCheckerPaperAdapter.jar', sha256: sha256Bytes(readFileSync(options.adapterJarPath)) },
      ...(options.companionConfigYamlText !== undefined
        ? [{
            logicalId: 'companion-config', role: 'config' as const,
            logicalPath: 'plugins/BotCheckerKeyStoreCompanion/config.yml',
            sha256: sha256Bytes(Buffer.from(options.companionConfigYamlText, 'utf8'))
          }]
        : [])
    ]
  })
}

export interface ControlledPaperRestartJourneyEvidence {
  readonly schemaVersion: 1
  readonly runId: string
  readonly boots: readonly [ControlledPaperJourneyEvidence, ControlledPaperJourneyEvidence]
  readonly bootCount: 2
  readonly bootIdsDistinct: boolean
  readonly allBootsVerified: boolean
  readonly boot1Crashed: boolean
  readonly boot2CleanStop: boolean
  readonly releaseEligible: false
  readonly factsAuthoritative: false
}

/**
 * Restart/crash journey: cùng một isolated root, hai boot tuần tự.
 * - `boot1Crash=false`: boot1 graceful stop rồi boot2 (restart sạch).
 * - `boot1Crash=true`: boot1 bị kill cứng (crash) rồi boot2 (recovery sau crash).
 * Chứng minh bootId mỗi boot khác nhau; crash không để lại claim dùng được cho boot sau.
 */
export async function runControlledPaperRestartJourney(
  options: ControlledPaperJourneyOptions & { readonly boot1Crash?: boolean }
): Promise<ControlledPaperRestartJourneyEvidence> {
  const boot1 = await runControlledPaperJourney({
    ...options,
    runId: `${options.runId}-boot1`,
    stopMode: options.boot1Crash === true ? 'crash' : 'graceful'
  })
  const boot2 = await runControlledPaperJourney({
    ...options,
    runId: `${options.runId}-boot2`,
    stopMode: 'graceful'
  })
  const bootIds = distinctBootIds([boot1, boot2].map(boot => ({ bootId: boot.claim.claimedBootId })))
  const evidence: ControlledPaperRestartJourneyEvidence = Object.freeze({
    schemaVersion: 1 as const,
    runId: options.runId,
    boots: Object.freeze([boot1, boot2]) as readonly [ControlledPaperJourneyEvidence, ControlledPaperJourneyEvidence],
    bootCount: 2 as const,
    bootIdsDistinct: bootIds.length === 2,
    allBootsVerified: [boot1, boot2].every(boot => boot.ready && boot.claim.verified && boot.claim.replayRejected),
    boot1Crashed: options.boot1Crash === true,
    boot2CleanStop: boot2.stop.exitCode === 0 && boot2.stop.exitSignal === null
      && boot2.stop.adapterDisabled && boot2.stop.companionDisabled,
    releaseEligible: false as const,
    factsAuthoritative: false as const
  })
  writeFileSync(
    path.join(options.isolatedRoot, 'restart-evidence.json'),
    JSON.stringify(evidence, null, 2)
  )
  return evidence
}

export async function runControlledPaperJourney(
  options: ControlledPaperJourneyOptions
): Promise<ControlledPaperJourneyEvidence> {
  const startedAtMs = Date.now()
  const layout = materializeLayout(options)
  const binding = buildBinding(options)
  const bindingSha256 = artifactTargetBindingSha256(binding)
  const verifiedSource = createPaperBukkitOnlinePlayerVerifiedOnlinePlayerSource({
    trustStore: options.trustStore as Parameters<typeof createPaperBukkitOnlinePlayerVerifiedOnlinePlayerSource>[0]['trustStore'],
    audience: options.policy.verifierAudience,
    verifierInstanceId: options.policy.verifierInstanceId,
    keyId: options.keyId,
    targetBinding: binding,
    challengeTtlMs: 30_000,
    loopbackClient: createPaperBukkitOnlinePlayerLoopbackClient({
      port: options.policy.port,
      timeoutMs: options.policy.socketTimeoutMs
    })
  })

  const child = spawn(options.javaExecutable, buildPaperSpawnArgs({
    javaExecutable: options.javaExecutable,
    paperJarPath: options.paperJarPath,
    pluginsDir: layout.pluginsDir,
    worldDir: layout.worldDir,
    memoryMb: options.memoryMb
  }).slice(1), {
    cwd: options.isolatedRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...process.env,
      [options.companion.passwordEnvironmentVariable]: options.password
    }
  })
  child.stdout?.resume()
  child.stderr?.resume()

  let claim = {
    verified: false,
    onlinePlayers: -1,
    claimedServerInstanceId: '',
    claimedBootId: '',
    targetBindingSha256: '',
    replayRejected: false
  }
  let failure: string | null = null
  const joinClients = options.joinClients === undefined ? undefined : validateJoinClientsInput(options.joinClients)

  try {
    await waitForPaperReady({
      deadlineMs: options.readyDeadlineMs,
      poll: async () => {
        const logDone = paperLogReady(readBoundedLog(layout.logPath))
        const portListening = await probePort(options.policy.port)
        return Object.freeze({
          portListening,
          logDone,
          exited: child.exitCode !== null
        })
      }
    })

    const joinedBots: { readonly quit: () => void }[] = []
    if (joinClients !== undefined) {
      for (const join of joinClients) {
        joinedBots.push(await joinMinecraftClient(join, options.minecraftPort, 30_000))
      }
      // Chờ Paper xử lý toàn bộ login và cập nhật online-player set.
      await sleep(1_500)
    }
    try {
      const observation = await verifiedSource.observe(options.runId, new AbortController().signal)
      const replayRejected = verifiedSource.replayAttemptRejected()
      claim = {
        verified: true,
        onlinePlayers: observation.onlinePlayers,
        claimedServerInstanceId: observation.claimedServerInstanceId,
        claimedBootId: observation.claimedBootId,
        targetBindingSha256: observation.targetBindingSha256,
        replayRejected
      }
    } finally {
      for (const joinedBot of joinedBots) joinedBot.quit()
      if (joinClients !== undefined) await sleep(1_000)
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : 'Controlled Paper journey failed'
  } finally {
    const stopResult = await stopPaperGracefully(child, {
      stopDeadlineMs: options.stopDeadlineMs,
      crash: options.stopMode === 'crash'
    })
    const stopEvidence = classifyPaperStopEvidence(readBoundedLog(layout.logPath))
    const finishedAtMs = Date.now()
    const evidence: ControlledPaperJourneyEvidence = Object.freeze({
      schemaVersion: 1 as const,
      runId: options.runId,
      ready: failure === null,
      claim,
      join: Object.freeze({
        requested: joinClients !== undefined,
        usernames: Object.freeze(joinClients?.map(client => client.username) ?? []),
        expectedPlayers: joinClients?.length ?? 0
      }),
      failure,
      stop: Object.freeze({
        exitCode: stopResult.exitCode,
        exitSignal: stopResult.exitSignal,
        adapterDisabled: stopEvidence.adapterDisabled,
        companionDisabled: stopEvidence.companionDisabled
      }),
      artifacts: Object.freeze({
        paperJarSha256: sha256Bytes(readFileSync(options.paperJarPath)),
        adapterJarSha256: sha256Bytes(readFileSync(options.adapterJarPath)),
        companionJarSha256: sha256Bytes(readFileSync(options.companionJarPath))
      }),
      bindingSha256,
      startedAtMs,
      finishedAtMs,
      releaseEligible: false as const,
      factsAuthoritative: false as const
    })
    writeFileSync(
      path.join(options.isolatedRoot, 'journey-evidence.json'),
      JSON.stringify(evidence, null, 2)
    )
  }
  return JSON.parse(readFileSync(path.join(options.isolatedRoot, 'journey-evidence.json'), 'utf8')) as ControlledPaperJourneyEvidence
}