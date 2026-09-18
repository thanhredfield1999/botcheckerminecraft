#!/usr/bin/env node
// Provision an operator-owned Ed25519 PKCS12 keystore for the controlled Paper journey.
// Output lives UNDER --out-dir (default E:/AI.WORK/botchecker-runtime/artifacts), OUTSIDE the
// repository. The password is read ONLY from an environment variable and never written to any
// file or argv. This script intentionally does not exist inside the harness: the harness never
// creates or reads a key.
import { generateKeyPairSync } from 'node:crypto'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'

const DEFAULT_PASSWORD_ENV = 'BOTCHECKER_TEST_KEYSTORE_PASSWORD'

function option(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  const value = process.argv[index + 1]
  if (value === undefined) throw new Error(`Missing value for ${name}`)
  return value
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${String(result.stderr).slice(0, 400)}`)
  }
  return result.stdout
}

try {
  const passwordEnvironmentVariable = option('--password-env') ?? DEFAULT_PASSWORD_ENV
  const outDir = option('--out-dir') ?? 'E:/AI.WORK/botchecker-runtime/artifacts'
  const alias = option('--alias') ?? 'botchecker-ed25519'
  const password = process.env[passwordEnvironmentVariable]
  if (!password || typeof password !== 'string' || password.length < 8) {
    process.stderr.write(`Keystore password environment variable ${passwordEnvironmentVariable} is missing or too short\n`)
    process.exit(2)
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(alias)) {
    process.stderr.write('Keystore alias is invalid\n')
    process.exit(2)
  }
  mkdirSync(outDir, { recursive: true })

  const pair = generateKeyPairSync('ed25519')
  const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' })
  const spkiDer = pair.publicKey.export({ type: 'spki', format: 'der' })
  const keyId = createHash('sha256').update(spkiDer).digest('hex')
  const p12Path = path.resolve(outDir, `controlled-test-${keyId.slice(0, 12)}.p12`)

  const privatePath = path.join(tmpdir(), `botchecker-keystore-${process.pid}.pem`)
  const certPath = path.join(tmpdir(), `botchecker-keystore-${process.pid}.crt`)
  try {
    writeFileSync(privatePath, privatePem, { mode: 0o600 })
    run('openssl', ['req', '-new', '-x509', '-key', privatePath, '-out', certPath,
      '-subj', '/CN=BotChecker Controlled Test Only', '-days', '1'])
    run('openssl', ['pkcs12', '-export', '-inkey', privatePath, '-in', certPath,
      '-out', p12Path, '-name', alias, '-passout', `env:${passwordEnvironmentVariable}`])
    // Xác nhận nhanh: store mở được bằng đúng password, alias tồn tại.
    run('keytool', ['-list', '-keystore', p12Path, '-storepass:env', passwordEnvironmentVariable,
      '-alias', alias, '-storetype', 'PKCS12'])
  } finally {
    rmSync(privatePath, { force: true })
    rmSync(certPath, { force: true })
  }

  const trustInput = {
    schemaVersion: 1,
    keyStorePath: p12Path,
    alias,
    keyId,
    publicKeySpkiDerBase64: Buffer.from(spkiDer).toString('base64')
  }
  writeFileSync(path.join(outDir, 'trust-input.json'), JSON.stringify(trustInput, null, 2))
  process.stdout.write(`${JSON.stringify({ ok: true, keyStorePath: p12Path, trustInputPath: path.join(outDir, 'trust-input.json'), keyId, alias }, null, 2)}\n`)
} catch (error) {
  process.stderr.write(`Provisioning failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(2)
}