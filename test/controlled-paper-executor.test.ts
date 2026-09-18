import assert from 'node:assert/strict'
import test from 'node:test'
import {
  adapterConfigYaml,
  buildPaperSpawnArgs,
  buildStopCommand,
  classifyPaperStopEvidence,
  companionConfigYaml,
  eulaText,
  paperLogReady,
  serverPropertiesText,
  validateJoinClientInput,
  waitForPaperReady,
  type ControlledPaperCompanionInput,
  type ControlledPaperPolicyInput
} from '../src/e2e/controlled-paper-executor.js'

const SHA = 'a'.repeat(64)

function policy(overrides: Partial<ControlledPaperPolicyInput> = {}): ControlledPaperPolicyInput {
  return {
    companionPluginName: 'BotCheckerKeyStoreCompanion',
    port: 25680,
    socketTimeoutMs: 5000,
    snapshotTimeoutMs: 2000,
    maxLedgerEntries: 64,
    verifierAudience: 'paper-bukkit-verifier',
    verifierInstanceId: 'paper-bukkit-verifier-a',
    keyId: SHA,
    bindingId: 'paper-bukkit-online-player',
    targetBindingSha256: 'b'.repeat(64),
    providerId: 'paper-bukkit-probe',
    providerVersion: '1.0.0',
    providerInstanceId: 'adapter-a',
    trustStoreId: 'paper-bukkit-trust',
    trustStoreVersion: '2026.09.19-1',
    trustStoreSha256: 'c'.repeat(64),
    serverInstanceId: 'controlled-paper-a',
    ...overrides
  }
}

function companion(overrides: Partial<ControlledPaperCompanionInput> = {}): ControlledPaperCompanionInput {
  return {
    keyStorePath: 'C:/outside/repo/test-ed25519.p12',
    alias: 'botchecker-ed25519',
    passwordEnvironmentVariable: 'BOTCHECKER_TEST_KEYSTORE_PASSWORD',
    ...overrides
  }
}

test('adapter config YAML chứa đủ field policy fail-closed và đúng port', () => {
  const yaml = adapterConfigYaml(policy())
  assert.ok(yaml.includes('companion-plugin-name: BotCheckerKeyStoreCompanion'))
  assert.ok(yaml.includes('port: 25680'))
  assert.ok(yaml.includes('socket-timeout-ms: 5000'))
  assert.ok(yaml.includes('audience: paper-bukkit-verifier'))
  assert.ok(yaml.includes(`id: ${SHA}`))
  assert.ok(yaml.includes(`target-binding-sha256: ${'b'.repeat(64)}`))
  assert.ok(yaml.includes('instance-id: controlled-paper-a'))
  assert.ok(!yaml.includes('password'))
  assert.ok(!yaml.includes('secret'))
})

test('adapter config YAML reject giá trị secret-shaped, port ngoài dải, ID không hợp lệ', () => {
  assert.throws(() => adapterConfigYaml(policy({ verifierAudience: 'with-secret-value' })))
  assert.throws(() => adapterConfigYaml(policy({ port: 0 })))
  assert.throws(() => adapterConfigYaml(policy({ port: 70_000 })))
  assert.throws(() => adapterConfigYaml(policy({ keyId: 'not-a-sha256' })))
  assert.throws(() => adapterConfigYaml(policy({ verifierAudience: 'bad\nvalue' })))
  assert.throws(() => adapterConfigYaml(policy({ providerId: 'provider-token-here' })))
  assert.throws(() => adapterConfigYaml(policy({ targetBindingSha256: 'ABC'.repeat(21) + 'a' })))
})

test('companion config YAML chỉ giữ path/alias/env name, không có password', () => {
  const yaml = companionConfigYaml(companion())
  assert.ok(yaml.includes('path: C:/outside/repo/test-ed25519.p12'))
  assert.ok(yaml.includes('alias: botchecker-ed25519'))
  assert.ok(yaml.includes('password-environment-variable: BOTCHECKER_TEST_KEYSTORE_PASSWORD'))
  assert.ok(!/\bpassword:\s*[^e]/.test(yaml), 'không được chứa giá trị password thật')
})

test('companion config YAML reject alias / env name / path sai dạng', () => {
  assert.throws(() => companionConfigYaml(companion({ alias: 'bad alias!' })))
  assert.throws(() => companionConfigYaml(companion({ passwordEnvironmentVariable: 'lowercase' })))
  assert.throws(() => companionConfigYaml(companion({ keyStorePath: 'relative/path.p12' })))
})

test('server.properties ghi đúng port, offline-mode và không bật generate-structures', () => {
  const text = serverPropertiesText(25680)
  assert.ok(text.includes('server-port=25680'))
  assert.ok(text.includes('online-mode=false'))
  assert.ok(text.includes('motd='))
  assert.ok(text.includes('level-type=minecraft\\:flat'))
  assert.ok(text.includes('view-distance=4'))
})

test('server.properties reject port ngoài dải', () => {
  assert.throws(() => serverPropertiesText(0))
  assert.throws(() => serverPropertiesText(70_000))
})

test('eula.txt luôn eula=true, không chứa gì khác', () => {
  assert.equal(eulaText(), 'eula=true\n')
})

test('spawn args dùng java -jar paper nogui với plugins/world-dir cố định, không lộ password', () => {
  const args = buildPaperSpawnArgs({
    javaExecutable: 'C:/Program Files/Java/jdk-21/bin/java.exe',
    paperJarPath: 'C:/outside/paper-1.21.11.jar',
    pluginsDir: 'C:/isolated/root/plugins',
    worldDir: 'C:/isolated/root/world',
    memoryMb: 1024
  })
  assert.deepEqual(args, [
    'C:/Program Files/Java/jdk-21/bin/java.exe',
    '-Xms256M', '-Xmx1024M', '-jar',
    'C:/outside/paper-1.21.11.jar', 'nogui',
    '--plugins', 'C:/isolated/root/plugins',
    '--world-dir', 'C:/isolated/root/world'
  ])
  assert.ok(args.every(part => !part.includes('PASSWORD') && !part.includes('password')))
})

test('paperLogReady chỉ nhận dòng hoàn tất Paper startup', () => {
  assert.equal(paperLogReady('[Server thread/INFO]: Done (12.345s)! For help, type "help"'), true)
  assert.equal(paperLogReady('[Server thread/INFO]: Starting minecraft server version 1.21.11'), false)
  assert.equal(paperLogReady(''), false)
})

test('phân loại stop evidence từ log: cả hai plugin bị disable sạch', () => {
  const log = [
    '[INFO]: Disabling BotCheckerKeyStoreCompanion',
    '[INFO]: Disabling BotCheckerPaperAdapter',
    '[INFO]: Stopping server'
  ].join('\n')
  const evidence = classifyPaperStopEvidence(log)
  assert.equal(evidence.adapterDisabled, true)
  assert.equal(evidence.companionDisabled, true)
})

test('phân loại stop evidence fail-closed khi thiếu plugin disable', () => {
  const evidence = classifyPaperStopEvidence('[INFO]: Stopping server\n')
  assert.equal(evidence.adapterDisabled, false)
  assert.equal(evidence.companionDisabled, false)
})

test('waitForPaperReady resolve khi port lắng nghe và log Done xuất hiện', async () => {
  let calls = 0
  const poll = async () => {
    calls += 1
    return calls >= 3 ? { portListening: true, logDone: true, exited: false } : { portListening: false, logDone: false, exited: false }
  }
  const result = await waitForPaperReady({ poll, deadlineMs: 10_000 })
  assert.equal(result.ready, true)
  assert.ok(calls >= 3)
})

test('waitForPaperReady fail closed khi hết deadline hoặc process thoát sớm', async () => {
  await assert.rejects(() => waitForPaperReady({
    poll: async () => ({ portListening: false, logDone: false, exited: false }),
    deadlineMs: 200
  }), /Paper không sẵn sàng trong thời gian cho phép/)
  await assert.rejects(() => waitForPaperReady({
    poll: async () => ({ portListening: false, logDone: false, exited: true }),
    deadlineMs: 2_000
  }), /Paper process đã thoát/)
})

test('stop command luôn là stop + newline để console Paper nhận', () => {
  assert.equal(buildStopCommand(), 'stop\n')
})

test('join client input hợp lệ: username + version tùy chọn', () => {
  const parsed = validateJoinClientInput({ username: 'BotCheckerProbe', version: '1.21.11' })
  assert.deepEqual(parsed, { username: 'BotCheckerProbe', version: '1.21.11' })
  const withoutVersion = validateJoinClientInput({ username: 'Probe' })
  assert.equal(withoutVersion.username, 'Probe')
  assert.equal(withoutVersion.version, undefined)
})

test('join client input reject username/version sai dạng', () => {
  assert.throws(() => validateJoinClientInput({ username: 'bad name!' }))
  assert.throws(() => validateJoinClientInput({ username: 'a'.repeat(17) }))
  assert.throws(() => validateJoinClientInput({ username: '' }))
  assert.throws(() => validateJoinClientInput({ username: 42 }))
  assert.throws(() => validateJoinClientInput({ username: 'Probe', version: 'not-a-version' }))
  assert.throws(() => validateJoinClientInput(null))
  assert.throws(() => validateJoinClientInput({}))
})