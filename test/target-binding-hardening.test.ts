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
    bindingId: 'hardening-target',
    provider: { kind: 'filesystem-snapshot', id: 'fixture-resolver', version: '1.0.0' },
    authorization: { id: 'approval-20260827', scope: ['artifact-bind'] },
    artifacts: [
      { logicalId: 'candidate', role: 'candidate', logicalPath: 'plugins/Plugin.jar', sha256: '5'.repeat(64) },
      { logicalId: 'paper', role: 'paper', logicalPath: 'server/paper.jar', sha256: '6'.repeat(64) },
      { logicalId: 'config', role: 'config', logicalPath: 'plugins/Plugin/config.yml', sha256: '7'.repeat(64) }
    ]
  })
}

test('TestRun từ chối sourceRevision không phải exact Git commit', () => {
  const scenario = scenarioSchema.parse({
    name: 'invalid source revision',
    steps: [{ id: 'done', action: 'wait', durationMs: 0 }]
  })
  assert.throws(() => new TestRun(
    scenario,
    { host: 'localhost', port: 25565, username: 'tester', auth: 'offline' },
    path.join(tmpdir(), 'botchecker-invalid-source-revision'),
    { sourceRevision: 'abc123' }
  ), /sourceRevision|Git commit/i)
})

test('artifact-bound verifier reject capability fingerprint seal lệch report', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-binding-capability-'))
  const targetBinding = binding()
  const targetBindingSha256 = artifactTargetBindingSha256(targetBinding)
  try {
    await writeEvidenceBundle(directory, 'capability-run.bundle.json', {
      runId: 'capability-run',
      scenarioSha256: '8'.repeat(64),
      capabilitySourceFingerprint: '1'.repeat(64),
      targetBindingSha256,
      artifacts: [{
        role: 'report', fileName: 'capability-run.json',
        content: JSON.stringify({
          runId: 'capability-run', verdict: 'PASS',
          manifest: {
            schemaVersion: 1,
            capability: { sourceFingerprint: '2'.repeat(64) },
            evidence: {
              evidenceGrade: 'artifact-bound', releaseEligible: false,
              targetBinding, targetBindingSha256
            }
          }
        })
      }]
    })
    await assert.rejects(
      verifyArtifactBoundBundle(directory, 'capability-run.bundle.json', targetBinding),
      /capability.*fingerprint/i
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
