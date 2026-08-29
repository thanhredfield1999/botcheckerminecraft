import assert from 'node:assert/strict'
import test from 'node:test'
import { isGoogleCloudKmsCryptoKeyVersionName } from '../src/google-cloud-kms-resource-name.js'

const suffix = '/locations/us-east1/keyRings/botchecker/cryptoKeys/provider/cryptoKeyVersions/7'

test('CryptoKeyVersion validator nhận project ID canonical và nonzero signed-int64 project number', () => {
  for (const project of [
    'test-project',
    'a23456',
    'a'.repeat(30),
    '123',
    '9223372036854775807'
  ]) {
    assert.equal(isGoogleCloudKmsCryptoKeyVersionName(`projects/${project}${suffix}`), true)
  }
})

test('CryptoKeyVersion validator reject project segment malformed hoặc vượt signed-int64', () => {
  for (const project of [
    'abcde',
    'abcde-',
    'a'.repeat(31),
    '0',
    '0123',
    '9223372036854775808'
  ]) {
    assert.equal(isGoogleCloudKmsCryptoKeyVersionName(`projects/${project}${suffix}`), false)
  }
})

test('CryptoKeyVersion validator reject non-string và path không exact', () => {
  for (const value of [
    undefined,
    null,
    {},
    `projects/test-project${suffix}/extra`,
    'projects/test-project/locations/us-east1/keyRings/r/cryptoKeys/k',
    ' projects/test-project/locations/us-east1/keyRings/r/cryptoKeys/k/cryptoKeyVersions/7'
  ]) {
    assert.equal(isGoogleCloudKmsCryptoKeyVersionName(value), false)
  }
})
