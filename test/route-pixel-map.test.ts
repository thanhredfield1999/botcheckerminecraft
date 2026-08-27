import assert from 'node:assert/strict'
import test from 'node:test'
import { renderRoutePixelMapHtml } from '../src/route-pixel-map.js'

test('route pixel map vẽ A-B-C, fence, gate, trajectory và issue', () => {
  const html = renderRoutePixelMapHtml({
    checkpoints: [
      { id: 'A', position: { x: 0, y: 64, z: 0 }, radius: 1 },
      { id: 'B', position: { x: 3, y: 64, z: 0 }, radius: 1 },
      { id: 'C', position: { x: 3, y: 64, z: 4 }, radius: 1 }
    ],
    fences: [{ x: 1, y: 64, z: 1 }, { x: 2, y: 64, z: 2 }],
    gates: [{ id: 'gate-b', block: { x: 3, y: 64, z: 0 }, open: true }],
    samples: [
      { position: { x: 0, y: 64, z: 0 }, elapsedMs: 0, checkpoint: 'A' },
      { position: { x: 3, y: 64, z: 0 }, elapsedMs: 100, checkpoint: 'B', segmentIndex: 0 },
      { position: { x: 3, y: 64, z: 4 }, elapsedMs: 200, checkpoint: 'C', segmentIndex: 1, issue: 'backtrack' }
    ],
    verdict: 'FAIL'
  })
  assert.match(html, /data-testid="route-pixel-map"/)
  assert.match(html, /data-kind="checkpoint" data-id="A"/)
  assert.match(html, /data-kind="checkpoint" data-id="B"/)
  assert.match(html, /data-kind="checkpoint" data-id="C"/)
  assert.match(html, /data-kind="fence"/)
  assert.match(html, /data-kind="gate-open"/)
  assert.match(html, /data-kind="trajectory-segment" data-issue="backtrack"/)
  assert.match(html, /stroke="#22c55e"/)
  assert.match(html, /Verdict: <strong>FAIL<\/strong>/)
})

test('route pixel map từ chối sample không hữu hạn', () => {
  assert.throws(() => renderRoutePixelMapHtml({
    checkpoints: [{ id: 'A', position: { x: 0, y: 64, z: 0 }, radius: 1 }],
    fences: [], samples: [{ position: { x: Number.NaN, y: 64, z: 0 }, elapsedMs: 0 }]
  }), /sample invalid/)
})

 test('route pixel map escape label an toàn', () => {
  const html = renderRoutePixelMapHtml({
    title: '<script>alert(1)</script>',
    checkpoints: [{ id: '<bad>', position: { x: 0, y: 64, z: 0 }, radius: 1 }],
    fences: [], samples: []
  })
  assert.doesNotMatch(html, /<script>alert/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
})
