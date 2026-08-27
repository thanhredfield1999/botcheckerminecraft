import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildLivingNpcTelemetryReportFromFile, buildLivingNpcTelemetryReportFromString } from '../src/livingnpc-report.js'
import { parseLivingNpcTelemetryFile, type LivingNpcTelemetrySnapshot } from '../src/livingnpc-telemetry.js'
import {
  renderLivingNpcPixelMapHtml,
  writeLivingNpcPixelMapHtmlFromFile,
  writeLivingNpcPixelMapHtmlFile
} from '../src/livingnpc-pixel-map.js'

const fixturePath = path.resolve('test/fixtures/livingnpc-telemetry-snapshot.json')

test('pixel map render snapshot fixture có map, probes, NPC, target, semantic points, issues và timeline', async () => {
  const snapshot = await parseLivingNpcTelemetryFile(fixturePath)
  const report = await buildLivingNpcTelemetryReportFromFile(fixturePath, {
    expectedRolesByNpcId: { '46a5553d-cedc-428f-b51a-4f5ddec03c9b': 'rancher' },
    runId: 'pixel-map-fixture'
  })

  const html = renderLivingNpcPixelMapHtml(report, { snapshot, title: 'LivingNPC Pixel Map' })

  assert.match(html, /^<!doctype html>/)
  assert.match(html, /<svg[^>]+data-testid="pixel-map"/)
  assert.match(html, /data-kind="probe-passable"/)
  assert.match(html, /data-kind="probe-obstacle"/)
  assert.match(html, /data-kind="npc"/)
  assert.match(html, /Steve/)
  assert.match(html, /farmer/)
  assert.match(html, /GOING_TO_PLOT/)
  assert.match(html, /data-kind="target"/)
  assert.match(html, /target precise 60\.5,-60,-0\.5/)
  assert.match(html, /data-kind="semantic"/)
  assert.match(html, /bed/)
  assert.match(html, /Chú giải/)
  assert.match(html, /LIVINGNPC_STUCK_PATH_ABSENT|ended STUCK with path absent/)
  assert.match(html, /Timeline/)
  assert.match(html, /NAVIGATION_END/)
})

test('Observatory render snapshot cũ có panel unavailable rõ ràng, không render số giả', async () => {
  const snapshot = await parseLivingNpcTelemetryFile(fixturePath)

  const html = renderLivingNpcPixelMapHtml(snapshot, { title: 'LivingNPC Observatory' })

  assert.match(html, /LivingNPC Observatory/)
  assert.match(html, /NPC Observatory/)
  assert.match(html, /NPC cards/)
  assert.match(html, /Chưa có telemetry economy/)
  assert.match(html, /Missing producer: LivingNPC NpcTelemetrySnapshot\.economy/)
  assert.match(html, /Chưa có telemetry visitors/)
  assert.match(html, /Missing producer: LivingNPC NpcTelemetrySnapshot\.visitors/)
  assert.match(html, /Chưa có bounded house-scan producer/)
  assert.doesNotMatch(html, /Village balance<\/strong>: 0/)
})

test('Observatory render optional economy visitors structures khi có telemetry thật', async () => {
  const snapshot = await parseLivingNpcTelemetryFile(fixturePath)
  const enriched: LivingNpcTelemetrySnapshot = {
    ...snapshot,
    economy: {
      schemaVersion: 1,
      villageId: 'stillcliff',
      currencyUnit: 'minor',
      balanceMinor: 1250,
      timestampMillis: 1710000000000,
      activities: [{
        npcId: '46a5553d-cedc-428f-b51a-4f5ddec03c9b',
        npcName: 'Steve',
        role: 'farmer',
        action: 'Thu hoạch',
        itemKey: 'wheat',
        amount: 3,
        createdAt: '2026-08-18T00:00:00.000Z'
      }],
      inventory: [{ itemKey: 'wheat', quantity: 12 }]
    },
    visitors: {
      schemaVersion: 1,
      villageId: 'stillcliff',
      enabled: true,
      activeCount: 1,
      maxActive: 4,
      visitors: [{
        visitId: 'visitor:one',
        uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        name: 'Aldous',
        phase: 'SHOPPING',
        walletMinor: 500,
        target: snapshot.events[0]!.targetBlock,
        demand: [{ itemKey: 'wheat', quantity: 2 }],
        purchase: { spentMinor: 200, remainingMinor: 300, items: [{ itemKey: 'wheat', quantity: 2 }] }
      }]
    },
    structures: {
      schemaVersion: 1,
      villageId: 'stillcliff',
      status: 'bounded-scan-complete',
      structures: [{
        id: 'house-1',
        type: 'house',
        bounds: { world: 'StillCliff', minX: 1, minY: 60, minZ: 2, maxX: 5, maxY: 66, maxZ: 8 },
        beds: 2,
        workstations: 1,
        doors: 1,
        occupancy: 1,
        scanStatus: 'complete'
      }]
    }
  }

  const html = renderLivingNpcPixelMapHtml(enriched)

  assert.match(html, /Village balance<\/strong>: 1250 minor/)
  assert.match(html, /Thu hoạch/)
  assert.match(html, /wheat × 3/)
  assert.match(html, /Visitors active<\/strong>: 1\/4/)
  assert.match(html, /Aldous/)
  assert.match(html, /spent 200/)
  assert.match(html, /house-1/)
  assert.match(html, /bounds StillCliff 1,60,2 → 5,66,8/)
})

test('Observatory escape optional panel content an toàn', async () => {
  const snapshot = await parseLivingNpcTelemetryFile(fixturePath)
  const enriched: LivingNpcTelemetrySnapshot = {
    ...snapshot,
    economy: {
      schemaVersion: 1,
      activities: [{ role: 'farmer<script>alert(1)</script>', action: '<img src=x onerror=alert(2)>', itemKey: 'wheat&seed', amount: 1 }]
    },
    visitors: {
      schemaVersion: 1,
      visitors: [{ visitId: 'visitor:<bad>', name: '<script>alert(3)</script>', phase: 'SHOPPING' }]
    },
    structures: {
      schemaVersion: 1,
      structures: [{ id: '<img src=x onerror=alert(4)>', bounds: { world: 'StillCliff', minX: 1, minY: 60, minZ: 2, maxX: 5, maxY: 66, maxZ: 8 } }]
    }
  }

  const html = renderLivingNpcPixelMapHtml(enriched)

  assert.doesNotMatch(html, /<script>alert/)
  assert.doesNotMatch(html, /<img src=x/)
  assert.doesNotMatch(html, /<[^>]+\sonerror=/)
  assert.match(html, /&lt;img src=x onerror=alert\(2\)&gt;/)
  assert.match(html, /wheat&amp;seed/)
})

test('pixel map escape HTML/JS an toàn, không chèn raw payload tên/issue', async () => {
  const source = JSON.parse(await readFile(fixturePath, 'utf8')) as LivingNpcTelemetrySnapshot
  source.events = [source.events[0]!]
  source.totalRecorded = 1
  source.events[0] = {
    ...source.events[0]!,
    name: '<img src=x onerror=alert(1)>',
    role: 'farmer<script>alert(2)</script>',
    state: 'GOING & "SAFE"',
    phase: "PHASE 'quoted'"
  }
  const report = buildLivingNpcTelemetryReportFromString(JSON.stringify(source), {
    expectedRolesByName: { '<img src=x onerror=alert(1)>': 'rancher' }
  })

  const html = renderLivingNpcPixelMapHtml(report, { snapshot: source })

  assert.doesNotMatch(html, /<img src=x/)
  assert.doesNotMatch(html, /<script>alert/)
  assert.doesNotMatch(html, /<[^>]+\sonerror=/)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.match(html, /farmer&lt;script&gt;alert\(2\)&lt;\/script&gt;/)
  assert.match(html, /GOING &amp; &quot;SAFE&quot;/)
})

test('pixel map giới hạn viewport, clip theo max dimension hoặc throw rõ khi cấu hình yêu cầu', async () => {
  const snapshot = await parseLivingNpcTelemetryFile(fixturePath)

  const clipped = renderLivingNpcPixelMapHtml(snapshot, { maxWidthBlocks: 2, maxDepthBlocks: 2, overflow: 'clip' })
  assert.match(clipped, /Viewport clipped/)
  assert.match(clipped, /2 × 2 blocks/)

  assert.throws(
    () => renderLivingNpcPixelMapHtml(snapshot, { maxWidthBlocks: 2, maxDepthBlocks: 2, overflow: 'throw' }),
    /LivingNPC pixel map viewport exceeds bounds/
  )
})

test('pixel map render empty snapshot thành HTML bounded không crash', () => {
  const snapshot: LivingNpcTelemetrySnapshot = { schemaVersion: 1, capacity: 1, totalRecorded: 0, events: [] }

  const html = renderLivingNpcPixelMapHtml(snapshot)

  assert.match(html, /No LivingNPC telemetry events/)
  assert.match(html, /0 × 0 blocks/)
  assert.match(html, /data-testid="pixel-map"/)
})

test('pixel map write file helper ghi HTML tự chứa', async t => {
  const snapshot = await parseLivingNpcTelemetryFile(fixturePath)
  const dir = await mkdtemp(path.join(os.tmpdir(), 'livingnpc-pixel-map-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const output = path.join(dir, 'map.html')

  await writeLivingNpcPixelMapHtmlFile(output, snapshot, { title: 'Exported Map' })

  const html = await readFile(output, 'utf8')
  assert.match(html, /Exported Map/)
  assert.match(html, /data-testid="pixel-map"/)
})

test('pixel map read-file helper tự nhận diện snapshot hoặc report JSON rồi ghi HTML', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'livingnpc-pixel-map-file-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const snapshotOutput = path.join(dir, 'snapshot.html')
  const reportOutput = path.join(dir, 'report.html')
  const reportInput = path.join(dir, 'report.json')
  const report = await buildLivingNpcTelemetryReportFromFile(fixturePath, { runId: 'pixel-map-report-file' })
  await writeFile(reportInput, JSON.stringify(report), 'utf8')

  await writeLivingNpcPixelMapHtmlFromFile(fixturePath, snapshotOutput, { title: 'Snapshot File' })
  await writeLivingNpcPixelMapHtmlFromFile(reportInput, reportOutput, { title: 'Report File' })

  assert.match(await readFile(snapshotOutput, 'utf8'), /Snapshot File/)
  const reportHtml = await readFile(reportOutput, 'utf8')
  assert.match(reportHtml, /Report File/)
  assert.match(reportHtml, /Timeline/)
  assert.match(reportHtml, /data-kind="npc"/)
})
