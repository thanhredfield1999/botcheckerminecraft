import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildControlledPaperRunPlan,
  preflightControlledPaperHarness
} from '../src/e2e/controlled-paper-harness.js'

function validInput(root: string, paperJarPath: string, keyStorePath: string) {
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

function createRoot() {
  const base = mkdtempSync(path.join(tmpdir(), 'botchecker-controlled-paper-'))
  const root = path.join(base, 'isolated-root')
  mkdirSync(root)
  return { base, root }
}

test('controlled Paper harness block deterministic khi thiếu Paper JAR hoặc PKCS12 ngoài repo', () => {
  const { base, root } = createRoot()
  try {
    const preflight = preflightControlledPaperHarness(
      validInput(root, path.join(base, 'missing-paper.jar'), path.join(base, 'missing.p12')),
      { repositoryRoot: process.cwd() }
    )
    assert.deepEqual(preflight, {
      schemaVersion: 1, ready: false, blocked: ['PAPER_JAR_MISSING', 'KEYSTORE_MISSING'],
      mutationAllowed: false, runtimeExecuted: false
    })
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('controlled Paper harness reject root trong repo, secret-shaped config và port không hợp lệ', () => {
  const repoRoot = process.cwd()
  const input = validInput(repoRoot, path.join(repoRoot, 'paper.jar'), path.join(repoRoot, 'key.p12'))
  input.adapter = { ...input.adapter, token: 'must-not-be-accepted' } as never
  input.port = 0
  assert.throws(() => preflightControlledPaperHarness(input, { repositoryRoot: repoRoot }), /Controlled Paper harness configuration is invalid/)
})

test('controlled Paper harness reject Paper JAR và PKCS12 đặt trong repository', () => {
  const { base, root } = createRoot()
  try {
    assert.throws(
      () => preflightControlledPaperHarness(validInput(root, path.join(process.cwd(), 'package.json'), path.join(process.cwd(), 'package-lock.json')), { repositoryRoot: process.cwd() }),
      /Controlled Paper harness configuration is invalid/
    )
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('controlled Paper harness reject artifact whose parent link resolves into repository', () => {
  const { base, root } = createRoot()
  try {
    const linkedRepository = path.join(base, 'linked-repository')
    symlinkSync(process.cwd(), linkedRepository, 'junction')
    assert.throws(
      () => preflightControlledPaperHarness(
        validInput(root, path.join(linkedRepository, 'package.json'), path.join(linkedRepository, 'package-lock.json')),
        { repositoryRoot: process.cwd() }
      ),
      /Controlled Paper harness configuration is invalid/
    )
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('controlled Paper harness reject isolated root không tồn tại hoặc là symlink', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'botchecker-controlled-paper-'))
  try {
    assert.throws(
      () => preflightControlledPaperHarness(validInput(path.join(base, 'missing-root'), path.join(base, 'paper.jar'), path.join(base, 'key.p12')), { repositoryRoot: process.cwd() }),
      /Controlled Paper harness configuration is invalid/
    )
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('controlled Paper harness require isolated root trống', () => {
  const { base, root } = createRoot()
  try {
    writeFileSync(path.join(root, 'leftover.txt'), 'not-empty')
    assert.throws(
      () => preflightControlledPaperHarness(validInput(root, path.join(base, 'paper.jar'), path.join(base, 'key.p12')), { repositoryRoot: process.cwd() }),
      /Controlled Paper harness configuration is invalid/
    )
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('controlled Paper harness reject external artifacts nested beneath isolated root', () => {
  const { base, root } = createRoot()
  try {
    assert.throws(
      () => preflightControlledPaperHarness(validInput(root, path.join(root, 'paper.jar'), path.join(root, 'key.p12')), { repositoryRoot: process.cwd() }),
      /Controlled Paper harness configuration is invalid/
    )
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('controlled Paper harness chỉ lập plan sau khi external artifacts tồn tại và không spawn process', () => {
  const { base, root } = createRoot()
  try {
    const paperJarPath = path.join(base, 'external-paper.jar')
    const keyStorePath = path.join(base, 'external-key.p12')
    writeFileSync(paperJarPath, 'paper fixture')
    writeFileSync(keyStorePath, 'keystore fixture')
    const plan = buildControlledPaperRunPlan(validInput(root, paperJarPath, keyStorePath), { repositoryRoot: process.cwd() })
    assert.equal(plan.mutationAllowed, false)
    assert.equal(plan.runtimeExecuted, false)
    assert.deepEqual(plan.operations, ['materialize-isolated-root', 'write-non-secret-config', 'await-explicit-runtime-approval'])
    assert.equal(Object.isFrozen(plan), true)
    assert.equal(Object.isFrozen(plan.operations), true)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
