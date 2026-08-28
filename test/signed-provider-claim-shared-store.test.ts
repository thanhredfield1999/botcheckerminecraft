import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { SqliteSignedProviderChallengeStore } from '../src/signed-provider-challenge-store.js'
import {
  buildSignedProviderClaimTrustStore,
  canonicalSignedProviderClaimV1,
  canonicalSignedProviderObservationBoundClaimV2,
  SignedProviderClaimVerifier
} from '../src/signed-provider-claim.js'
import { artifactTargetBindingSha256, buildArtifactTargetBinding } from '../src/target-binding.js'

function fixture() {
  const expectedBinding = buildArtifactTargetBinding({
    schemaVersion: 1,
    bindingId: 'shared-verifier-binding',
    provider: { kind: 'filesystem-snapshot', id: 'fixture-resolver', version: '1.0.0' },
    authorization: { id: 'approval-20260828', scope: ['artifact-bind'] },
    artifacts: [
      { logicalId: 'candidate', role: 'candidate', logicalPath: 'plugins/Plugin.jar', sha256: '1'.repeat(64) },
      { logicalId: 'config', role: 'config', logicalPath: 'plugins/Plugin/config.yml', sha256: '2'.repeat(64) },
      { logicalId: 'paper', role: 'paper', logicalPath: 'server/paper.jar', sha256: '3'.repeat(64) },
      { logicalId: 'probe', role: 'probe', logicalPath: 'plugins/Probe.jar', sha256: '4'.repeat(64) }
    ]
  })
  const pair = generateKeyPairSync('ed25519')
  const der = pair.publicKey.export({ type: 'spki', format: 'der' })
  const keyId = createHash('sha256').update(der).digest('hex')
  const trustStore = buildSignedProviderClaimTrustStore({
    schemaVersion: 1,
    trustStoreId: 'shared-verifier-trust',
    trustStoreVersion: 'v1',
    keys: [{
      schemaVersion: 1,
      algorithm: 'ed25519',
      keyId,
      publicKeySpkiDerBase64: der.toString('base64'),
      provider: { kind: 'server-probe', id: 'probe', version: '1.0.0' },
      allowedBindings: [{
        bindingId: expectedBinding.bindingId,
        targetBindingSha256: artifactTargetBindingSha256(expectedBinding)
      }],
      notBeforeMs: 1_000,
      notAfterMs: 100_000,
      status: 'active'
    }]
  })
  return { expectedBinding, pair, keyId, trustStore }
}

function trustStoreVersion(f: ReturnType<typeof fixture>, version: string) {
  const der = f.pair.publicKey.export({ type: 'spki', format: 'der' })
  return buildSignedProviderClaimTrustStore({
    schemaVersion: 1,
    trustStoreId: 'shared-verifier-trust',
    trustStoreVersion: version,
    keys: [{
      schemaVersion: 1,
      algorithm: 'ed25519',
      keyId: f.keyId,
      publicKeySpkiDerBase64: der.toString('base64'),
      provider: { kind: 'server-probe', id: 'probe', version: '1.0.0' },
      allowedBindings: [{
        bindingId: f.expectedBinding.bindingId,
        targetBindingSha256: artifactTargetBindingSha256(f.expectedBinding)
      }],
      notBeforeMs: 1_000,
      notAfterMs: 100_000,
      status: 'active'
    }]
  })
}

test('shared SQLite store cho verifier khác process-scope verify và consume one-time', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-shared-verifier-'))
  const databasePath = path.join(directory, 'challenges.sqlite')
  const f = fixture()
  const scope = {
    databasePath,
    trustedWallNowMs: () => 10_025,
    audience: 'shared-verifier-audience',
    verifierInstanceId: 'shared-verifier-instance'
  }
  const firstStore = new SqliteSignedProviderChallengeStore(scope)
  const secondStore = new SqliteSignedProviderChallengeStore(scope)
  const firstClock = { wall: 10_000, mono: 100 }
  const secondClock = { wall: 10_050, mono: 50 }
  try {
    const first = new SignedProviderClaimVerifier({
      trustStore: f.trustStore,
      audience: scope.audience,
      verifierInstanceId: scope.verifierInstanceId,
      wallNowMs: () => firstClock.wall,
      monotonicNowMs: () => firstClock.mono,
      randomBytes: size => Buffer.alloc(size, 17),
      challengeStore: firstStore
    })
    const second = new SignedProviderClaimVerifier({
      trustStore: f.trustStore,
      audience: scope.audience,
      verifierInstanceId: scope.verifierInstanceId,
      wallNowMs: () => secondClock.wall,
      monotonicNowMs: () => secondClock.mono,
      challengeStore: secondStore
    })
    const challenge = first.issueChallenge({
      runId: 'shared-run',
      expectedBinding: f.expectedBinding,
      keyId: f.keyId,
      ttlMs: 5_000
    })
    const claims = {
      ...challenge,
      observedAtMs: 10_025,
      claimedServerInstanceId: 'claimed-paper-shared',
      claimedBootId: 'claimed-boot-shared',
      loadedArtifacts: f.expectedBinding.artifacts
    }
    const envelope = {
      schemaVersion: 1 as const,
      claims,
      signatureBase64Url: sign(
        null,
        canonicalSignedProviderClaimV1(claims),
        f.pair.privateKey
      ).toString('base64url')
    }

    assert.equal(second.verifyAndConsume(envelope).nonceConsumed, true)
    firstClock.wall = secondClock.wall
    assert.throws(() => first.verifyAndConsume(envelope), /challenge|replay|consumed|unavailable/i)
  } finally {
    secondStore.close()
    firstStore.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('shared SQLite store giữ observation-bound profile qua round-trip và chặn v1 downgrade', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-shared-observation-bound-'))
  const databasePath = path.join(directory, 'challenges.sqlite')
  const f = fixture()
  const scope = {
    databasePath,
    trustedWallNowMs: () => 10_025,
    audience: 'shared-observation-bound-audience',
    verifierInstanceId: 'shared-observation-bound-instance'
  }
  const firstStore = new SqliteSignedProviderChallengeStore(scope)
  const secondStore = new SqliteSignedProviderChallengeStore(scope)
  try {
    const first = new SignedProviderClaimVerifier({
      trustStore: f.trustStore,
      audience: scope.audience,
      verifierInstanceId: scope.verifierInstanceId,
      wallNowMs: () => 10_000,
      monotonicNowMs: () => 100,
      randomBytes: size => Buffer.alloc(size, 18),
      challengeStore: firstStore
    })
    const second = new SignedProviderClaimVerifier({
      trustStore: f.trustStore,
      audience: scope.audience,
      verifierInstanceId: scope.verifierInstanceId,
      wallNowMs: () => 10_050,
      monotonicNowMs: () => 50,
      challengeStore: secondStore
    })
    const challenge = first.issueChallenge({
      runId: 'shared-observation-bound-run',
      expectedBinding: f.expectedBinding,
      keyId: f.keyId,
      ttlMs: 5_000,
      requiredClaimProfile: 'jvm-observation-bound-v2'
    })
    const loaded = secondStore.load(challenge.challengeId, () => 10_025)
    assert.equal(loaded?.challenge.challengeId, challenge.challengeId)
    assert.equal(loaded?.challenge.requiredClaimProfile, 'jvm-observation-bound-v2')
    const claims = {
      ...challenge,
      observedAtMs: 10_025,
      claimedServerInstanceId: 'claimed-paper-shared-observation',
      claimedBootId: 'claimed-boot-shared-observation',
      loadedArtifacts: f.expectedBinding.artifacts
    }
    assert.throws(() => second.verifyAndConsume({
      schemaVersion: 1,
      claims,
      signatureBase64Url: Buffer.alloc(64).toString('base64url')
    }), /profile|observation|challenge/i)
    const jvmArtifactObservation = {
      schemaVersion: 1 as const,
      grade: 'codesource-file-and-class-resource-observed' as const,
      authoritative: false as const,
      provesLoadedBytecode: false as const,
      releaseEligible: false as const,
      assumptions: [
        'standard-non-instrumented-anchor-classloader' as const,
        'java-agent-absence-verified:false' as const
      ],
      declared: {
        role: 'candidate' as const,
        logicalId: 'candidate', logicalPath: 'plugins/Plugin.jar'
      },
      observedClassBinaryName: 'example.Plugin',
      codeSourceUriFingerprint: '5'.repeat(64),
      codeSourceFileSha256: '1'.repeat(64),
      codeSourceFileBytes: 100,
      classResourceSha256: '6'.repeat(64),
      classResourceBytes: 100,
      classResourceOrigin: 'anchor-class-getResourceAsStream;loader-mediated;parent-delegation-possible;runtime-version-selection-unknown;may-differ-from-defined-bytecode;origin-not-proven' as const,
      classResourceInformational: true as const,
      sameLoaderMediated: true as const,
      mayDifferFromDefinedBytecode: true as const,
      internalEntryConsistency: 'MATCH' as const,
      atomicSnapshot: false as const
    }
    const signatureBase64Url = sign(null, canonicalSignedProviderObservationBoundClaimV2({
      claims, jvmArtifactObservation
    }), f.pair.privateKey).toString('base64url')
    assert.equal(second.verifyAndConsume({
      schemaVersion: 2,
      profile: 'jvm-observation-bound-v2',
      claims,
      jvmArtifactObservation,
      signatureBase64Url
    }).nonceConsumed, true)
  } finally {
    secondStore.close()
    firstStore.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('shared SQLite store reject verifier policy split-brain ngay khi dựng worker', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-shared-policy-verifier-'))
  const databasePath = path.join(directory, 'challenges.sqlite')
  const f = fixture()
  const scope = {
    databasePath,
    trustedWallNowMs: () => 10_025,
    audience: 'shared-policy-audience',
    verifierInstanceId: 'shared-policy-instance'
  }
  const firstStore = new SqliteSignedProviderChallengeStore(scope)
  const secondStore = new SqliteSignedProviderChallengeStore(scope)
  try {
    new SignedProviderClaimVerifier({
      trustStore: f.trustStore,
      audience: scope.audience,
      verifierInstanceId: scope.verifierInstanceId,
      wallNowMs: () => 10_025,
      maxPending: 2,
      maxInvalidAttempts: 2,
      challengeStore: firstStore
    })
    assert.throws(() => new SignedProviderClaimVerifier({
      trustStore: f.trustStore,
      audience: scope.audience,
      verifierInstanceId: scope.verifierInstanceId,
      wallNowMs: () => 10_025,
      maxPending: 3,
      maxInvalidAttempts: 2,
      challengeStore: secondStore
    }), /max_pending|policy|mismatch/i)
  } finally {
    secondStore.close()
    firstStore.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('shared SQLite store reject trust-store drift ngay khi dựng worker', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-shared-trust-policy-'))
  const databasePath = path.join(directory, 'challenges.sqlite')
  const f = fixture()
  const scope = {
    databasePath,
    trustedWallNowMs: () => 10_025,
    audience: 'shared-trust-audience',
    verifierInstanceId: 'shared-trust-instance'
  }
  const firstStore = new SqliteSignedProviderChallengeStore(scope)
  const secondStore = new SqliteSignedProviderChallengeStore(scope)
  try {
    new SignedProviderClaimVerifier({
      trustStore: f.trustStore,
      audience: scope.audience,
      verifierInstanceId: scope.verifierInstanceId,
      wallNowMs: () => 10_025,
      challengeStore: firstStore
    })
    assert.throws(() => new SignedProviderClaimVerifier({
      trustStore: trustStoreVersion(f, 'v2'),
      audience: scope.audience,
      verifierInstanceId: scope.verifierInstanceId,
      wallNowMs: () => 10_025,
      challengeStore: secondStore
    }), /trust.?store|policy|mismatch/i)
  } finally {
    secondStore.close()
    firstStore.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('shared SQLite store chia sẻ invalid-signature budget và burn qua hai verifier', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-shared-invalid-verifier-'))
  const databasePath = path.join(directory, 'challenges.sqlite')
  const f = fixture()
  const attacker = generateKeyPairSync('ed25519')
  const scope = {
    databasePath,
    trustedWallNowMs: () => 10_025,
    audience: 'shared-invalid-audience',
    verifierInstanceId: 'shared-invalid-instance'
  }
  const firstStore = new SqliteSignedProviderChallengeStore(scope)
  const secondStore = new SqliteSignedProviderChallengeStore(scope)
  const firstClock = { wall: 10_000, mono: 100 }
  const secondClock = { wall: 10_050, mono: 50 }
  try {
    const first = new SignedProviderClaimVerifier({
      trustStore: f.trustStore,
      audience: scope.audience,
      verifierInstanceId: scope.verifierInstanceId,
      wallNowMs: () => firstClock.wall,
      monotonicNowMs: () => firstClock.mono,
      randomBytes: size => Buffer.alloc(size, 19),
      maxInvalidAttempts: 2,
      challengeStore: firstStore
    })
    const second = new SignedProviderClaimVerifier({
      trustStore: f.trustStore,
      audience: scope.audience,
      verifierInstanceId: scope.verifierInstanceId,
      wallNowMs: () => secondClock.wall,
      monotonicNowMs: () => secondClock.mono,
      maxInvalidAttempts: 2,
      challengeStore: secondStore
    })
    const challenge = first.issueChallenge({
      runId: 'shared-invalid-run',
      expectedBinding: f.expectedBinding,
      keyId: f.keyId,
      ttlMs: 5_000
    })
    const claims = {
      ...challenge,
      observedAtMs: 10_025,
      claimedServerInstanceId: 'claimed-paper-invalid',
      claimedBootId: 'claimed-boot-invalid',
      loadedArtifacts: f.expectedBinding.artifacts
    }
    const envelope = (privateKey: typeof f.pair.privateKey) => ({
      schemaVersion: 1 as const,
      claims,
      signatureBase64Url: sign(
        null,
        canonicalSignedProviderClaimV1(claims),
        privateKey
      ).toString('base64url')
    })

    firstClock.wall = 10_025
    assert.throws(() => first.verifyAndConsume(envelope(attacker.privateKey)), /signature/i)
    assert.throws(() => second.verifyAndConsume(envelope(attacker.privateKey)), /signature/i)
    firstClock.wall = secondClock.wall
    assert.throws(
      () => first.verifyAndConsume(envelope(f.pair.privateKey)),
      /challenge|consumed|unavailable|replay/i
    )
  } finally {
    secondStore.close()
    firstStore.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
