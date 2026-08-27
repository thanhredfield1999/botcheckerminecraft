import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import {
  buildLivingNpcTelemetryReportFromFile,
  buildLivingNpcTelemetryReportFromString
} from '../src/livingnpc-report.js'
import { createServer } from '../src/server.js'

const fixturePath = path.resolve('test/fixtures/livingnpc-telemetry-snapshot.json')

test('offline report builder ingest LivingNPC telemetry file vào TestReport timeline và issues bounded', async () => {
  const report = await buildLivingNpcTelemetryReportFromFile(fixturePath, {
    expectedRolesByNpcId: { '46a5553d-cedc-428f-b51a-4f5ddec03c9b': 'rancher' },
    runId: 'livingnpc-report-fixture',
    sourceRevision: 'abc123'
  })

  assert.equal(report.runId, 'livingnpc-report-fixture')
  assert.equal(report.scenario, 'livingnpc-telemetry')
  assert.equal(report.status, 'failed')
  assert.equal(report.verdict, 'FAIL')
  assert.equal(report.manifest.schemaVersion, 1)
  assert.equal(report.manifest.runner.sourceRevision, 'abc123')
  assert.equal(report.telemetry.type, 'livingnpc-telemetry-report')
  assert.equal(report.telemetry.eventCount, 3)
  assert.match(report.telemetry.inputSha256, /^[a-f0-9]{64}$/)

  assert.equal(report.timeline.length, 3)
  assert.equal(report.timeline[0]?.type, 'livingnpc.telemetry.ACTION')
  assert.equal(report.timeline[0]?.data && typeof report.timeline[0].data, 'object')
  assert.doesNotMatch(JSON.stringify(report), /"events"\s*:\s*\[/)

  assert.deepEqual(report.issues.map(issue => issue.severity), ['medium', 'high', 'medium'])
  assert.deepEqual(report.steps.map(step => step.verdict), ['INCONCLUSIVE', 'FAIL', 'INCONCLUSIVE'])
  assert.equal(report.issues[0]?.stepId, 'livingnpc.telemetry.event.0')
  assert.match(report.issues[0]?.message ?? '', /role mismatch/)
  assert.equal(report.issues[1]?.severity, 'high')
  assert.equal(report.issues[1]?.stepId, 'livingnpc.telemetry.event.2')
  assert.match(report.issues[1]?.message ?? '', /ended STUCK with path absent/)
  assert.equal(report.issues[2]?.severity, 'medium')
  assert.equal(report.issues[2]?.stepId, 'livingnpc.telemetry.semantic-target.0-2')
  assert.match(report.issues[2]?.message ?? '', /semantic target shared/)
  const source = JSON.parse(await readFile(fixturePath, 'utf8')) as {
    events: Array<{ timestampMillis: number }>
  }
  assert.equal(report.steps[0]?.startedAt, new Date(source.events[0]!.timestampMillis).toISOString())
  assert.equal(report.steps[1]?.startedAt, new Date(source.events[2]!.timestampMillis).toISOString())
  assert.equal(report.steps[2]?.startedAt, new Date(Math.min(
    source.events[0]!.timestampMillis,
    source.events[2]!.timestampMillis
  )).toISOString())
})

test('offline report builder giữ collision/role mismatch ở medium INCONCLUSIVE khi không có STUCK', async () => {
  const source = JSON.parse(await readFile(fixturePath, 'utf8')) as { events: unknown[]; totalRecorded: number }
  source.events = [source.events[0], source.events[1]]
  source.totalRecorded = source.events.length

  const report = buildLivingNpcTelemetryReportFromString(JSON.stringify(source), {
    expectedRolesByName: { Steve: 'rancher' }
  })

  assert.equal(report.status, 'failed')
  assert.equal(report.verdict, 'INCONCLUSIVE')
  assert.deepEqual(report.issues.map(issue => issue.severity), ['medium'])
  assert.deepEqual(report.steps.map(step => step.verdict), ['INCONCLUSIVE'])
})

test('offline report builder không tự kết luận role mismatch khi thiếu metadata đối chiếu', async () => {
  const report = await buildLivingNpcTelemetryReportFromFile(fixturePath)

  assert.equal(report.issues.some(issue => issue.message.includes('role mismatch')), false)
  assert.deepEqual(report.issues.map(issue => issue.severity), ['high', 'medium'])
  assert.deepEqual(report.steps.map(step => step.verdict), ['FAIL', 'INCONCLUSIVE'])
})

test('offline report builder áp dụng giới hạn bytes/events/probes và không giữ payload thô', async () => {
  const payload = await readFile(fixturePath, 'utf8')

  assert.throws(
    () => buildLivingNpcTelemetryReportFromString(payload, { maxBytes: 32 }),
    /payload too large/
  )
  assert.throws(
    () => buildLivingNpcTelemetryReportFromString(payload, { maxEvents: 2 }),
    /Invalid LivingNPC telemetry snapshot/
  )

  const report = buildLivingNpcTelemetryReportFromString(payload)
  assert.doesNotMatch(JSON.stringify(report), new RegExp(payload.slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('server hiện không có route ingest telemetry nên integration giữ offline builder', async t => {
  const app = createServer({ logger: false })
  t.after(() => app.close())

  const response = await app.inject({ method: 'GET', url: '/api/livingnpc/telemetry/report' })

  assert.equal(response.statusCode, 404)
})
