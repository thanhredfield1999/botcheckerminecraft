#!/usr/bin/env node
// Controlled Paper CONSUMER journey: boots a controlled Paper with the BotChecker adapter +
// companion + EXTRA plugins (e.g. ItemGuard LITE), starts the REAL BotChecker HTTP server
// pointed at that Paper, runs a real scenario through it, and records the resulting report as
// consumer evidence. Everything is stopped cleanly.
//
// Usage:
//   node --import tsx scripts/controlled-paper-consumer.mjs --config C:/outside/consumer-config.json
//
// Config = standard schema-1 journey config PLUS:
//   mode: 'consumer', scenario: '<scenario-name>', extraPlugins: [abs jar paths],
//   apiHost? (default 127.0.0.1), apiPort? (default 8080), botUsername? (default HeoMC_ConsumerBot).
import { readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { preflightControlledPaperHarness } from '../src/e2e/controlled-paper-harness.ts'
import {
  buildPaperSpawnArgs,
  materializeControlledPaperLayout,
  paperLogReady,
  waitForPaperReady
} from '../src/e2e/controlled-paper-executor.ts'

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

function configPath(argumentsList) {
  if (argumentsList.length !== 2 || argumentsList[0] !== '--config') {
    throw new Error('Usage: controlled-paper-consumer --config <non-secret-json-path>')
  }
  return argumentsList[1]
}

function probePort(port, timeoutMs = 800) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port, family: 4 })
    let settled = false
    const settle = (value) => {
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

function readBoundedLog(logPath) {
  try {
    const bytes = readFileSync(logPath)
    return bytes.subarray(Math.max(0, bytes.byteLength - 2_000_000)).toString('utf8')
  } catch {
    return ''
  }
}

async function waitForApi(baseUrl, deadlineMs) {
  const started = Date.now()
  while (Date.now() - started < deadlineMs) {
    try {
      const response = await fetch(`${baseUrl}/health`)
      if (response.ok) return true
    } catch { /* chưa sẵn sàng */ }
    await sleep(500)
  }
  return false
}

async function runScenario(baseUrl, scenarioName, deadlineMs) {
  const create = await fetch(`${baseUrl}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenario: scenarioName })
  })
  if (!create.ok) {
    const text = await create.text()
    throw new Error(`Create run failed (${create.status}): ${text.slice(0, 300)}`)
  }
  const created = await create.json()
  const runId = created.runId
  const started = Date.now()
  let status = 'queued'
  while (Date.now() - started < deadlineMs) {
    const view = await fetch(`${baseUrl}/api/runs/${runId}`)
    const state = await view.json()
    status = state.status
    if (['passed', 'failed', 'cancelled'].includes(status)) break
    await sleep(1_000)
  }
  const reportResponse = await fetch(`${baseUrl}/api/runs/${runId}/report`)
  const report = reportResponse.ok ? await reportResponse.json() : null
  return { runId, status, report }
}

function stopChild(child, signal = 'SIGTERM') {
  return new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(child.exitCode ?? child.signalCode)
      return
    }
    child.once('exit', (code, sig) => resolve(code ?? sig))
    try { child.kill(signal) } catch { resolve(child.exitCode ?? child.signalCode) }
    setTimeout(() => { try { child.kill('SIGKILL') } catch { /* best effort */ } }, 10_000)
  })
}

async function main() {
  const file = configPath(process.argv.slice(2))
  const config = JSON.parse(readFileSync(file, 'utf8'))
  if (config.schemaVersion !== 1 || config.mode !== 'consumer') {
    throw new Error('Consumer journey requires schemaVersion 1 and mode "consumer"')
  }
  const required = ['isolatedRoot', 'paperJarPath', 'adapterJarPath', 'companionJarPath',
    'keyStorePath', 'javaExecutable', 'trustInputPath']
  for (const key of required) {
    if (typeof config[key] !== 'string' || !path.isAbsolute(config[key])) {
      throw new Error(`${key} must be an absolute path`)
    }
  }
  if (typeof config.keyStoreAlias !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(config.keyStoreAlias)) {
    throw new Error('keyStoreAlias is invalid')
  }
  if (typeof config.scenario !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(config.scenario)) {
    throw new Error('scenario name is invalid')
  }
  // Tên nhân vật Minecraft offline tối đa 16 ký tự; username dài hơn làm Paper
  // báo lỗi decode hello sai lệch (chữ ký thật: bytes đọc quá khung packet).
  const botUsername = String(config.botUsername ?? 'ConsumerBot')
  if (!/^[A-Za-z0-9_]{1,16}$/.test(botUsername)) {
    throw new Error('botUsername is invalid (max 16 chars, [A-Za-z0-9_])')
  }
  const extraPlugins = Array.isArray(config.extraPlugins)
    ? config.extraPlugins.map(item => {
      if (typeof item !== 'string' || !path.isAbsolute(item)) {
        throw new Error('extraPlugins entries must be absolute paths')
      }
      return item
    })
    : []
  const passwordEnv = config.passwordEnvironmentVariable
  if (typeof passwordEnv !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(passwordEnv)) {
    throw new Error('passwordEnvironmentVariable is invalid')
  }
  const password = process.env[passwordEnv]
  if (!password || typeof password !== 'string' || password.length < 8) {
    throw new Error(`Password environment variable ${passwordEnv} is missing`)
  }

  const isolatedRoot = path.resolve(config.isolatedRoot)
  const adapter = config.adapter
  const minecraftPort = Number(config.minecraftPort ?? config.port + 1)
  const apiPort = Number(config.apiPort ?? 8080)
  const apiHost = String(config.apiHost ?? '127.0.0.1')
  const baseUrl = `http://${apiHost}:${apiPort}`

  const policy = {
    companionPluginName: 'BotCheckerKeyStoreCompanion',
    port: Number(config.port ?? 25580),
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

  const options = {
    isolatedRoot,
    paperJarPath: config.paperJarPath,
    adapterJarPath: config.adapterJarPath,
    companionJarPath: config.companionJarPath,
    javaExecutable: config.javaExecutable,
    policy: {
      ...policy,
      targetBindingSha256: '0'.repeat(64),
      trustStoreSha256: '0'.repeat(64)
    },
    companion: {
      keyStorePath: config.keyStorePath,
      alias: config.keyStoreAlias,
      passwordEnvironmentVariable: passwordEnv
    },
    memoryMb: Number(config.memoryMb ?? 1024),
    minecraftPort,
    extraPlugins,
    readyDeadlineMs: Number(config.readyDeadlineMs ?? 300_000),
    stopDeadlineMs: Number(config.stopDeadlineMs ?? 60_000)
  }

  // Reuse the hardened harness validation (root/artifacts outside repo, fresh root).
  const preflightInput = {
    schemaVersion: 1,
    isolatedRoot,
    paperJarPath: options.paperJarPath,
    keyStorePath: options.companion.keyStorePath,
    port: policy.port,
    adapter: {
      audience: policy.verifierAudience,
      verifierInstanceId: policy.verifierInstanceId,
      keyId: policy.keyId,
      bindingId: policy.bindingId,
      targetBindingSha256: options.policy.targetBindingSha256,
      providerId: policy.providerId,
      providerVersion: policy.providerVersion,
      providerInstanceId: policy.providerInstanceId,
      trustStoreId: policy.trustStoreId,
      trustStoreVersion: policy.trustStoreVersion,
      trustStoreSha256: options.policy.trustStoreSha256,
      serverInstanceId: policy.serverInstanceId
    },
    companion: {
      alias: options.companion.alias,
      passwordEnvironmentVariable: passwordEnv
    }
  }
  let preflight
  try {
    preflight = preflightControlledPaperHarness(preflightInput, { repositoryRoot: process.cwd() })
  } catch (error) {
    throw error
  }
  if (!preflight.ready) {
    throw new Error(`Preflight blocked: ${preflight.blocked.join(', ')}`)
  }

  const layout = materializeControlledPaperLayout(options)

  const paper = spawn(
    options.javaExecutable,
    buildPaperSpawnArgs({
      javaExecutable: options.javaExecutable,
      paperJarPath: options.paperJarPath,
      pluginsDir: layout.pluginsDir,
      worldDir: layout.worldDir,
      memoryMb: options.memoryMb
    }).slice(1),
    {
      cwd: isolatedRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, [passwordEnv]: password }
    }
  )
  paper.stdout?.resume()
  paper.stderr?.resume()

  let server
  const evidence = {
    schemaVersion: 1,
    scenario: config.scenario,
    runId: null,
    runStatus: null,
    verdict: null,
    stepSummary: null,
    reportPath: null,
    failure: null,
    stop: null,
    releaseEligible: false,
    factsAuthoritative: false
  }
  try {
    await waitForPaperReady({
      deadlineMs: options.readyDeadlineMs,
      poll: async () => ({
        portListening: await probePort(minecraftPort),
        logDone: paperLogReady(readBoundedLog(layout.logPath)),
        exited: paper.exitCode !== null
      })
    })

    server = spawn(process.execPath, ['dist/src/index.js'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        API_HOST: apiHost,
        API_PORT: String(apiPort),
        RUN_QUEUE_CAPACITY: '1',
        MAX_RETAINED_RUNS: '4',
        SCENARIO_DIR: path.resolve('scenarios'),
        REPORT_DIR: path.join(isolatedRoot, 'reports'),
        MC_HOST: '127.0.0.1',
        MC_PORT: String(minecraftPort),
        MC_USERNAME: botUsername,
        MC_AUTH: 'offline',
        MC_VERSION: '1.21.11'
      }
    })
    server.stdout?.resume()
    server.stderr?.resume()

    if (!(await waitForApi(baseUrl, 60_000))) {
      throw new Error('BotChecker API did not become ready')
    }

    // Paper đang quiesce sau khi báo Done; chờ thêm vài giây để network handler
    // sẵn sàng nhận hello (giảm protocol race đã ghi trong CURRENT_STATE).
    await sleep(10_000)

    // Retry tối đa 2 lần: mỗi lần là một run thật qua API (bot join lại + report thật).
    let runResult
    let lastFailure
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        runResult = await runScenario(baseUrl, config.scenario, 180_000)
        if (runResult.status === 'passed' && runResult.report?.verdict === 'PASS') break
        lastFailure = `status=${runResult.status} verdict=${runResult.report?.verdict}`
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : String(error)
      }
      await sleep(5_000)
    }
    if (!runResult || runResult.status !== 'passed' || runResult.report?.verdict !== 'PASS') {
      throw new Error(`Consumer scenario did not fully pass (${lastFailure ?? 'no attempts'})`)
    }
    const { runId, report } = runResult
    evidence.runId = runId
    evidence.runStatus = runResult.status
    evidence.verdict = report?.verdict ?? null
    evidence.reportPath = path.join(isolatedRoot, 'reports', `${runId}.json`)
  } catch (error) {
    evidence.failure = error instanceof Error ? error.message : String(error)
  } finally {
    if (server) {
      const serverExit = await stopChild(server)
      evidence.stop = { serverExit }
    }
    paper.stdin?.write('stop\n')
    const exited = await Promise.race([
      new Promise(resolve => paper.once('exit', (code, sig) => resolve({ code, sig }))),
      sleep(options.stopDeadlineMs).then(() => ({ code: null, sig: 'TIMEOUT' }))
    ])
    if (exited.sig === 'TIMEOUT') {
      try { paper.kill() } catch { /* best effort */ }
      await new Promise(resolve => paper.once('exit', () => resolve()))
    }
    evidence.stop = { ...evidence.stop, paperExitCode: exited.code, paperExitSignal: exited.sig }
    if (typeof evidence.reportPath === 'string') {
      try {
        const report = JSON.parse(readFileSync(evidence.reportPath, 'utf8'))
        evidence.verdict = report.verdict
        evidence.stepSummary = report.summary
      } catch { /* report file may be absent on failure */ }
    }
    const evidenceFile = path.join(isolatedRoot, 'consumer-evidence.json')
    writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2))
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
    process.exitCode = evidence.failure === null && evidence.verdict === 'PASS' ? 0 : 2
  }
}

main().catch(error => {
  process.stderr.write(`Controlled Paper consumer rejected: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 2
})