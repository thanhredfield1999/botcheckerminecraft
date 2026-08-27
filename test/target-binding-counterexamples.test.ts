import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { verifyArtifactBoundBundle, writeEvidenceBundle } from '../src/evidence-bundle.js'
import { TestRun } from '../src/runner.js'
import { scenarioSchema } from '../src/scenario.js'
import { artifactTargetBindingSha256, buildArtifactTargetBinding } from '../src/target-binding.js'

function binding() {
  return buildArtifactTargetBinding({
    schemaVersion: 1,
    bindingId: 'counterexample-target',
    provider: { kind: 'filesystem-snapshot', id: 'fixture-resolver', version: '1.0.0' },
    authorization: { id: 'approval-20260827', scope: ['artifact-bind'] },
    artifacts: [
      { logicalId: 'candidate', role: 'candidate', logicalPath: 'plugins/Plugin.jar', sha256: '5'.repeat(64) },
      { logicalId: 'paper', role: 'paper', logicalPath: 'server/paper.jar', sha256: '6'.repeat(64) },
      { logicalId: 'config', role: 'config', logicalPath: 'plugins/Plugin/config.yml', sha256: '7'.repeat(64) }
    ]
  })
}

test('artifact-bound verifier reject report runId khác seal dù filename đúng', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-binding-run-id-'))
  const targetBinding = binding()
  const targetBindingSha256 = artifactTargetBindingSha256(targetBinding)
  try {
    await writeEvidenceBundle(directory, 'bound-run.bundle.json', {
      runId: 'bound-run', scenarioSha256: '6'.repeat(64), targetBindingSha256,
      artifacts: [{
        role: 'report', fileName: 'bound-run.json',
        content: JSON.stringify({
          runId: 'different-run', verdict: 'PASS',
          manifest: {
            schemaVersion: 1,
            evidence: { evidenceGrade: 'artifact-bound', releaseEligible: false, targetBinding, targetBindingSha256 }
          }
        })
      }]
    })
    await assert.rejects(
      verifyArtifactBoundBundle(directory, 'bound-run.bundle.json', targetBinding),
      /report.*runId|runId.*report/i
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('TestRun snapshot target binding tại constructor trước khi caller mutate', () => {
  const mutable = binding()
  const scenario = scenarioSchema.parse({
    name: 'binding snapshot', steps: [{ id: 'done', action: 'wait', durationMs: 0 }]
  })
  const run = new TestRun(
    scenario,
    { host: 'localhost', port: 25565, username: 'tester', auth: 'offline' },
    path.join(tmpdir(), 'botchecker-binding-snapshot'),
    { targetBinding: mutable }
  )
  const before = run.report().manifest.evidence
  assert.equal(before.evidenceGrade, 'artifact-bound')
  if (before.evidenceGrade !== 'artifact-bound') return
  const expectedHash = before.targetBindingSha256

  mutable.artifacts[0]!.sha256 = '9'.repeat(64)
  const after = run.report().manifest.evidence
  assert.equal(after.evidenceGrade, 'artifact-bound')
  if (after.evidenceGrade !== 'artifact-bound') return
  assert.equal(after.targetBindingSha256, expectedHash)
  assert.equal(after.targetBinding.artifacts[0]?.sha256, '5'.repeat(64))
})
