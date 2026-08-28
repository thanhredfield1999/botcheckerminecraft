import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  assessJvmArtifactObservationAgainstBinding,
  canonicalJvmArtifactObservationV1,
  parseJvmArtifactObservationV1,
  type JvmArtifactObservationV1
} from '../src/jvm-artifact-observation.js'
import { buildArtifactTargetBinding } from '../src/target-binding.js'

const candidateSha256 = '2'.repeat(64)

function binding() {
  return buildArtifactTargetBinding({
    schemaVersion: 1,
    bindingId: 'itemguard-paper-1.21.11',
    provider: { kind: 'filesystem-snapshot', id: 'fixture-resolver', version: '1.0.0' },
    authorization: { id: 'approval-20260828', scope: ['artifact-bind', 'read-only'] },
    artifacts: [
      {
        logicalId: 'candidate', role: 'candidate',
        logicalPath: 'plugins/ItemGuard.jar', sha256: candidateSha256
      },
      {
        logicalId: 'paper', role: 'paper',
        logicalPath: 'server/paper.jar', sha256: '1'.repeat(64)
      },
      {
        logicalId: 'config-main', role: 'config',
        logicalPath: 'plugins/ItemGuard/config.yml', sha256: '3'.repeat(64)
      }
    ]
  })
}

function observation(): JvmArtifactObservationV1 {
  return {
    schemaVersion: 1,
    grade: 'codesource-file-and-class-resource-observed',
    authoritative: false,
    provesLoadedBytecode: false,
    releaseEligible: false,
    assumptions: [
      'standard-non-instrumented-anchor-classloader',
      'java-agent-absence-verified:false'
    ],
    declared: {
      role: 'candidate', logicalId: 'candidate', logicalPath: 'plugins/ItemGuard.jar'
    },
    observedClassBinaryName: 'com.example.itemguard.ItemGuardPlugin',
    codeSourceUriFingerprint: '4'.repeat(64),
    codeSourceFileSha256: candidateSha256,
    codeSourceFileBytes: 65_536,
    classResourceSha256: '5'.repeat(64),
    classResourceBytes: 4_096,
    classResourceOrigin: 'anchor-class-getResourceAsStream;loader-mediated;parent-delegation-possible;runtime-version-selection-unknown;may-differ-from-defined-bytecode;origin-not-proven',
    classResourceInformational: true,
    sameLoaderMediated: true,
    mayDifferFromDefinedBytecode: true,
    internalEntryConsistency: 'MATCH',
    atomicSnapshot: false
  }
}

test('exact observation-to-binding match vẫn chỉ là non-authoritative assessment', () => {
  const sourceObservation = observation()
  const result = assessJvmArtifactObservationAgainstBinding(sourceObservation, binding())
  const observationSha256 = createHash('sha256')
    .update(canonicalJvmArtifactObservationV1(sourceObservation)).digest('hex')

  assert.deepEqual(result, {
    schemaVersion: 1,
    status: 'TARGET_FILE_MATCH_NON_AUTHORITATIVE',
    authoritative: false,
    provesLoadedBytecode: false,
    releaseEligible: false,
    bindingId: 'itemguard-paper-1.21.11',
    targetBindingSha256: result.targetBindingSha256,
    observationSha256,
    codeSourceUriFingerprint: '4'.repeat(64),
    codeSourceFileSha256: '2'.repeat(64),
    codeSourceFileBytes: 65_536,
    classResourceSha256: '5'.repeat(64),
    classResourceBytes: 4_096,
    internalEntryConsistency: 'MATCH',
    classResourceAssessment: 'BASE_ENTRY_MATCH_INFORMATIONAL',
    artifact: {
      logicalId: 'candidate',
      role: 'candidate',
      logicalPath: 'plugins/ItemGuard.jar',
      expectedSha256: candidateSha256,
      observedCodeSourceFileSha256: candidateSha256
    },
    observedClassBinaryName: 'com.example.itemguard.ItemGuardPlugin',
    limitations: [
      'declared-identity-is-caller-supplied',
      'codesource-file-is-not-loaded-bytecode-proof',
      'class-resource-is-loader-mediated-informational-evidence',
      'snapshot-is-best-effort-non-atomic'
    ]
  })
})

test('hash mismatch được giữ thành structured non-authoritative counterevidence', () => {
  const mismatch = { ...observation(), codeSourceFileSha256: '9'.repeat(64) }
  const result = assessJvmArtifactObservationAgainstBinding(mismatch, binding())

  assert.equal(result.status, 'MISMATCH_NON_AUTHORITATIVE')
  assert.equal(result.reason, 'HASH_MISMATCH')
  assert.equal(result.authoritative, false)
  assert.equal(result.provesLoadedBytecode, false)
  assert.equal(result.releaseEligible, false)
  assert.equal(result.artifact.expectedSha256, candidateSha256)
  assert.equal(result.artifact.observedCodeSourceFileSha256, '9'.repeat(64))
  const serialized = JSON.stringify(result)
  assert.equal(serialized.includes('loadedArtifacts'), false)
  assert.equal(serialized.includes('runtimeBound'), false)
  assert.equal(serialized.includes('"releaseEligible":true'), false)
})

test('declared identity mismatch được giữ riêng, không bị nhầm với hash mismatch', () => {
  const mismatched = {
    ...observation(),
    declared: { role: 'candidate' as const, logicalId: 'other', logicalPath: 'plugins/Other.jar' }
  }
  const result = assessJvmArtifactObservationAgainstBinding(mismatched, binding())

  assert.equal(result.status, 'MISMATCH_NON_AUTHORITATIVE')
  assert.equal(result.reason, 'DECLARED_IDENTITY_MISMATCH')
  assert.deepEqual(result.declared, mismatched.declared)
  assert.equal(result.authoritative, false)
  assert.equal(result.releaseEligible, false)
})

test('strict parser reject trust forgery, schema downgrade, unknown field và byte overflow', () => {
  for (const invalid of [
    { ...observation(), authoritative: true },
    { ...observation(), provesLoadedBytecode: true },
    { ...observation(), releaseEligible: true },
    { ...observation(), schemaVersion: 2 },
    { ...observation(), declared: { ...observation().declared, role: 'config' } },
    { ...observation(), declared: { ...observation().declared, logicalId: 'token-observation' } },
    { ...observation(), declared: { ...observation().declared, logicalPath: 'plugins/secret.jar' } },
    { ...observation(), runtimeBound: true },
    { ...observation(), codeSourceFileBytes: 64 * 1024 * 1024, classResourceBytes: 1 }
  ]) assert.throws(() => parseJvmArtifactObservationV1(invalid))
})

test('parsed observation deep-freeze caller-owned declared và assumptions', () => {
  const input = JSON.parse(JSON.stringify(observation())) as {
    declared: { logicalId: string }
    assumptions: string[]
  }
  const parsed = parseJvmArtifactObservationV1(input)
  input.declared.logicalId = 'mutated'
  input.assumptions[0] = 'mutated'

  assert.equal(parsed.declared.logicalId, 'candidate')
  assert.equal(parsed.assumptions[0], 'standard-non-instrumented-anchor-classloader')
  assert.equal(Object.isFrozen(parsed), true)
  assert.equal(Object.isFrozen(parsed.declared), true)
  assert.equal(Object.isFrozen(parsed.assumptions), true)
})

test('canonical observation bytes có fixed field order sau strict parse', () => {
  const reordered = Object.fromEntries(Object.entries(observation()).reverse())
  const bytes = canonicalJvmArtifactObservationV1(reordered)
  const parsed = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>

  assert.deepEqual(Object.keys(parsed), [
    'schemaVersion', 'grade', 'authoritative', 'provesLoadedBytecode', 'releaseEligible',
    'assumptions', 'declared', 'observedClassBinaryName', 'codeSourceUriFingerprint',
    'codeSourceFileSha256', 'codeSourceFileBytes', 'classResourceSha256',
    'classResourceBytes', 'classResourceOrigin', 'classResourceInformational',
    'sameLoaderMediated', 'mayDifferFromDefinedBytecode', 'internalEntryConsistency',
    'atomicSnapshot'
  ])
  assert.deepEqual(parseJvmArtifactObservationV1(parsed), parseJvmArtifactObservationV1(observation()))
})

test('assessment hash bind toàn bộ class-resource observation fields', () => {
  const first = assessJvmArtifactObservationAgainstBinding(observation(), binding())
  const changed = {
    ...observation(),
    classResourceSha256: '8'.repeat(64),
    internalEntryConsistency: 'MISMATCH' as const
  }
  const second = assessJvmArtifactObservationAgainstBinding(changed, binding())

  assert.notEqual(first.observationSha256, second.observationSha256)
  assert.equal(first.internalEntryConsistency, 'MATCH')
  assert.equal(second.internalEntryConsistency, 'MISMATCH')
  assert.equal(second.classResourceAssessment, 'BASE_ENTRY_MISMATCH_INFORMATIONAL')
  assert.equal(second.classResourceSha256, '8'.repeat(64))
  assert.equal(second.classResourceBytes, 4_096)
  assert.equal(second.codeSourceUriFingerprint, '4'.repeat(64))
  assert.equal(second.codeSourceFileBytes, 65_536)
  assert.equal(second.status, 'TARGET_FILE_MATCH_NON_AUTHORITATIVE')

  const notJar = assessJvmArtifactObservationAgainstBinding({
    ...observation(),
    internalEntryConsistency: 'NOT_A_JAR'
  }, binding())
  assert.equal(notJar.classResourceAssessment, 'NOT_A_JAR_INFORMATIONAL')
  assert.equal(notJar.status, 'TARGET_FILE_MATCH_NON_AUTHORITATIVE')
})
