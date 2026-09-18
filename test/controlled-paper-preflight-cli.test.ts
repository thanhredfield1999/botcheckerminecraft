import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

function config(root: string, paperJarPath: string, keyStorePath: string) {
  return {
    schemaVersion: 1,
    isolatedRoot: root,
    paperJarPath,
    keyStorePath,
    port: 25580,
    adapter: {
      audience: 'paper-bukkit-verifier', verifierInstanceId: 'paper-bukkit-verifier-a',
      keyId: 'a'.repeat(64), bindingId: 'paper-bukkit-online-player',
      targetBindingSha256: 'b'.repeat(64), providerId: 'paper-bukkit-probe',
      providerVersion: '1.0.0', providerInstanceId: 'adapter-a',
      trustStoreId: 'paper-bukkit-trust', trustStoreVersion: '2026.09.13-1',
      trustStoreSha256: 'c'.repeat(64), serverInstanceId: 'controlled-paper-a'
    },
    companion: { alias: 'botchecker-ed25519', passwordEnvironmentVariable: 'BOTCHECKER_TEST_KEYSTORE_PASSWORD' }
  }
}

test('controlled Paper preflight CLI chỉ đọc config và block deterministic, không spawn Paper', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'botchecker-controlled-paper-cli-'))
  const root = path.join(base, 'isolated-root')
  mkdirSync(root)
  try {
    const configPath = path.join(base, 'harness.json')
    writeFileSync(configPath, JSON.stringify(config(root, path.join(base, 'missing-paper.jar'), path.join(base, 'missing.p12'))))
    const result = spawnSync('node', ['--import', 'tsx', 'scripts/controlled-paper-preflight.mjs', '--config', configPath], {
      cwd: process.cwd(), encoding: 'utf8', windowsHide: true
    })
    assert.equal(result.status, 2)
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      schemaVersion: 1,
      ready: false,
      blocked: ['PAPER_JAR_MISSING', 'KEYSTORE_MISSING'],
      mutationAllowed: false,
      runtimeExecuted: false
    })
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
