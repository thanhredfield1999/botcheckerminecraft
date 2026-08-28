import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { SqliteSignedProviderChallengeStore } from '../src/signed-provider-challenge-store.js'

function waitForReady(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!child.stdout || !child.stderr) {
      reject(new Error('Lock holder stdio pipes are unavailable'))
      return
    }
    let stderr = ''
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    child.stdout.setEncoding('utf8').once('data', chunk => {
      if (String(chunk).includes('ready')) resolve()
      else reject(new Error(`Unexpected lock-holder output: ${String(chunk)}`))
    })
    child.once('error', reject)
    child.once('exit', code => {
      if (code && code !== 0) reject(new Error(`Lock holder exited ${code}: ${stderr}`))
    })
  })
}

function waitForExit(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', code => code === 0
      ? resolve()
      : reject(new Error(`Lock holder exited ${code}`)))
  })
}

test('node:sqlite busy timeout chờ writer lock từ process khác', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-shared-busy-timeout-'))
  const databasePath = path.join(directory, 'challenges.sqlite')
  const childScript = path.join(directory, 'hold-lock.ts')
  let seed: SqliteSignedProviderChallengeStore | undefined
  let opened: SqliteSignedProviderChallengeStore | undefined
  try {
    seed = new SqliteSignedProviderChallengeStore({
      databasePath,
      trustedWallNowMs: () => Date.now(),
      audience: 'shared-store-audience',
      verifierInstanceId: 'shared-store-instance'
    })
    seed.close()
    seed = undefined
    writeFileSync(childScript, `
void (async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const database = new DatabaseSync(process.argv[2])
  database.exec('BEGIN IMMEDIATE')
  process.stdout.write('ready\\n')
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
  database.exec('ROLLBACK')
  database.close()
})().catch(error => {
  process.stderr.write(String(error))
  process.exitCode = 1
})
`, 'utf8')
    const child = spawn(process.execPath, ['--import', 'tsx', childScript, databasePath], {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    await waitForReady(child)
    opened = new SqliteSignedProviderChallengeStore({
      databasePath,
      trustedWallNowMs: () => Date.now(),
      audience: 'shared-store-audience',
      verifierInstanceId: 'shared-store-instance',
      busyTimeoutMs: 1_000
    })
    await waitForExit(child)
    assert.ok(opened)
  } finally {
    opened?.close()
    seed?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
