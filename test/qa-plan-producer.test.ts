import assert from 'node:assert/strict'
import test from 'node:test'
import { runNegativePlan } from '../src/authorized-plan-runner.js'
import { createServer } from '../src/server.js'

const CREDENTIAL = 'qa-producer-credential-abc'

test('delimiter NUL thật: hai case khác nhau không dùng chung khóa lỗi', async () => {
  // Sau khi validatePlan siết caseId, cặp collide của audit không dựng được nữa.
  // Test này chốt phần còn lại: hai case hợp lệ, chỉ một cái lỗi executor.
  const result = await runNegativePlan({
    project: 'Plugin', fixture: 'fixture',
    cases: [
      { accountRef: 'acct', authorization: ['auth'], caseId: 'case-a', expected: 'reject' },
      { accountRef: 'acct', authorization: ['auth'], caseId: 'case-b', expected: 'reject' }
    ]
  }, async current => {
    if (current.caseId === 'case-a') throw new Error('provider down')
    return { rejected: true, mutationCount: 0, evidence: { note: 'rejected safely' } }
  })

  const a = result.cases.find(entry => entry.evidence.caseId === 'case-a')
  const b = result.cases.find(entry => entry.evidence.caseId === 'case-b')
  assert.equal(a?.verdict, 'INCONCLUSIVE', 'case lỗi executor phải INCONCLUSIVE')
  assert.match(a?.message ?? '', /negative executor failed/)
  assert.equal(b?.verdict, 'PASS', 'case chạy được phải giữ verdict thật, không bị lây')
})

test('validatePlan từ chối caseId không bounded', () => {
  const plan = (caseId: unknown) => ({
    project: 'Plugin', fixture: 'fixture',
    cases: [{ accountRef: 'acct', authorization: ['auth'], caseId, expected: 'reject' }]
  })
  for (const invalid of ['x'.repeat(97), 'case id', 'case/id', '', 'api_key-case']) {
    assert.rejects(
      runNegativePlan(plan(invalid) as never, async () => {
        throw new Error('executor must not run for an invalid plan')
      }),
      /Invalid negative case ID|Credential-like/,
      `caseId ${JSON.stringify(invalid)} phải bị từ chối`
    )
  }
})

test('operator chạy được negative-security end-to-end qua HTTP entrypoint', async t => {
  const executed: string[] = []
  const app = createServer({
    logger: false,
    apiCredential: CREDENTIAL,
    scenarioLoader: async () => ({
      name: 'negative-sweep',
      description: '',
      maxDurationMs: 900_000,
      steps: [{ id: 'wait', action: 'wait', durationMs: 1, timeoutMs: 30_000, optional: false }]
    } as never),
    qaPlanExecutor: {
      kind: 'negative-security' as const,
      run: async () => runNegativePlan({
        project: 'ItemGuard', fixture: 'staff-ux',
        cases: [
          { accountRef: 'member', authorization: ['fixture-auth'], caseId: 'malformed-input', expected: 'reject' },
          { accountRef: 'member', authorization: ['fixture-auth'], caseId: 'unauthorized-give', expected: 'no-mutation' }
        ]
      }, async current => {
        executed.push(current.caseId)
        return { rejected: true, mutationCount: 0, evidence: { note: 'observed' } }
      })
    }
  })
  t.after(() => app.close())

  const response = await app.inject({
    method: 'POST', url: '/api/runs',
    headers: { authorization: `Bearer ${CREDENTIAL}` },
    payload: { scenario: 'negative-sweep' }
  })
  assert.equal(response.statusCode, 202)
  const runId = response.json().runId as string

  // Chờ run rời khỏi hàng đợi.
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const view = await app.inject({
      method: 'GET', url: `/api/runs/${runId}`,
      headers: { authorization: `Bearer ${CREDENTIAL}` }
    })
    if (view.statusCode === 200 && !['queued', 'connecting', 'running'].includes(view.json().status)) break
    await new Promise(resolve => setTimeout(resolve, 25))
  }

  const report = await app.inject({
    method: 'GET', url: `/api/runs/${runId}/report`,
    headers: { authorization: `Bearer ${CREDENTIAL}` }
  })
  assert.equal(report.statusCode, 200)

  const qaPlan = report.json().manifest?.qaPlan
  assert.ok(qaPlan, 'report phải có section qaPlan do producer thật sinh ra')
  assert.equal(qaPlan.kind, 'negative-security')
  assert.equal(qaPlan.project, 'ItemGuard')
  assert.equal(qaPlan.summary.total, 2)
  assert.equal(qaPlan.summary.pass, 2, 'verdict phải non-vacuous, không phải rỗng')
  assert.equal(qaPlan.verdict, 'PASS')
  assert.deepEqual(executed, ['malformed-input', 'unauthorized-give'],
    'executor thật phải được gọi tuần tự cho từng case')
})
