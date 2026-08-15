import path from 'node:path'

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

export const config = {
  apiHost: process.env.API_HOST ?? '127.0.0.1',
  apiPort: numberEnv('API_PORT', 8080),
  queueCapacity: numberEnv('RUN_QUEUE_CAPACITY', 1),
  scenarioDir: path.resolve(process.env.SCENARIO_DIR ?? 'scenarios'),
  reportDir: path.resolve(process.env.REPORT_DIR ?? 'reports'),
  protocolDiagnosticsEnabled: booleanEnv('PROTOCOL_DIAGNOSTICS'),
  minecraft: {
    host: process.env.MC_HOST ?? '127.0.0.1',
    port: numberEnv('MC_PORT', 25565),
    username: process.env.MC_USERNAME ?? 'HeoMC_Tester',
    auth: (process.env.MC_AUTH ?? 'offline') as 'offline' | 'microsoft',
    version: process.env.MC_VERSION || undefined,
    password: process.env.MC_PASSWORD || undefined
  }
}
