#!/usr/bin/env node
// One-shot controlled Paper journey executor — the ONLY path that starts Paper.
//
// Usage:
//   node --import tsx scripts/controlled-paper-journey.mjs --config C:/outside/journey-config.json
//
// Required runtime environment (NEVER passed as args or written to files):
//   the password environment variable named by `passwordEnvironmentVariable` in the config.
//
// The config is a NON-SECRET JSON schema 1 file:
//   schemaVersion, isolatedRoot (fresh empty dir outside repo), paperJarPath, adapterJarPath,
//   companionJarPath (the two plugin JARs), keyStorePath, javaExecutable, keyStoreAlias,
//   passwordEnvironmentVariable, trustInputPath (public trust-input.json from provisioning),
//   port, adapter { audience, verifierInstanceId, keyId, bindingId, providerId, providerVersion,
//   providerInstanceId, trustStoreId, trustStoreVersion, serverInstanceId }, authorizationId,
//   memoryMb, readyDeadlineMs, stopDeadlineMs, runId.
//   targetBindingSha256 and trustStoreSha256 are DERIVED here from real artifact hashes — never
//   trusted from the file.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { preflightControlledPaperHarness } from '../src/e2e/controlled-paper-harness.ts'
import {
  buildControlledPaperBinding,
  companionConfigYaml,
  runControlledPaperJourney,
  validateJoinClientsInput
} from '../src/e2e/controlled-paper-executor.ts'
import { buildPaperBukkitOnlinePlayerTrustStore } from '../src/paper-bukkit-online-player-claim.ts'
import { artifactTargetBindingSha256 } from '../src/target-binding.ts'

const SHA256 = /^[a-f0-9]{64}$/
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/
const VERSION = /^[a-zA-Z0-9][a-zA-Z0-9._:+-]{0,127}$/
const ENVIRONMENT_VARIABLE = /^[A-Z][A-Z0-9_]{0,127}$/
const FORBIDDEN = /(?:secret|token|credential|api[_-]?key|bearer|private[_-]?key)/i

function configPath(argumentsList) {
  if (argumentsList.length !== 2 || argumentsList[0] !== '--config') {
    throw new Error('Usage: controlled-paper-journey --config <non-secret-json-path>')
  }
  return argumentsList[1]
}

function cleanId(value, label) {
  if (typeof value !== 'string' || !ID.test(value) || FORBIDDEN.test(value)) {
    throw new Error(`${label} is invalid`)
  }
}
function cleanVersion(value, label) {
  if (typeof value !== 'string' || !VERSION.test(value) || FORBIDDEN.test(value)) {
    throw new Error(`${label} is invalid`)
  }
}
function cleanSha256(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${label} is invalid`)
}
function cleanPort(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) throw new Error('port is invalid')
}
function cleanPositiveInt(value, label, max) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${label} is invalid`)
}

try {
  const file = configPath(process.argv.slice(2))
  const config = JSON.parse(readFileSync(file, 'utf8'))
  if (config.schemaVersion !== 1) throw new Error('journey config schemaVersion must be 1')
  for (const key of ['isolatedRoot', 'paperJarPath', 'adapterJarPath', 'companionJarPath',
    'keyStorePath', 'javaExecutable', 'trustInputPath']) {
    if (typeof config[key] !== 'string' || !path.isAbsolute(config[key]) || config[key].includes('\n')) {
      throw new Error(`${key} must be an absolute path without newlines`)
    }
  }
  cleanId(config.keyStoreAlias, 'keyStoreAlias')
  if (typeof config.passwordEnvironmentVariable !== 'string'
    || !ENVIRONMENT_VARIABLE.test(config.passwordEnvironmentVariable)) {
    throw new Error('passwordEnvironmentVariable is invalid')
  }
  cleanPort(config.port)
  cleanId(config.authorizationId, 'authorizationId')
  cleanPositiveInt(config.memoryMb ?? 1024, 'memoryMb', 8_192)
  cleanPositiveInt(config.readyDeadlineMs ?? 180_000, 'readyDeadlineMs', 3_600_000)
  cleanPositiveInt(config.stopDeadlineMs ?? 45_000, 'stopDeadlineMs', 600_000)

  const adapter = config.adapter
  if (!adapter || typeof adapter !== 'object') throw new Error('adapter block is required')
  cleanId(adapter.audience, 'adapter.audience')
  cleanId(adapter.verifierInstanceId, 'adapter.verifierInstanceId')
  cleanSha256(adapter.keyId, 'adapter.keyId')
  cleanId(adapter.bindingId, 'adapter.bindingId')
  cleanId(adapter.providerId, 'adapter.providerId')
  cleanVersion(adapter.providerVersion, 'adapter.providerVersion')
  cleanId(adapter.providerInstanceId, 'adapter.providerInstanceId')
  cleanId(adapter.trustStoreId, 'adapter.trustStoreId')
  cleanVersion(adapter.trustStoreVersion, 'adapter.trustStoreVersion')
  cleanId(adapter.serverInstanceId, 'adapter.serverInstanceId')

  const trustInput = JSON.parse(readFileSync(config.trustInputPath, 'utf8'))
  if (trustInput.schemaVersion !== 1
    || typeof trustInput.publicKeySpkiDerBase64 !== 'string'
    || typeof trustInput.keyId !== 'string' || !SHA256.test(trustInput.keyId)) {
    throw new Error('trust-input.json is invalid')
  }
  const spkiDer = Buffer.from(trustInput.publicKeySpkiDerBase64, 'base64')
  if (spkiDer.byteLength !== 44 || createHash('sha256').update(spkiDer).digest('hex') !== trustInput.keyId) {
    throw new Error('trust store public key does not match keyId')
  }
  if (adapter.keyId !== trustInput.keyId) {
    throw new Error('adapter.keyId must equal the provisioned keyId')
  }
  if (config.keyStoreAlias !== trustInput.alias) {
    throw new Error('keyStoreAlias must equal the provisioned alias')
  }

  const password = process.env[config.passwordEnvironmentVariable]
  if (!password || typeof password !== 'string' || password.length < 8) {
    throw new Error(`Password environment variable ${config.passwordEnvironmentVariable} is missing`)
  }

  const policyBase = {
    companionPluginName: 'BotCheckerKeyStoreCompanion',
    port: config.port,
    socketTimeoutMs: 5_000,
    snapshotTimeoutMs: 2_000,
    maxLedgerEntries: 64,
    verifierAudience: adapter.audience,
    verifierInstanceId: adapter.verifierInstanceId,
    keyId: adapter.keyId,
    bindingId: adapter.bindingId,
    providerId: adapter.providerId,
    providerVersion: adapter.providerVersion,
    providerInstanceId: adapter.providerInstanceId,
    trustStoreId: adapter.trustStoreId,
    trustStoreVersion: adapter.trustStoreVersion,
    serverInstanceId: adapter.serverInstanceId
  }
  const binding = buildControlledPaperBinding({
    paperJarPath: config.paperJarPath,
    adapterJarPath: config.adapterJarPath,
    policy: { targetBindingSha256: '0'.repeat(64), trustStoreSha256: '0'.repeat(64), ...policyBase },
    authorizationId: config.authorizationId,
    companionConfigYamlText: companionConfigYaml({
      keyStorePath: config.keyStorePath,
      alias: config.keyStoreAlias,
      passwordEnvironmentVariable: config.passwordEnvironmentVariable
    })
  })
  const now = Date.now()
  const trustNotBeforeMs = now - 60_000
  const trustNotAfterMs = now + 86_400_000
  const trustStore = buildPaperBukkitOnlinePlayerTrustStore({
    schemaVersion: 1,
    trustStoreId: adapter.trustStoreId,
    trustStoreVersion: adapter.trustStoreVersion,
    keys: [{
      schemaVersion: 1,
      algorithm: 'ed25519',
      keyId: trustInput.keyId,
      publicKeySpkiDerBase64: trustInput.publicKeySpkiDerBase64,
      provider: binding.provider,
      allowedBindings: [{
        bindingId: binding.bindingId,
        targetBindingSha256: artifactTargetBindingSha256(binding)
      }],
      notBeforeMs: trustNotBeforeMs,
      notAfterMs: trustNotAfterMs,
      status: 'active'
    }]
  })

  const policy = {
    ...policyBase,
    targetBindingSha256: trustStore.keys[0].allowedBindings[0].targetBindingSha256,
    trustStoreSha256: trustStore.trustStoreSha256
  }

  // Reuse the hardened harness validation: root outside repo & empty, artifacts outside repo/root.
  const preflight = preflightControlledPaperHarness({
    schemaVersion: 1,
    isolatedRoot: config.isolatedRoot,
    paperJarPath: config.paperJarPath,
    keyStorePath: config.keyStorePath,
    port: config.port,
    adapter: {
      audience: policy.verifierAudience,
      verifierInstanceId: policy.verifierInstanceId,
      keyId: policy.keyId,
      bindingId: policy.bindingId,
      targetBindingSha256: policy.targetBindingSha256,
      providerId: policy.providerId,
      providerVersion: policy.providerVersion,
      providerInstanceId: policy.providerInstanceId,
      trustStoreId: policy.trustStoreId,
      trustStoreVersion: policy.trustStoreVersion,
      trustStoreSha256: policy.trustStoreSha256,
      serverInstanceId: policy.serverInstanceId
    },
    companion: {
      alias: config.keyStoreAlias,
      passwordEnvironmentVariable: config.passwordEnvironmentVariable
    }
  }, { repositoryRoot: process.cwd() })
  if (!preflight.ready) {
    throw new Error(`Preflight blocked: ${preflight.blocked.join(', ')}`)
  }

  const runId = config.runId ?? `controlled-paper-journey-${now}`
  // Chấp nhận joinClients (mảng) hoặc joinClient (một client, legacy).
  const rawJoin = config.joinClients ?? (config.joinClient !== undefined ? [config.joinClient] : undefined)
  const joinClients = rawJoin === undefined ? undefined : validateJoinClientsInput(rawJoin)
  const expectedPlayers = joinClients?.length ?? 0
  const evidence = await runControlledPaperJourney({
    isolatedRoot: config.isolatedRoot,
    paperJarPath: config.paperJarPath,
    adapterJarPath: config.adapterJarPath,
    companionJarPath: config.companionJarPath,
    javaExecutable: config.javaExecutable,
    policy,
    companion: {
      keyStorePath: config.keyStorePath,
      alias: config.keyStoreAlias,
      passwordEnvironmentVariable: config.passwordEnvironmentVariable
    },
    trustStore,
    keyId: trustInput.keyId,
    memoryMb: config.memoryMb ?? 1024,
    minecraftPort: config.minecraftPort ?? (config.port + 1),
    joinClients,
    readyDeadlineMs: config.readyDeadlineMs ?? 180_000,
    stopDeadlineMs: config.stopDeadlineMs ?? 45_000,
    password,
    runId,
    authorizationId: config.authorizationId
  })

  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
  const pass = evidence.ready
    && evidence.claim.verified
    && evidence.claim.replayRejected
    && evidence.claim.onlinePlayers === expectedPlayers
    && evidence.stop.exitSignal === null
    && evidence.stop.adapterDisabled
    && evidence.stop.companionDisabled
  process.exitCode = pass ? 0 : 2
  if (!pass) process.stderr.write('Controlled Paper journey did not fully pass — see evidence above.\n')
} catch (error) {
  process.stderr.write(`Controlled Paper journey rejected: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 2
}