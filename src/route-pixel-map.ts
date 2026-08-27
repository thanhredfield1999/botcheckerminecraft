export interface RoutePixelPosition {
  x: number
  y: number
  z: number
}

export interface RoutePixelPoint {
  id: string
  position: RoutePixelPosition
  radius: number
}

export interface RoutePixelFence {
  x: number
  y: number
  z: number
}

export interface RoutePixelGate {
  id: string
  block: RoutePixelFence
  open: boolean
}

export interface RoutePixelSample {
  position: RoutePixelPosition
  elapsedMs: number
  checkpoint?: string
  segmentIndex?: number
  issue?: 'shortcut' | 'backtrack' | 'gate-order-violation' | 'discontinuity' | 'identity' | 'pairing'
}

export interface RoutePixelMapInput {
  title?: string
  checkpoints: readonly RoutePixelPoint[]
  fences: readonly RoutePixelFence[]
  gates?: readonly RoutePixelGate[]
  samples: readonly RoutePixelSample[]
  verdict?: 'PASS' | 'FAIL' | 'INCONCLUSIVE'
}

export interface RoutePixelMapOptions {
  cellPixels?: number
  marginBlocks?: number
  maxWidthBlocks?: number
  maxDepthBlocks?: number
}

const COLORS = {
  background: '#020617',
  grid: '#1e293b',
  route: '#38bdf8',
  routeAtoB: '#22c55e',
  routeBtoC: '#a78bfa',
  fence: '#92400e',
  gateOpen: '#f59e0b',
  gateClosed: '#64748b',
  checkpoint: '#f8fafc',
  issue: '#ef4444',
  text: '#e2e8f0'
} as const

export function renderRoutePixelMapHtml(input: RoutePixelMapInput, options: RoutePixelMapOptions = {}): string {
  validateInput(input)
  const viewport = viewportFor(input, options)
  const cell = clampInteger(options.cellPixels ?? 18, 8, 48)
  const pad = 44
  const width = Math.max(1, viewport.width * cell + pad)
  const height = Math.max(1, viewport.depth * cell + pad)
  const point = (position: RoutePixelPosition): [number, number] => [
    pad / 2 + (position.x - viewport.minX) * cell,
    pad / 2 + (position.z - viewport.minZ) * cell
  ]
  const lines: string[] = []
  for (let x = 0; x <= viewport.width; x++) {
    const px = pad / 2 + x * cell
    lines.push(`<line x1="${px}" y1="${pad / 2}" x2="${px}" y2="${pad / 2 + viewport.depth * cell}" stroke="${COLORS.grid}"/>`)
  }
  for (let z = 0; z <= viewport.depth; z++) {
    const py = pad / 2 + z * cell
    lines.push(`<line x1="${pad / 2}" y1="${py}" x2="${pad / 2 + viewport.width * cell}" y2="${py}" stroke="${COLORS.grid}"/>`)
  }
  for (const fence of input.fences) lines.push(cellRect(point(fence), cell, COLORS.fence, 'fence'))
  for (const gate of input.gates ?? []) lines.push(cellRect(point(gate.block), cell, gate.open ? COLORS.gateOpen : COLORS.gateClosed, `gate-${gate.open ? 'open' : 'closed'}`))
  if (input.samples.length > 1) {
    for (let index = 1; index < input.samples.length; index++) {
      const previous = point(input.samples[index - 1]!.position)
      const currentSample = input.samples[index]!
      const current = point(currentSample.position)
      const color = currentSample.issue ? COLORS.issue : segmentColor(input, currentSample)
      lines.push(`<line data-kind="trajectory-segment" data-issue="${currentSample.issue ?? ''}" x1="${previous[0]}" y1="${previous[1]}" x2="${current[0]}" y2="${current[1]}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`)
    }
  }
  for (const sample of input.samples) {
    const [x, y] = point(sample.position)
    lines.push(`<circle data-kind="trajectory-sample" data-issue="${sample.issue ?? ''}" cx="${x}" cy="${y}" r="${Math.max(2, cell * 0.16)}" fill="${sample.issue ? COLORS.issue : COLORS.route}" opacity="0.75"><title>${escapeHtml(`${sample.elapsedMs}ms ${sample.checkpoint ?? ''} ${sample.issue ?? ''}`)}</title></circle>`)
  }
  for (const checkpoint of input.checkpoints) {
    const [x, y] = point(checkpoint.position)
    lines.push(`<circle data-kind="checkpoint" data-id="${escapeAttribute(checkpoint.id)}" cx="${x}" cy="${y}" r="${Math.max(5, cell * 0.32)}" fill="${COLORS.checkpoint}" stroke="${checkpoint.id === 'A' ? COLORS.routeAtoB : COLORS.routeBtoC}" stroke-width="3"><title>${escapeHtml(`${checkpoint.id} radius=${checkpoint.radius}`)}</title></circle>`)
    lines.push(`<text x="${x + 7}" y="${y - 7}" fill="${COLORS.text}" font-size="12">${escapeHtml(checkpoint.id)}</text>`)
  }
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${escapeHtml(input.title ?? 'NPC route pixel map')}</title><style>body{margin:0;padding:20px;background:#0f172a;color:${COLORS.text};font-family:system-ui}svg{max-width:100%;height:auto;background:${COLORS.background};border-radius:8px}.meta{color:#cbd5e1}.legend{display:flex;gap:16px;flex-wrap:wrap}.swatch{display:inline-block;width:12px;height:12px;margin-right:4px}</style></head><body><h1>${escapeHtml(input.title ?? 'NPC route pixel map')}</h1><p class="meta">Verdict: <strong>${escapeHtml(input.verdict ?? 'INCONCLUSIVE')}</strong> · Samples: ${input.samples.length} · Viewport: ${viewport.width}×${viewport.depth} blocks</p><div class="legend"><span><i class="swatch" style="background:${COLORS.routeAtoB}"></i>A→B</span><span><i class="swatch" style="background:${COLORS.routeBtoC}"></i>B→C</span><span><i class="swatch" style="background:${COLORS.fence}"></i>Fence</span><span><i class="swatch" style="background:${COLORS.gateOpen}"></i>Gate open</span><span><i class="swatch" style="background:${COLORS.issue}"></i>Issue</span></div><svg data-testid="route-pixel-map" role="img" aria-label="NPC route pixel map" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${COLORS.background}"/>${lines.join('')}</svg></body></html>`
}

function segmentColor(input: RoutePixelMapInput, sample: RoutePixelSample): string {
  if (sample.segmentIndex !== undefined) {
    return sample.segmentIndex <= 0 ? COLORS.routeAtoB : COLORS.routeBtoC
  }
  const checkpoint = sample.checkpoint ?? ''
  if (checkpoint === 'A' || checkpoint === 'B') return COLORS.routeAtoB
  if (checkpoint === 'C') return COLORS.routeBtoC
  const b = input.checkpoints.find(item => item.id === 'B')
  if (b && sample.position.x + sample.position.z >= b.position.x + b.position.z) return COLORS.routeBtoC
  return COLORS.route
}

function viewportFor(input: RoutePixelMapInput, options: RoutePixelMapOptions): { minX: number; maxX: number; minZ: number; maxZ: number; width: number; depth: number } {
  const positions = [...input.checkpoints.map(item => item.position), ...input.fences, ...(input.gates ?? []).map(item => item.block), ...input.samples.map(item => item.position)]
  const margin = Math.max(0, Math.floor(options.marginBlocks ?? 2))
  const xs = positions.map(item => Math.floor(item.x))
  const zs = positions.map(item => Math.floor(item.z))
  const minX = Math.min(...xs, 0) - margin
  const minZ = Math.min(...zs, 0) - margin
  const maxX = Math.max(...xs, 0) + margin
  const maxZ = Math.max(...zs, 0) + margin
  const maxWidth = clampInteger(options.maxWidthBlocks ?? 128, 1, 512)
  const maxDepth = clampInteger(options.maxDepthBlocks ?? 128, 1, 512)
  const clippedMaxX = Math.min(maxX, minX + maxWidth - 1)
  const clippedMaxZ = Math.min(maxZ, minZ + maxDepth - 1)
  return { minX, maxX: clippedMaxX, minZ, maxZ: clippedMaxZ, width: Math.max(1, clippedMaxX - minX + 1), depth: Math.max(1, clippedMaxZ - minZ + 1) }
}

function cellRect([x, y]: [number, number], cell: number, color: string, kind: string): string {
  return `<rect data-kind="${kind}" x="${x - cell / 2 + 1}" y="${y - cell / 2 + 1}" width="${Math.max(1, cell - 2)}" height="${Math.max(1, cell - 2)}" fill="${color}" opacity="0.9"/>`
}

function validateInput(input: RoutePixelMapInput): void {
  if (!input.checkpoints.length || input.checkpoints.some(item => !item.id || item.radius <= 0)) throw new Error('Route pixel map checkpoints invalid')
  if (input.samples.some(item => !Number.isFinite(item.elapsedMs) || !Number.isFinite(item.position.x) || !Number.isFinite(item.position.y) || !Number.isFinite(item.position.z))) throw new Error('Route pixel map sample invalid')
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) throw new Error('Route pixel map option invalid')
  return Math.min(max, Math.max(min, Math.round(value)))
}

function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;') }
function escapeAttribute(value: string): string { return escapeHtml(value) }
