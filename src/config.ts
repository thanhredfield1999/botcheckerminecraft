import path from 'node:path'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1'])
const MIN_API_CREDENTIAL_LENGTH = 16

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

function booleanEnv(name: string, fallback = false): boolean {
  const value = process.env[name]
  if (value === undefined) return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be true or false`)
}

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase())
}

/**
 * Fail closed: chỉ cho phép bind ngoài loopback khi có credential đủ dài.
 * Trả `undefined` nghĩa là loopback không cấu hình credential — API mở nhưng
 * chỉ nghe trên máy cục bộ.
 */
export function resolveApiCredential(host: string, credential: string | undefined): string | undefined {
  const trimmed = credential?.trim()
  if (trimmed !== undefined && trimmed.length > 0 && trimmed.length < MIN_API_CREDENTIAL_LENGTH) {
    throw new Error(`API_CREDENTIAL must be at least ${MIN_API_CREDENTIAL_LENGTH} characters`)
  }
  if (trimmed) return trimmed
  if (!isLoopbackHost(host)) {
    throw new Error(`API_CREDENTIAL is required when API_HOST is not loopback: ${host}`)
  }
  return undefined
}

export function resolveMinecraftAuth(value: string | undefined): 'offline' | 'microsoft' {
  if (value === undefined) return 'offline'
  if (value === 'offline' || value === 'microsoft') return value
  throw new Error("MC_AUTH must be exactly 'offline' or 'microsoft'")
}

const apiHost = process.env.API_HOST ?? '127.0.0.1'

export const config = {
  apiHost,
  apiPort: numberEnv('API_PORT', 8080),
  apiCredential: resolveApiCredential(apiHost, process.env.API_CREDENTIAL),
  queueCapacity: numberEnv('RUN_QUEUE_CAPACITY', 1),
  maxRetainedRuns: numberEnv('MAX_RETAINED_RUNS', 64),
  scenarioDir: path.resolve(process.env.SCENARIO_DIR ?? 'scenarios'),
  reportDir: path.resolve(process.env.REPORT_DIR ?? 'reports'),
  targetBindingFile: process.env.TARGET_BINDING_FILE?.trim()
    ? path.resolve(process.env.TARGET_BINDING_FILE.trim())
    : undefined,
  protocolDiagnosticsEnabled: booleanEnv('PROTOCOL_DIAGNOSTICS'),
  minecraft: {
    host: process.env.MC_HOST ?? '127.0.0.1',
    port: numberEnv('MC_PORT', 25565),
    username: process.env.MC_USERNAME ?? 'HeoMC_Tester',
    auth: resolveMinecraftAuth(process.env.MC_AUTH),
    version: process.env.MC_VERSION || undefined,
    password: process.env.MC_PASSWORD || undefined
  }
}
