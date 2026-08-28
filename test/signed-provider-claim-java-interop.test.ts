import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, type KeyObject } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildSignedProviderClaimTrustStore,
  canonicalSignedProviderClaimV1,
  canonicalSignedProviderObservationBoundClaimV2,
  SignedProviderClaimVerifier
} from '../src/signed-provider-claim.js'

import { artifactTargetBindingSha256, buildArtifactTargetBinding } from '../src/target-binding.js'

const javaInteropAvailable = spawnSync('javac', ['--release', '21', '-version'], {
  encoding: 'utf8', windowsHide: true
}).status === 0

function binding() {
  return buildArtifactTargetBinding({
    schemaVersion: 1,
    bindingId: 'java-interop-binding',
    provider: { kind: 'filesystem-snapshot', id: 'fixture-resolver', version: '1.0.0' },
    authorization: { id: 'approval-20260828', scope: ['artifact-bind'] },
    artifacts: [
      { logicalId: 'probe', role: 'probe', logicalPath: 'plugins/BotCheckerProbe.jar', sha256: '4'.repeat(64) },
      { logicalId: 'paper', role: 'paper', logicalPath: 'server/paper.jar', sha256: '3'.repeat(64) },
      { logicalId: 'config', role: 'config', logicalPath: 'plugins/Example/config.yml', sha256: '2'.repeat(64) },
      { logicalId: 'candidate', role: 'candidate', logicalPath: 'plugins/Example.jar', sha256: '1'.repeat(64) }
    ]
  })
}

function trustKey(publicKey: KeyObject, targetBindingSha256: string) {
  const der = publicKey.export({ type: 'spki', format: 'der' })
  return {
    schemaVersion: 1 as const,
    algorithm: 'ed25519' as const,
    keyId: createHash('sha256').update(der).digest('hex'),
    publicKeySpkiDerBase64: der.toString('base64'),
    provider: {
      kind: 'server-probe' as const,
      id: 'java-interop-probe',
      version: '1.0.0',
      instanceId: 'java-fixture-key-slot-a'
    },
    allowedBindings: [{ bindingId: 'java-interop-binding', targetBindingSha256 }],
    notBeforeMs: 1_000,
    notAfterMs: 100_000,
    status: 'active' as const
  }
}

test('Java 21 fixture canonicalize và ký Ed25519 được Node verifier chấp nhận', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-java-interop-'))
  try {
    const expectedBinding = binding()
    const targetBindingSha256 = artifactTargetBindingSha256(expectedBinding)
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const key = trustKey(publicKey, targetBindingSha256)
    const trustStore = buildSignedProviderClaimTrustStore({
      schemaVersion: 1,
      trustStoreId: 'java-interop-trust',
      trustStoreVersion: '2026.08.28-1',
      keys: [key]
    })
    const clock = { wall: 10_000, mono: 500 }
    const verifier = new SignedProviderClaimVerifier({
      trustStore,
      audience: 'botchecker-java-interop',
      verifierInstanceId: 'java-interop-verifier',
      wallNowMs: () => clock.wall,
      monotonicNowMs: () => clock.mono,
      randomBytes: size => Buffer.alloc(size, 23)
    })
    const challenge = verifier.issueChallenge({
      runId: 'java-interop-run', expectedBinding, keyId: key.keyId, ttlMs: 5_000
    })
    clock.wall = 10_100
    clock.mono = 600
    const claims = {
      ...challenge,
      observedAtMs: 10_050,
      claimedServerInstanceId: 'claimed-paper-java-fixture',
      claimedBootId: 'claimed-boot-java-fixture',
      loadedArtifacts: [...expectedBinding.artifacts].reverse()
    }

    const privateKeyPath = path.join(workspace, 'private-key.pkcs8')
    const inputPath = path.join(workspace, 'claim-input.txt')
    const outputPath = path.join(workspace, 'signed-output.txt')
    const classesPath = path.join(workspace, 'classes')
    mkdirSync(classesPath)
    writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'der' }), { mode: 0o600 })
    writeFileSync(inputPath, [
      claims.audience,
      claims.verifierInstanceId,
      String(claims.sequence),
      claims.challengeId,
      claims.nonceBase64Url,
      claims.runId,
      claims.keyId,
      claims.bindingId,
      claims.targetBindingSha256,
      claims.provider.id,
      claims.provider.version,
      claims.provider.instanceId ?? '-',
      claims.trustStoreId,
      claims.trustStoreVersion,
      claims.trustStoreSha256,
      String(claims.issuedAtMs),
      String(claims.expiresAtMs),
      String(claims.observedAtMs),
      claims.claimedServerInstanceId,
      claims.claimedBootId,
      String(claims.loadedArtifacts.length),
      ...claims.loadedArtifacts.map(artifact => [
        artifact.logicalId, artifact.role, artifact.logicalPath, artifact.sha256
      ].join('\t'))
    ].join('\n') + '\n', 'utf8')

    const sourcePath = path.resolve('test/fixtures/java/SignedProviderClaimInteropFixture.java')
    const observerSourcePath = path.resolve(
      'java-src/vn/heomc/botchecker/probe/JvmArtifactObserver.java'
    )
    const builderSourcePath = path.resolve(
      'java-src/vn/heomc/botchecker/probe/JvmObservationBoundClaimBuilder.java'
    )
    execFileSync('javac', [
      '--release', '21', '-d', classesPath,
      observerSourcePath, builderSourcePath, sourcePath
    ], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    execFileSync('java', [
      '-cp', classesPath,
      'SignedProviderClaimInteropFixture',
      inputPath,
      privateKeyPath,
      outputPath
    ], { cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe' })

    const [canonicalBase64Url, signatureBase64Url] = requireOutput(outputPath)
    assert.equal(Buffer.from(canonicalBase64Url, 'base64url').toString('utf8'),
      canonicalSignedProviderClaimV1(claims).toString('utf8'))
    const result = verifier.verifyAndConsume({ schemaVersion: 1, claims, signatureBase64Url })
    assert.equal(result.signatureValid, true)
    assert.equal(result.nonceConsumed, true)
    assert.equal(result.releaseEligible, false)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Java 21 fixture canonicalize observation-bound v2 khớp Node và vẫn non-release', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-java-observation-bound-'))
  try {
    const expectedBinding = binding()
    const targetBindingSha256 = artifactTargetBindingSha256(expectedBinding)
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const key = trustKey(publicKey, targetBindingSha256)
    const trustStore = buildSignedProviderClaimTrustStore({
      schemaVersion: 1, trustStoreId: 'java-interop-trust',
      trustStoreVersion: '2026.08.28-1', keys: [key]
    })
    const clock = { wall: 10_000, mono: 500 }
    const verifier = new SignedProviderClaimVerifier({
      trustStore,
      audience: 'botchecker-java-observation-bound',
      verifierInstanceId: 'java-observation-bound-verifier',
      wallNowMs: () => clock.wall,
      monotonicNowMs: () => clock.mono,
      randomBytes: size => Buffer.alloc(size, 24)
    })
    const challenge = verifier.issueChallenge({
      runId: 'java-observation-bound-run', expectedBinding, keyId: key.keyId, ttlMs: 5_000,
      requiredClaimProfile: 'jvm-observation-bound-v2'
    })
    clock.wall = 10_100
    clock.mono = 600
    const claims = {
      ...challenge,
      observedAtMs: 10_050,
      claimedServerInstanceId: 'claimed-paper-java-observation-bound',
      claimedBootId: 'claimed-boot-java-observation-bound',
      loadedArtifacts: [...expectedBinding.artifacts].reverse()
    }
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
        logicalId: 'candidate', logicalPath: 'plugins/Example.jar'
      },
      observedClassBinaryName: 'com.example.Plugin',
      codeSourceUriFingerprint: '5'.repeat(64),
      codeSourceFileSha256: '1'.repeat(64),
      codeSourceFileBytes: 65_536,
      classResourceSha256: '6'.repeat(64),
      classResourceBytes: 4_096,
      classResourceOrigin: 'anchor-class-getResourceAsStream;loader-mediated;parent-delegation-possible;runtime-version-selection-unknown;may-differ-from-defined-bytecode;origin-not-proven' as const,
      classResourceInformational: true as const,
      sameLoaderMediated: true as const,
      mayDifferFromDefinedBytecode: true as const,
      internalEntryConsistency: 'MATCH' as const,
      atomicSnapshot: false as const
    }

    const privateKeyPath = path.join(workspace, 'private-key.pkcs8')
    const inputPath = path.join(workspace, 'claim-input.txt')
    const observationPath = path.join(workspace, 'observation.json')
    const outputPath = path.join(workspace, 'signed-output.txt')
    const classesPath = path.join(workspace, 'classes')
    mkdirSync(classesPath)
    writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'der' }), { mode: 0o600 })
    writeFileSync(inputPath, [
      claims.audience, claims.verifierInstanceId, String(claims.sequence), claims.challengeId,
      claims.nonceBase64Url, claims.runId, claims.keyId, claims.bindingId,
      claims.targetBindingSha256, claims.provider.id, claims.provider.version,
      claims.provider.instanceId ?? '-', claims.trustStoreId, claims.trustStoreVersion,
      claims.trustStoreSha256, String(claims.issuedAtMs), String(claims.expiresAtMs),
      String(claims.observedAtMs), claims.claimedServerInstanceId, claims.claimedBootId,
      String(claims.loadedArtifacts.length),
      ...claims.loadedArtifacts.map(artifact => [
        artifact.logicalId, artifact.role, artifact.logicalPath, artifact.sha256
      ].join('\t'))
    ].join('\n') + '\n', 'utf8')
    writeFileSync(observationPath, [
      jvmArtifactObservation.declared.role,
      jvmArtifactObservation.declared.logicalId,
      jvmArtifactObservation.declared.logicalPath,
      jvmArtifactObservation.observedClassBinaryName,
      jvmArtifactObservation.codeSourceUriFingerprint,
      jvmArtifactObservation.codeSourceFileSha256,
      String(jvmArtifactObservation.codeSourceFileBytes),
      jvmArtifactObservation.classResourceSha256,
      String(jvmArtifactObservation.classResourceBytes),
      jvmArtifactObservation.internalEntryConsistency
    ].join('\n') + '\n', 'utf8')

    const sourcePath = path.resolve('test/fixtures/java/SignedProviderClaimInteropFixture.java')
    const observerSourcePath = path.resolve(
      'java-src/vn/heomc/botchecker/probe/JvmArtifactObserver.java'
    )
    const builderSourcePath = path.resolve(
      'java-src/vn/heomc/botchecker/probe/JvmObservationBoundClaimBuilder.java'
    )
    execFileSync('javac', [
      '--release', '21', '-d', classesPath,
      observerSourcePath, builderSourcePath, sourcePath
    ], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    execFileSync('java', [
      '-cp', classesPath, 'SignedProviderClaimInteropFixture',
      inputPath, privateKeyPath, outputPath, observationPath
    ], { cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe' })

    const [canonicalBase64Url, signatureBase64Url] = requireOutput(outputPath)
    assert.equal(Buffer.from(canonicalBase64Url, 'base64url').equals(
      canonicalSignedProviderObservationBoundClaimV2({ claims, jvmArtifactObservation })
    ), true)
    const result = verifier.verifyAndConsume({
      schemaVersion: 2, profile: 'jvm-observation-bound-v2', claims,
      jvmArtifactObservation, signatureBase64Url
    })
    assert.equal(result.observationBinding?.status, 'TARGET_FILE_MATCH_NON_AUTHORITATIVE')
    assert.equal(result.observationBinding?.provesLoadedBytecode, false)
    assert.equal(result.releaseEligible, false)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

function requireOutput(outputPath: string): [string, string] {
  const output = readFileSync(outputPath, 'utf8').trim().split(/\r?\n/)
  assert.equal(output.length, 2)
  assert.match(output[0] ?? '', /^[A-Za-z0-9_-]+$/)
  assert.match(output[1] ?? '', /^[A-Za-z0-9_-]+$/)
  return [output[0]!, output[1]!]
}
