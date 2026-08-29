import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import crc32c from 'fast-crc32c'
import test from 'node:test'
import {
  attestGoogleCloudKmsHsmEd25519Key,
  createGoogleCloudKmsAdcClient,
  createGoogleCloudKmsHsmEd25519SignerBinding,
  type GoogleCloudKmsClientPort
} from '../src/google-cloud-kms-signing-backend.js'

const RESOURCE = 'projects/test-project/locations/us-east1/keyRings/botchecker/cryptoKeys/provider/cryptoKeyVersions/7'

function fixture() {
  const pair = generateKeyPairSync('ed25519')
  const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const publicKeyDer = pair.publicKey.export({ type: 'spki', format: 'der' })
  const keyId = createHash('sha256').update(publicKeyDer).digest('hex')
  let signCalls = 0
  const client: GoogleCloudKmsClientPort = {
    async getCryptoKeyVersion(request) {
      assert.deepEqual(request, { name: RESOURCE })
      return [{ name: RESOURCE, state: 'ENABLED', algorithm: 'EC_SIGN_ED25519', protectionLevel: 'HSM' }]
    },
    async getPublicKey(request) {
      assert.deepEqual(request, { name: RESOURCE })
      return [{
        name: RESOURCE,
        pem: publicKeyPem,
        algorithm: 'EC_SIGN_ED25519',
        protectionLevel: 'HSM',
        pemCrc32c: { value: crc32c.calculate(Buffer.from(publicKeyPem, 'utf8')) }
      }]
    },
    async asymmetricSign() {
      signCalls += 1
      throw new Error('không được ký trong bootstrap attestation')
    }
  }
  return { client, keyId, pair, get signCalls() { return signCalls } }
}

test('Google Cloud KMS bootstrap attest exact HSM Ed25519 version và public key fingerprint', async () => {
  const value = fixture()
  const result = await attestGoogleCloudKmsHsmEd25519Key({
    client: value.client,
    cryptoKeyVersionName: RESOURCE,
    expectedKeyId: value.keyId
  })

  assert.deepEqual(result, {
    cryptoKeyVersionName: RESOURCE,
    keyId: value.keyId,
    algorithm: 'EC_SIGN_ED25519',
    protectionLevel: 'HSM',
    state: 'ENABLED',
    keyProtectionMetadataVerified: true,
    signingOperationObserved: false,
    custodyEstablished: false
  })
  assert.equal(value.signCalls, 0)
  assert.equal(Object.isFrozen(result), true)
})

test('Google Cloud KMS signer gửi exact raw bytes + CRC32C và kiểm response integrity', async () => {
  const pair = generateKeyPairSync('ed25519')
  const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const keyId = createHash('sha256')
    .update(pair.publicKey.export({ type: 'spki', format: 'der' })).digest('hex')
  const payload = Buffer.from('canonical-observation-bound-v2', 'utf8')
  let capturedData: Buffer | undefined
  const client: GoogleCloudKmsClientPort = {
    async getCryptoKeyVersion() {
      return [{ name: RESOURCE, state: 'ENABLED', algorithm: 'EC_SIGN_ED25519', protectionLevel: 'HSM' }]
    },
    async getPublicKey() {
      return [{
        name: RESOURCE,
        pem: publicKeyPem,
        algorithm: 'EC_SIGN_ED25519',
        protectionLevel: 'HSM',
        pemCrc32c: { value: crc32c.calculate(Buffer.from(publicKeyPem, 'utf8')) }
      }]
    },
    async asymmetricSign(request) {
      capturedData = Buffer.from(request.data)
      assert.equal(request.name, RESOURCE)
      assert.deepEqual(request.dataCrc32c, { value: crc32c.calculate(payload) })
      const signature = sign(null, capturedData, pair.privateKey)
      return [{
        name: RESOURCE, signature,
        signatureCrc32c: { value: crc32c.calculate(signature) },
        verifiedDataCrc32c: true, protectionLevel: 'HSM'
      }]
    }
  }
  const attestation = await attestGoogleCloudKmsHsmEd25519Key({
    client, cryptoKeyVersionName: RESOURCE, expectedKeyId: keyId
  })
  const binding = createGoogleCloudKmsHsmEd25519SignerBinding({ client, attestation })
  assert.equal(binding.keyId, keyId)
  const signature = await binding.sign(Object.freeze({
    canonicalPayload: new Uint8Array(payload),
    opaqueKeyHandleId: binding.opaqueKeyHandleId,
    signal: new AbortController().signal
  }))

  assert.equal(capturedData?.equals(payload), true)
  assert.equal(signature.byteLength, 64)
  assert.match(binding.opaqueKeyHandleId, /^gcp-kms-hsm:[a-f0-9]{32}$/)
  assert.equal(Object.isFrozen(binding), true)
})

test('Google Cloud KMS binding reject forged attestation và client substitution', async () => {
  const value = fixture()
  const attestation = await attestGoogleCloudKmsHsmEd25519Key({
    client: value.client,
    cryptoKeyVersionName: RESOURCE,
    expectedKeyId: value.keyId
  })
  const forged = Object.freeze({ ...attestation })
  const otherClient: GoogleCloudKmsClientPort = {
    getCryptoKeyVersion: value.client.getCryptoKeyVersion,
    getPublicKey: value.client.getPublicKey,
    asymmetricSign: value.client.asymmetricSign
  }

  assert.throws(
    () => createGoogleCloudKmsHsmEd25519SignerBinding({ client: value.client, attestation: forged }),
    /attestation/i
  )
  assert.throws(
    () => createGoogleCloudKmsHsmEd25519SignerBinding({ client: otherClient, attestation }),
    /client/i
  )
})

test('Google Cloud KMS attestation chấp nhận exact numeric SDK enums và kiểm PEM CRC32C', async () => {
  const pair = generateKeyPairSync('ed25519')
  const pem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const keyId = createHash('sha256')
    .update(pair.publicKey.export({ type: 'spki', format: 'der' })).digest('hex')
  const client: GoogleCloudKmsClientPort = {
    async getCryptoKeyVersion() {
      return [{ name: RESOURCE, state: 1, algorithm: 40, protectionLevel: 2 }]
    },
    async getPublicKey() {
      return [{
        name: RESOURCE,
        pem,
        algorithm: 40,
        protectionLevel: 2,
        pemCrc32c: { value: crc32c.calculate(Buffer.from(pem, 'utf8')) }
      }]
    },
    async asymmetricSign() { throw new Error('không được gọi') }
  }

  const result = await attestGoogleCloudKmsHsmEd25519Key({
    client, cryptoKeyVersionName: RESOURCE, expectedKeyId: keyId
  })
  assert.equal(result.keyProtectionMetadataVerified, true)
  assert.equal(result.signingOperationObserved, false)
  assert.equal(result.custodyEstablished, false)
})

test('Google Cloud KMS signer chấp nhận numeric HSM và protobuf string checksum', async () => {
  const pair = generateKeyPairSync('ed25519')
  const pem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const keyId = createHash('sha256')
    .update(pair.publicKey.export({ type: 'spki', format: 'der' })).digest('hex')
  const client: GoogleCloudKmsClientPort = {
    async getCryptoKeyVersion() {
      return [{ name: RESOURCE, state: 1, algorithm: 40, protectionLevel: 2 }]
    },
    async getPublicKey() {
      return [{
        name: RESOURCE, pem, algorithm: 40, protectionLevel: 2,
        pemCrc32c: { value: String(crc32c.calculate(Buffer.from(pem, 'utf8'))) }
      }]
    },
    async asymmetricSign(request) {
      const signature = sign(null, Buffer.from(request.data), pair.privateKey)
      return [{
        name: RESOURCE,
        signature,
        signatureCrc32c: { value: String(crc32c.calculate(signature)) },
        verifiedDataCrc32c: true,
        protectionLevel: 2
      }]
    }
  }
  const attestation = await attestGoogleCloudKmsHsmEd25519Key({
    client, cryptoKeyVersionName: RESOURCE, expectedKeyId: keyId
  })
  const binding = createGoogleCloudKmsHsmEd25519SignerBinding({ client, attestation })
  const signature = await binding.sign({
    canonicalPayload: new Uint8Array([1, 2, 3]),
    opaqueKeyHandleId: binding.opaqueKeyHandleId,
    signal: new AbortController().signal
  })
  assert.equal(signature.byteLength, 64)
})

test('Google Cloud KMS signer không làm rò lỗi transport nhạy cảm', async () => {
  const value = fixture()
  const sensitive = 'token=secret-value payload=canonical-private-data'
  value.client.asymmetricSign = async () => { throw new Error(sensitive) }
  const attestation = await attestGoogleCloudKmsHsmEd25519Key({
    client: value.client, cryptoKeyVersionName: RESOURCE, expectedKeyId: value.keyId
  })
  const binding = createGoogleCloudKmsHsmEd25519SignerBinding({
    client: value.client,
    attestation
  })

  await assert.rejects(
    async () => await binding.sign({
        canonicalPayload: new Uint8Array([9, 8, 7]),
        opaqueKeyHandleId: binding.opaqueKeyHandleId,
        signal: new AbortController().signal
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /signing failed/i)
      assert.doesNotMatch(error.message, /token|secret|payload|canonical-private-data/i)
      assert.equal('cause' in error, false)
      return true
    }
  )
})

test('Google Cloud KMS signer reject chữ ký CRC-hợp-lệ nhưng sai public key attested', async () => {
  const value = fixture()
  value.client.asymmetricSign = async () => {
    const signature = Buffer.alloc(64, 7)
    return [{
      name: RESOURCE,
      signature,
      signatureCrc32c: { value: crc32c.calculate(signature) },
      verifiedDataCrc32c: true,
      protectionLevel: 'HSM'
    }]
  }
  const attestation = await attestGoogleCloudKmsHsmEd25519Key({
    client: value.client, cryptoKeyVersionName: RESOURCE, expectedKeyId: value.keyId
  })
  const binding = createGoogleCloudKmsHsmEd25519SignerBinding({ client: value.client, attestation })

  await assert.rejects(async () => await binding.sign({
    canonicalPayload: new Uint8Array([4, 5, 6]),
    opaqueKeyHandleId: binding.opaqueKeyHandleId,
    signal: new AbortController().signal
  }), /signature.*invalid/i)
})

test('Google Cloud KMS ADC factory chỉ nhận timeout bounded và không nhận credential options', async () => {
  assert.throws(
    () => createGoogleCloudKmsAdcClient({ rpcTimeoutMs: 1_000, keyFilename: 'secret.json' } as never),
    /options/i
  )
  assert.throws(() => createGoogleCloudKmsAdcClient({ rpcTimeoutMs: 99 }), /timeout/i)

  const client = createGoogleCloudKmsAdcClient({ rpcTimeoutMs: 1_000 })
  assert.equal(Object.isFrozen(client), true)
  assert.equal(typeof client.getCryptoKeyVersion, 'function')
  assert.equal(typeof client.getPublicKey, 'function')
  assert.equal(typeof client.asymmetricSign, 'function')
  assert.equal(typeof client.close, 'function')
  await client.close?.()
})

test('Google Cloud KMS attestation không làm rò lỗi bootstrap transport', async () => {
  const value = fixture()
  value.client.getCryptoKeyVersion = async () => {
    throw new Error('token=bootstrap-secret keyFilename=C:/private/key.json')
  }

  await assert.rejects(
    () => attestGoogleCloudKmsHsmEd25519Key({
      client: value.client,
      cryptoKeyVersionName: RESOURCE,
      expectedKeyId: value.keyId
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /attestation failed/i)
      assert.doesNotMatch(error.message, /token|secret|keyFilename|private|\.json/i)
      assert.equal('cause' in error, false)
      return true
    }
  )
})

test('Google Cloud KMS signer bỏ late response khi signal abort trong RPC', async () => {
  const value = fixture()
  let resolveRpc: (() => void) | undefined
  value.client.asymmetricSign = request => new Promise(resolve => {
    const signature = sign(null, Buffer.from(request.data), value.pair.privateKey)
    resolveRpc = () => resolve([{
      name: RESOURCE,
      signature,
      signatureCrc32c: { value: crc32c.calculate(signature) },
      verifiedDataCrc32c: true,
      protectionLevel: 'HSM'
    }])
  })
  const attestation = await attestGoogleCloudKmsHsmEd25519Key({
    client: value.client, cryptoKeyVersionName: RESOURCE, expectedKeyId: value.keyId
  })
  const binding = createGoogleCloudKmsHsmEd25519SignerBinding({ client: value.client, attestation })
  const controller = new AbortController()
  const pending = Promise.resolve(binding.sign({
    canonicalPayload: new Uint8Array([3, 2, 1]),
    opaqueKeyHandleId: binding.opaqueKeyHandleId,
    signal: controller.signal
  }))
  controller.abort()
  resolveRpc?.()

  await assert.rejects(pending, /aborted/i)
})

test('Google Cloud KMS signer reject payload rỗng hoặc quá bound trước RPC', async () => {
  const value = fixture()
  let calls = 0
  value.client.asymmetricSign = async () => {
    calls += 1
    throw new Error('không được gọi')
  }
  const attestation = await attestGoogleCloudKmsHsmEd25519Key({
    client: value.client, cryptoKeyVersionName: RESOURCE, expectedKeyId: value.keyId
  })
  const binding = createGoogleCloudKmsHsmEd25519SignerBinding({ client: value.client, attestation })
  const request = (canonicalPayload: Uint8Array) => ({
    canonicalPayload,
    opaqueKeyHandleId: binding.opaqueKeyHandleId,
    signal: new AbortController().signal
  })

  await assert.rejects(async () => await binding.sign(request(new Uint8Array())), /payload/i)
  await assert.rejects(
    async () => await binding.sign(request(new Uint8Array(256 * 1024 + 1))),
    /payload/i
  )
  assert.equal(calls, 0)
})

test('Google Cloud KMS attestation snapshot PEM getter đúng một lần', async () => {
  const first = generateKeyPairSync('ed25519')
  const second = generateKeyPairSync('ed25519')
  const firstPem = first.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const secondPem = second.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const secondKeyId = createHash('sha256')
    .update(second.publicKey.export({ type: 'spki', format: 'der' })).digest('hex')
  let pemReads = 0
  const publicResponse = {
    name: RESOURCE,
    algorithm: 'EC_SIGN_ED25519',
    protectionLevel: 'HSM',
    pemCrc32c: { value: crc32c.calculate(Buffer.from(firstPem, 'utf8')) },
    get pem() {
      pemReads += 1
      return pemReads < 3 ? firstPem : secondPem
    }
  }
  const client: GoogleCloudKmsClientPort = {
    async getCryptoKeyVersion() {
      return [{ name: RESOURCE, state: 'ENABLED', algorithm: 'EC_SIGN_ED25519', protectionLevel: 'HSM' }]
    },
    async getPublicKey() { return [publicResponse] },
    async asymmetricSign() { throw new Error('không được gọi') }
  }

  await assert.rejects(
    () => attestGoogleCloudKmsHsmEd25519Key({
      client, cryptoKeyVersionName: RESOURCE, expectedKeyId: secondKeyId
    }),
    /fingerprint/i
  )
  assert.equal(pemReads, 1)
})

test('Google Cloud KMS signer snapshot payload và signature getter đúng một lần', async () => {
  const value = fixture()
  const payload = new Uint8Array([7, 8, 9])
  const signature = sign(null, payload, value.pair.privateKey)
  let payloadReads = 0
  let signatureReads = 0
  value.client.asymmetricSign = async () => [{
    name: RESOURCE,
    get signature() {
      signatureReads += 1
      return signature
    },
    signatureCrc32c: { value: crc32c.calculate(signature) },
    verifiedDataCrc32c: true,
    protectionLevel: 'HSM'
  }]
  const attestation = await attestGoogleCloudKmsHsmEd25519Key({
    client: value.client, cryptoKeyVersionName: RESOURCE, expectedKeyId: value.keyId
  })
  const binding = createGoogleCloudKmsHsmEd25519SignerBinding({ client: value.client, attestation })
  const request = {
    opaqueKeyHandleId: binding.opaqueKeyHandleId,
    signal: new AbortController().signal,
    get canonicalPayload() {
      payloadReads += 1
      return payload
    }
  }

  const result = await binding.sign(request)
  assert.equal(result.byteLength, 64)
  assert.equal(payloadReads, 1)
  assert.equal(signatureReads, 1)
})

test('Google Cloud KMS binding snapshot client và attestation getter đúng một lần', async () => {
  const value = fixture()
  const attestation = await attestGoogleCloudKmsHsmEd25519Key({
    client: value.client, cryptoKeyVersionName: RESOURCE, expectedKeyId: value.keyId
  })
  let clientReads = 0
  let attestationReads = 0
  const input = {
    get client() {
      clientReads += 1
      return value.client
    },
    get attestation() {
      attestationReads += 1
      if (attestationReads <= 2) return attestation
      return Object.freeze({
        ...attestation,
        cryptoKeyVersionName: RESOURCE.replace('/7', '/8'),
        keyId: 'f'.repeat(64)
      })
    }
  }

  const binding = createGoogleCloudKmsHsmEd25519SignerBinding(input)
  assert.equal(binding.keyId, value.keyId)
  assert.equal(clientReads, 1)
  assert.equal(attestationReads, 1)
})

test('Google Cloud KMS attestation snapshot client và expected key getter đúng một lần', async () => {
  const value = fixture()
  let clientReads = 0
  let keyReads = 0
  const input = {
    cryptoKeyVersionName: RESOURCE,
    get client() {
      clientReads += 1
      return value.client
    },
    get expectedKeyId() {
      keyReads += 1
      return keyReads === 1 ? value.keyId : 'f'.repeat(64)
    }
  }

  const attestation = await attestGoogleCloudKmsHsmEd25519Key(input)
  assert.equal(attestation.keyId, value.keyId)
  assert.equal(clientReads, 1)
  assert.equal(keyReads, 1)
})

test('Google Cloud KMS signer reject signature oversized hoặc typed-array proxy trước copy', async () => {
  for (const signature of [
    new Uint8Array(65),
    new Proxy(new Uint8Array(64), {})
  ]) {
    const value = fixture()
    value.client.asymmetricSign = async () => [{
      name: RESOURCE,
      signature,
      signatureCrc32c: { value: 0 },
      verifiedDataCrc32c: true,
      protectionLevel: 'HSM'
    }]
    const attestation = await attestGoogleCloudKmsHsmEd25519Key({
      client: value.client, cryptoKeyVersionName: RESOURCE, expectedKeyId: value.keyId
    })
    const binding = createGoogleCloudKmsHsmEd25519SignerBinding({
      client: value.client, attestation
    })

    await assert.rejects(
      async () => await binding.sign({
        canonicalPayload: new Uint8Array([1]),
        opaqueKeyHandleId: binding.opaqueKeyHandleId,
        signal: new AbortController().signal
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /signature is invalid/i)
        assert.doesNotMatch(error.message, /typed array|receiver|proxy/i)
        return true
      }
    )
  }
})

async function rejectsSensitiveGetterLeak(operation: () => unknown | Promise<unknown>): Promise<void> {
  await assert.rejects(
    async () => await operation(),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /Google Cloud KMS/i)
      assert.doesNotMatch(error.message, /getter-sensitive-marker|token|private_key/i)
      assert.equal('cause' in error, false)
      return true
    }
  )
}

test('Google Cloud KMS sanitize hostile getters ở public input boundaries', async () => {
  const sensitive = () => { throw new Error('token=getter-sensitive-marker') }
  await rejectsSensitiveGetterLeak(() => attestGoogleCloudKmsHsmEd25519Key({
    get client() { return sensitive() },
    cryptoKeyVersionName: RESOURCE,
    expectedKeyId: 'a'.repeat(64)
  }))
  await rejectsSensitiveGetterLeak(() => attestGoogleCloudKmsHsmEd25519Key({
    client: fixture().client,
    cryptoKeyVersionName: RESOURCE,
    get expectedKeyId() { return sensitive() }
  }))

  const methodValue = fixture()
  Object.defineProperty(methodValue.client, 'getPublicKey', { get: sensitive })
  await rejectsSensitiveGetterLeak(() => attestGoogleCloudKmsHsmEd25519Key({
    client: methodValue.client,
    cryptoKeyVersionName: RESOURCE,
    expectedKeyId: methodValue.keyId
  }))

  const value = fixture()
  const attestation = await attestGoogleCloudKmsHsmEd25519Key({
    client: value.client, cryptoKeyVersionName: RESOURCE, expectedKeyId: value.keyId
  })
  await rejectsSensitiveGetterLeak(() => createGoogleCloudKmsHsmEd25519SignerBinding({
    client: value.client,
    get attestation() { return sensitive() }
  }))
  const binding = createGoogleCloudKmsHsmEd25519SignerBinding({ client: value.client, attestation })
  await rejectsSensitiveGetterLeak(() => binding.sign({
    opaqueKeyHandleId: binding.opaqueKeyHandleId,
    signal: new AbortController().signal,
    get canonicalPayload() { return sensitive() }
  }))
  await rejectsSensitiveGetterLeak(() => binding.sign({
    canonicalPayload: new Uint8Array([1]),
    opaqueKeyHandleId: binding.opaqueKeyHandleId,
    get signal() { return sensitive() }
  }))
  const hostileSignal = Object.create(null) as AbortSignal
  Object.defineProperty(hostileSignal, 'aborted', { get: sensitive })
  await rejectsSensitiveGetterLeak(() => binding.sign({
    canonicalPayload: new Uint8Array([1]),
    opaqueKeyHandleId: binding.opaqueKeyHandleId,
    signal: hostileSignal
  }))
})

test('Google Cloud KMS sanitize hostile getters ở SDK response boundaries', async () => {
  const sensitive = () => { throw new Error('private_key=getter-sensitive-marker') }
  const versionValue = fixture()
  versionValue.client.getCryptoKeyVersion = async () => [{
    get name() { return sensitive() }
  }]
  await rejectsSensitiveGetterLeak(() => attestGoogleCloudKmsHsmEd25519Key({
    client: versionValue.client,
    cryptoKeyVersionName: RESOURCE,
    expectedKeyId: versionValue.keyId
  }))

  const publicValue = fixture()
  publicValue.client.getPublicKey = async () => [{
    name: RESOURCE,
    get pemCrc32c() { return sensitive() },
    algorithm: 'EC_SIGN_ED25519',
    protectionLevel: 'HSM'
  }]
  await rejectsSensitiveGetterLeak(() => attestGoogleCloudKmsHsmEd25519Key({
    client: publicValue.client,
    cryptoKeyVersionName: RESOURCE,
    expectedKeyId: publicValue.keyId
  }))

  const checksumValue = fixture()
  const checksumPem = checksumValue.pair.publicKey
    .export({ type: 'spki', format: 'pem' }).toString()
  checksumValue.client.getPublicKey = async () => [{
    name: RESOURCE,
    pem: checksumPem,
    pemCrc32c: { get value() { return sensitive() } },
    algorithm: 'EC_SIGN_ED25519',
    protectionLevel: 'HSM'
  }]
  await rejectsSensitiveGetterLeak(() => attestGoogleCloudKmsHsmEd25519Key({
    client: checksumValue.client,
    cryptoKeyVersionName: RESOURCE,
    expectedKeyId: checksumValue.keyId
  }))

  const signValue = fixture()
  signValue.client.asymmetricSign = async () => [{
    get signature() { return sensitive() },
    name: RESOURCE,
    verifiedDataCrc32c: true,
    protectionLevel: 'HSM'
  }]
  const signAttestation = await attestGoogleCloudKmsHsmEd25519Key({
    client: signValue.client,
    cryptoKeyVersionName: RESOURCE,
    expectedKeyId: signValue.keyId
  })
  const binding = createGoogleCloudKmsHsmEd25519SignerBinding({
    client: signValue.client, attestation: signAttestation
  })
  await rejectsSensitiveGetterLeak(() => binding.sign({
    canonicalPayload: new Uint8Array([1]),
    opaqueKeyHandleId: binding.opaqueKeyHandleId,
    signal: new AbortController().signal
  }))

  const signatureChecksumValue = fixture()
  signatureChecksumValue.client.asymmetricSign = async request => {
    const signature = sign(null, Buffer.from(request.data), signatureChecksumValue.pair.privateKey)
    return [{
      name: RESOURCE,
      signature,
      signatureCrc32c: { get value() { return sensitive() } },
      verifiedDataCrc32c: true,
      protectionLevel: 'HSM'
    }]
  }
  const signatureChecksumAttestation = await attestGoogleCloudKmsHsmEd25519Key({
    client: signatureChecksumValue.client,
    cryptoKeyVersionName: RESOURCE,
    expectedKeyId: signatureChecksumValue.keyId
  })
  const checksumBinding = createGoogleCloudKmsHsmEd25519SignerBinding({
    client: signatureChecksumValue.client,
    attestation: signatureChecksumAttestation
  })
  await rejectsSensitiveGetterLeak(() => checksumBinding.sign({
    canonicalPayload: new Uint8Array([1]),
    opaqueKeyHandleId: checksumBinding.opaqueKeyHandleId,
    signal: new AbortController().signal
  }))
})