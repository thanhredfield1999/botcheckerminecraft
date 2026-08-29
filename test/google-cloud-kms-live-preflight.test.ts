import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  createGoogleCloudKmsLiveFailureReport,
  executeGoogleCloudKmsLivePreflightArgs,
  parseGoogleCloudKmsLivePreflightArgs
} from '../src/google-cloud-kms-live-preflight.js'

const RESOURCE = 'projects/proj12/locations/us-central1/keyRings/ring_1/cryptoKeys/key-1/cryptoKeyVersions/7'
const KEY_ID = 'a'.repeat(64)

test('live KMS preflight parser nhận đúng exact public identifiers và timeout', () => {
  assert.deepEqual(parseGoogleCloudKmsLivePreflightArgs([
    '--key-version', RESOURCE,
    '--expected-key-id', KEY_ID,
    '--timeout-ms', '5000'
  ]), {
    cryptoKeyVersionName: RESOURCE,
    expectedKeyId: KEY_ID,
    rpcTimeoutMs: 5000
  })
})

test('live KMS preflight parser dùng shared resource validator cho numeric project', () => {
  const numericResource = 'projects/123/locations/us-central1/keyRings/ring_1/cryptoKeys/key-1/cryptoKeyVersions/7'
  assert.equal(parseGoogleCloudKmsLivePreflightArgs([
    '--key-version', numericResource,
    '--expected-key-id', KEY_ID,
    '--timeout-ms', '5000'
  ]).cryptoKeyVersionName, numericResource)
  for (const invalidProject of ['abcde-', '9223372036854775808']) {
    assert.throws(() => parseGoogleCloudKmsLivePreflightArgs([
      '--key-version', `projects/${invalidProject}/locations/us-central1/keyRings/ring_1/cryptoKeys/key-1/cryptoKeyVersions/7`,
      '--expected-key-id', KEY_ID,
      '--timeout-ms', '5000'
    ]), /arguments are invalid/i)
  }
})

test('live KMS preflight parser reject unknown duplicate credential và malformed flags', () => {
  const invalid = [
    [],
    ['--key-version', RESOURCE, '--expected-key-id', KEY_ID],
    ['--key-version', RESOURCE, '--expected-key-id', KEY_ID, '--timeout-ms', '5000', '--unknown', 'x'],
    ['--key-version', RESOURCE, '--key-version', RESOURCE, '--timeout-ms', '5000'],
    ['--key-version', RESOURCE, '--expected-key-id', KEY_ID, '--timeout-ms', '5000', '--credentials', 'secret.json'],
    ['--key-version', 'projects/proj12/locations/us-central1/keyRings/ring_1/cryptoKeys/key-1', '--expected-key-id', KEY_ID, '--timeout-ms', '5000'],
    ['--key-version', 'projects/proj1/locations/us-central1/keyRings/ring_1/cryptoKeys/key-1/cryptoKeyVersions/7', '--expected-key-id', KEY_ID, '--timeout-ms', '5000'],
    ['--key-version', RESOURCE, '--expected-key-id', KEY_ID.toUpperCase(), '--timeout-ms', '5000'],
    ['--key-version', RESOURCE, '--expected-key-id', KEY_ID, '--timeout-ms', '99']
  ]
  for (const args of invalid) {
    assert.throws(() => parseGoogleCloudKmsLivePreflightArgs(args), /live preflight arguments are invalid/i)
  }
})

test('live KMS preflight failure report bounded và không overclaim hoặc leak detail', () => {
  const report = createGoogleCloudKmsLiveFailureReport()
  assert.deepEqual(report, {
    schemaVersion: 2,
    status: 'NOT_VERIFIED',
    keyProtectionMetadataVerified: false,
    signingOperationObserved: false,
    keyOriginMetadataVerified: false,
    attestationCryptographicallyVerified: false,
    custodyEstablished: false,
    iamLeastPrivilegeVerified: false,
    provisioningPolicyVerified: false,
    runtimeWiringVerified: false
  })
  assert.equal(Object.isFrozen(report), true)
  assert.doesNotMatch(JSON.stringify(report), /projects\/|credential|token|private|secret|error|message/i)
})

test('live KMS preflight observed report chỉ được tạo sau verified sign và bind provenance hẹp', async () => {
  const source = await readFile('src/google-cloud-kms-live-preflight.ts', 'utf8')
  const signAwait = source.indexOf('await binding.sign(')
  const observedReturn = source.indexOf('return createObservedReport(')
  assert.ok(signAwait >= 0 && signAwait < observedReturn)
  assert.match(source, /keyVersionResourceSha256: createHash\('sha256'\)\.update\(input\.cryptoKeyVersionName\)\.digest\('hex'\)/)
  assert.match(source, /publicKeyId: attestation\.keyId/)
  assert.match(source, /probeSha256: createHash\('sha256'\)\.update\(probe\)\.digest\('hex'\)/)
  assert.match(source, /probeBytes: probe\.byteLength/)
  assert.match(source, /algorithm: attestation\.algorithm/)
  assert.match(source, /protectionLevel: attestation\.protectionLevel/)
  assert.match(source, /state: attestation\.state/)
  assert.match(source, /requiredKeyOriginMetadata: 'GENERATED_NOT_IMPORTED'/)
  assert.match(source, /keyOriginMetadata: attestation\.keyOriginMetadata/)
  assert.match(source, /hsmAttestationFormat: attestation\.hsmAttestationFormat/)
  assert.match(source, /hsmAttestationSha256: attestation\.hsmAttestationSha256/)
  assert.match(source, /keyOriginMetadataVerified: true/)
  assert.match(source, /attestationCryptographicallyVerified: false/)
  assert.doesNotMatch(source, /certChains|attestation\.content|getIamPolicy|testIamPermissions/)
  assert.match(source, /custodyEstablished: false/)
  assert.match(source, /iamLeastPrivilegeVerified: false/)
  assert.match(source, /provisioningPolicyVerified: false/)
  assert.match(source, /runtimeWiringVerified: false/)
})

test('live KMS preflight runner fail-closed trước network với input invalid', async () => {
  const result = await executeGoogleCloudKmsLivePreflightArgs([
    '--key-version', RESOURCE,
    '--expected-key-id', KEY_ID,
    '--timeout-ms', '99'
  ])
  assert.deepEqual(result, createGoogleCloudKmsLiveFailureReport())
  const source = await readFile('src/google-cloud-kms-live-preflight.ts', 'utf8')
  assert.doesNotMatch(source, /export async function runGoogleCloudKmsLivePreflight/)
})

test('live KMS preflight production runner tự tạo ADC client và không có injected transport', async () => {
  const source = await readFile('src/google-cloud-kms-live-preflight.ts', 'utf8')
  assert.match(source, /createGoogleCloudKmsAdcClient\(/)
  assert.match(source, /randomBytes\(32\)/)
  assert.match(source, /finally[\s\S]*?await client\.close\?\.\(\)/)
  assert.doesNotMatch(source, /GoogleCloudKmsClientPort|credentials|keyFilename|accessToken|privateKey|process\.env/)
})

test('live KMS preflight có executable fail-closed không in argv hoặc lỗi gốc', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
    scripts: Record<string, string>
  }
  const script = await readFile('scripts/verify-google-cloud-kms-hsm.mjs', 'utf8')
  assert.equal(
    packageJson.scripts['verify:kms-hsm'],
    'npm run build --silent && node scripts/verify-google-cloud-kms-hsm.mjs'
  )
  assert.match(script, /executeGoogleCloudKmsLivePreflightArgs\(process\.argv\.slice\(2\)\)/)
  assert.match(script, /process\.stdout\.write\(JSON\.stringify\(report\) \+ '\\n'\)/)
  assert.match(script, /process\.exitCode = report\.status === 'OBSERVED' \? 0 : 1/)
  assert.doesNotMatch(script, /console\.|stderr|process\.argv\.join|error\.(?:message|stack)|credentials|keyFilename|accessToken|privateKey/)
})
