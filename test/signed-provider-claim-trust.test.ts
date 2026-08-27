import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, type KeyObject } from 'node:crypto'
import test from 'node:test'
import {
  buildSignedProviderClaimTrustStore,
  type SignedProviderClaimTrustKeyInput
} from '../src/signed-provider-claim.js'

function spkiDer(publicKey: KeyObject): Buffer {
  return publicKey.export({ type: 'spki', format: 'der' })
}

function trustedKeyInput(publicKey: KeyObject): SignedProviderClaimTrustKeyInput {
  const der = spkiDer(publicKey)
  return {
    schemaVersion: 1,
    algorithm: 'ed25519',
    keyId: createHash('sha256').update(der).digest('hex'),
    publicKeySpkiDerBase64: der.toString('base64'),
    provider: {
      kind: 'server-probe',
      id: 'livingnpc-probe',
      version: '1.0.0',
      instanceId: 'probe-key-slot-a'
    },
    allowedBindings: [{ bindingId: 'livingnpc-paper', targetBindingSha256: 'a'.repeat(64) }],
    notBeforeMs: 1_000,
    notAfterMs: 10_000,
    status: 'active'
  }
}

test('signed provider trust store import exact Ed25519 SPKI và snapshot policy không lộ key bytes', () => {
  const { publicKey } = generateKeyPairSync('ed25519')
  const input = trustedKeyInput(publicKey)
  const store = buildSignedProviderClaimTrustStore({
    schemaVersion: 1,
    trustStoreId: 'controlled-probe-trust',
    trustStoreVersion: '2026.08.27-1',
    keys: [input]
  })

  assert.match(store.trustStoreSha256, /^[a-f0-9]{64}$/)
  assert.equal(store.keys.length, 1)
  assert.deepEqual(store.keys[0], {
    keyId: input.keyId,
    provider: input.provider,
    allowedBindings: input.allowedBindings,
    notBeforeMs: 1_000,
    notAfterMs: 10_000,
    status: 'active'
  })
  assert.doesNotMatch(JSON.stringify(store), /publicKey|spki|privateKey/i)

  input.allowedBindings[0]!.targetBindingSha256 = 'b'.repeat(64)
  input.provider.id = 'mutated-provider'
  assert.equal(store.keys[0]?.provider.id, 'livingnpc-probe')
  assert.equal(store.keys[0]?.allowedBindings[0]?.targetBindingSha256, 'a'.repeat(64))

  assert.throws(() => {
    const mutableProvider = store.keys[0]!.provider as { id: string }
    mutableProvider.id = 'mutated-output-provider'
  }, /read only|readonly|extensible|assign/i)
  assert.throws(() => {
    const mutableBinding = store.keys[0]!.allowedBindings[0]! as { targetBindingSha256: string }
    mutableBinding.targetBindingSha256 = 'c'.repeat(64)
  }, /read only|readonly|extensible|assign/i)
  assert.equal(store.keys[0]?.provider.id, 'livingnpc-probe')
  assert.equal(store.keys[0]?.allowedBindings[0]?.targetBindingSha256, 'a'.repeat(64))
})

test('signed provider trust store reject key substitution, private/non-Ed25519 và noncanonical SPKI', () => {
  const ed25519 = generateKeyPairSync('ed25519')
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const x25519 = generateKeyPairSync('x25519')

  const wrongId = trustedKeyInput(ed25519.publicKey)
  wrongId.keyId = '0'.repeat(64)
  assert.throws(() => buildSignedProviderClaimTrustStore({
    schemaVersion: 1, trustStoreId: 'trust-a', trustStoreVersion: 'v1', keys: [wrongId]
  }), /keyId|fingerprint/i)

  const privateDer = ed25519.privateKey.export({ type: 'pkcs8', format: 'der' })
  const privateInput = { ...trustedKeyInput(ed25519.publicKey), publicKeySpkiDerBase64: privateDer.toString('base64') }
  assert.throws(() => buildSignedProviderClaimTrustStore({
    schemaVersion: 1, trustStoreId: 'trust-a', trustStoreVersion: 'v1', keys: [privateInput]
  }), /public|Ed25519|SPKI|key/i)

  for (const publicKey of [rsa.publicKey, x25519.publicKey]) {
    const input = trustedKeyInput(publicKey)
    assert.throws(() => buildSignedProviderClaimTrustStore({
      schemaVersion: 1, trustStoreId: 'trust-a', trustStoreVersion: 'v1', keys: [input]
    }), /Ed25519|key/i)
  }

  const padded = trustedKeyInput(ed25519.publicKey)
  padded.publicKeySpkiDerBase64 = `${padded.publicKeySpkiDerBase64}\n`
  assert.throws(() => buildSignedProviderClaimTrustStore({
    schemaVersion: 1, trustStoreId: 'trust-a', trustStoreVersion: 'v1', keys: [padded]
  }), /canonical|base64|SPKI/i)

  const duplicate = trustedKeyInput(ed25519.publicKey)
  assert.throws(() => buildSignedProviderClaimTrustStore({
    schemaVersion: 1, trustStoreId: 'trust-a', trustStoreVersion: 'v1', keys: [duplicate, { ...duplicate }]
  }), /duplicate/i)
})
