import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  artifactTargetBindingSha256,
  buildArtifactTargetBinding,
  loadArtifactTargetBindingFile
} from '../src/target-binding.js'
import { verifyArtifactBoundBundle, writeEvidenceBundle } from '../src/evidence-bundle.js'

function bindingInput() {
  return {
    schemaVersion: 1 as const,
    bindingId: 'itemguard-paper-1.21.11',
    provider: {
      kind: 'filesystem-snapshot' as const,
      id: 'controlled-fixture-resolver',
      version: '1.0.0',
      instanceId: 'fixture-a'
    },
    authorization: {
      id: 'approval-20260827',
      scope: ['read-only', 'artifact-bind']
    },
    artifacts: [
      {
        logicalId: 'candidate', role: 'candidate' as const,
        logicalPath: 'plugins/ItemGuard.jar', sha256: '2'.repeat(64)
      },
      {
        logicalId: 'paper', role: 'paper' as const,
        logicalPath: 'server/paper.jar', sha256: '1'.repeat(64)
      },
      {
        logicalId: 'config-main', role: 'config' as const,
        logicalPath: 'plugins/ItemGuard/config.yml', sha256: '3'.repeat(64)
      }
    ]
  }
}

test('artifact target binding canonical hóa deterministic nhưng luôn không release eligible', () => {
  const first = buildArtifactTargetBinding(bindingInput())
  const reordered = bindingInput()
  reordered.authorization.scope.reverse()
  reordered.artifacts.reverse()
  const second = buildArtifactTargetBinding(reordered)

  assert.deepEqual(first, second)
  assert.deepEqual(first.authorization.scope, ['artifact-bind', 'read-only'])
  assert.deepEqual(first.artifacts.map(artifact => artifact.logicalId), ['candidate', 'config-main', 'paper'])
  assert.equal(first.evidenceGrade, 'artifact-bound')
  assert.equal(first.releaseEligible, false)
  assert.equal(artifactTargetBindingSha256(first), artifactTargetBindingSha256(second))
})

test('artifact target binding reject role confusion, path alias, duplicate và credential-like metadata', () => {
  const swapped = bindingInput()
  swapped.artifacts[0]!.role = 'paper'
  assert.throws(() => buildArtifactTargetBinding(swapped), /paper|candidate|role/i)

  const duplicate = bindingInput()
  duplicate.artifacts.push({ ...duplicate.artifacts[0]! })
  assert.throws(() => buildArtifactTargetBinding(duplicate), /duplicate/i)

  const missingPaper = bindingInput()
  missingPaper.artifacts = missingPaper.artifacts.filter(artifact => artifact.role !== 'paper')
  assert.throws(() => buildArtifactTargetBinding(missingPaper), /paper/i)

  const missingConfig = bindingInput()
  missingConfig.artifacts = missingConfig.artifacts.filter(artifact => artifact.role !== 'config')
  assert.throws(() => buildArtifactTargetBinding(missingConfig), /config/i)

  const traversal = bindingInput()
  traversal.artifacts[0]!.logicalPath = '../ItemGuard.jar'
  assert.throws(() => buildArtifactTargetBinding(traversal), /path/i)

  const secret = bindingInput()
  secret.authorization.id = 'token=secret-value'
  assert.throws(() => buildArtifactTargetBinding(secret), /credential|authorization/i)

  assert.throws(() => buildArtifactTargetBinding({ ...bindingInput(), runtimeBound: true }), /unknown|unrecognized/i)
})

test('artifact target binding hash bind role/path/provider/authorization và reject schema downgrade', () => {
  const base = buildArtifactTargetBinding(bindingInput())
  const changedPath = bindingInput()
  changedPath.artifacts[0]!.logicalPath = 'plugins/Other.jar'
  const changedScope = bindingInput()
  changedScope.authorization.scope = ['artifact-bind']

  assert.notEqual(artifactTargetBindingSha256(base), artifactTargetBindingSha256(buildArtifactTargetBinding(changedPath)))
  assert.notEqual(artifactTargetBindingSha256(base), artifactTargetBindingSha256(buildArtifactTargetBinding(changedScope)))
  assert.throws(() => buildArtifactTargetBinding({ ...bindingInput(), schemaVersion: 2 }), /schema|literal|version/i)
})

test('target binding file loader đọc strict bounded regular file một lần', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-target-binding-file-'))
  try {
    const file = path.join(directory, 'binding.json')
    await writeFile(file, JSON.stringify(bindingInput()))
    assert.deepEqual(loadArtifactTargetBindingFile(file), buildArtifactTargetBinding(bindingInput()))

    const directoryPath = path.join(directory, 'not-a-file')
    await import('node:fs/promises').then(({ mkdir }) => mkdir(directoryPath))
    assert.throws(() => loadArtifactTargetBindingFile(directoryPath), /regular file/i)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('artifact-bound verifier chứng minh integrity + exact declared target nhưng không release', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-artifact-bound-'))
  const binding = buildArtifactTargetBinding(bindingInput())
  const targetBindingSha256 = artifactTargetBindingSha256(binding)
  const runId = 'artifact-run'
  try {
    const report = {
      runId,
      verdict: 'PASS',
      manifest: {
        schemaVersion: 1,
        evidence: { evidenceGrade: 'artifact-bound', releaseEligible: false, targetBinding: binding, targetBindingSha256 }
      }
    }
    await writeEvidenceBundle(directory, `${runId}.bundle.json`, {
      runId,
      scenarioSha256: '4'.repeat(64),
      targetBindingSha256,
      artifacts: [{ role: 'report', fileName: `${runId}.json`, content: JSON.stringify(report) }]
    })

    assert.deepEqual(await verifyArtifactBoundBundle(directory, `${runId}.bundle.json`, binding), {
      integrity: true,
      expectedMatch: true,
      evidenceGrade: 'artifact-bound',
      releaseEligible: false,
      functionalVerdict: 'PASS',
      targetBindingSha256
    })

    const stale = bindingInput()
    stale.artifacts[0]!.sha256 = '9'.repeat(64)
    await assert.rejects(
      verifyArtifactBoundBundle(directory, `${runId}.bundle.json`, buildArtifactTargetBinding(stale)),
      /binding.*mismatch|stale/i
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('artifact-bound verifier reject development-unbound PASS và unsigned runtime grade', async () => {
  const binding = buildArtifactTargetBinding(bindingInput())
  for (const [runId, evidence] of [
    ['unbound-run', { evidenceGrade: 'development-unbound', releaseEligible: false }],
    ['forged-runtime-run', {
      evidenceGrade: 'runtime-bound', releaseEligible: true,
      targetBinding: binding, targetBindingSha256: artifactTargetBindingSha256(binding)
    }]
  ] as const) {
    const directory = await mkdtemp(path.join(tmpdir(), `botchecker-${runId}-`))
    try {
      await writeEvidenceBundle(directory, `${runId}.bundle.json`, {
        runId,
        scenarioSha256: '5'.repeat(64),
        artifacts: [{
          role: 'report', fileName: `${runId}.json`,
          content: JSON.stringify({ runId, verdict: 'PASS', manifest: { schemaVersion: 1, evidence } })
        }]
      })
      await assert.rejects(
        verifyArtifactBoundBundle(directory, `${runId}.bundle.json`, binding),
        /artifact-bound|runtime-bound|unsigned|target binding/i
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
})
