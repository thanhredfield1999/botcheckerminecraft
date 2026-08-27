import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type {
  BlockCoordinate,
  LivingNpcObserverEventData,
  LivingNpcObserverSemanticPoint,
  LivingNpcTelemetryBlockProbe,
  LivingNpcTelemetryEvent,
  LivingNpcTelemetrySnapshot,
  PreciseCoordinate
} from './livingnpc-telemetry.js'
import type { TestReport, TimelineEvent } from './types.js'

export const OBSERVATORY_ICON_IDS = Object.freeze({
  economy: 29,
  house: 16,
  chest: 6,
  village: 140,
  visitor: 172,
  npcRole: 19
})

export interface LivingNpcPixelMapRenderOptions {
  title?: string
  marginBlocks?: number
  maxWidthBlocks?: number
  maxDepthBlocks?: number
  cellPixels?: number
  overflow?: 'clip' | 'throw'
  snapshot?: LivingNpcTelemetrySnapshot
  nowMillis?: number
}

interface MapEvent {
  index: number
  type: string
  summary: string
  name: string
  role: string
  world: string
  state: string
  phase: string
  npcBlock: BlockCoordinate | null
  npcPrecise: PreciseCoordinate | null
  targetBlock: BlockCoordinate | null
  targetPrecise: PreciseCoordinate | null
  blockProbes: LivingNpcTelemetryBlockProbe[]
  obstacle: LivingNpcTelemetryBlockProbe | null
  semanticPoint: LivingNpcObserverSemanticPoint | null
  timestampTick: number | null
  elapsedMs: number | null
}

interface Viewport {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  width: number
  depth: number
  clipped: boolean
  originalWidth: number
  originalDepth: number
}

interface MapMarker {
  kind: 'npc' | 'target' | 'semantic' | 'probe-passable' | 'probe-solid' | 'probe-door' | 'probe-fence-gate' | 'probe-fence' | 'probe-obstacle'
  x: number
  z: number
  label: string
  title: string
  color: string
  event: MapEvent
}

type TelemetryEconomy = NonNullable<LivingNpcTelemetrySnapshot['economy']>
type TelemetryVisitors = NonNullable<LivingNpcTelemetrySnapshot['visitors']>
type TelemetryStructures = NonNullable<LivingNpcTelemetrySnapshot['structures']>
type TelemetryHouseScan = NonNullable<LivingNpcTelemetrySnapshot['houseScan']>
type TelemetryStructure = NonNullable<TelemetryStructures['structures']>[number]

const DEFAULT_MARGIN_BLOCKS = 2
const DEFAULT_MAX_WIDTH_BLOCKS = 96
const DEFAULT_MAX_DEPTH_BLOCKS = 96
const DEFAULT_CELL_PIXELS = 18
const MAX_CELL_PIXELS = 48
const MIN_CELL_PIXELS = 8

const markerColors: Record<MapMarker['kind'], string> = {
  'probe-passable': '#d8f5d0',
  'probe-solid': '#9ca3af',
  'probe-door': '#f59e0b',
  'probe-fence-gate': '#a16207',
  'probe-fence': '#78350f',
  'probe-obstacle': '#ef4444',
  npc: '#2563eb',
  target: '#7c3aed',
  semantic: '#059669'
}

export function renderLivingNpcPixelMapHtml(
  input: LivingNpcTelemetrySnapshot | TestReport,
  options: LivingNpcPixelMapRenderOptions = {}
): string {
  const snapshot = isSnapshot(input) ? input : options.snapshot
  const report = isSnapshot(input) ? null : input
  const events = snapshot ? eventsFromSnapshot(snapshot) : eventsFromReport(report)
  const issues = report?.issues ?? []
  const timeline = report?.timeline ?? events.map(event => ({
    elapsedMs: event.elapsedMs ?? 0,
    type: event.type,
    summary: event.summary
  }))
  const viewport = computeViewport(events, options)
  const markers = collectMarkers(events).filter(marker => inViewport(marker, viewport))
  const title = options.title ?? 'LivingNPC Observatory'
  const svg = renderSvg(viewport, markers, options)
  const worlds = [...new Set(events.map(event => event.world).filter(Boolean))].sort()
  const latest = events.at(-1)
  const latestTick = latest?.timestampTick == null ? 'unknown' : String(latest.timestampTick)
  const latestMillis = latestFromSnapshot(snapshot)
  const updateAge = latestMillis == null ? 'unknown' : `${Math.max(0, (options.nowMillis ?? latestMillis) - latestMillis)}ms`
  const context = events.length === 0
    ? '<p class="empty">No LivingNPC telemetry events. Spawn NPC in correct server/world first.</p>'
    : `<p class="meta"><strong>World:</strong> ${escapeHtml(worlds.join(', ') || 'unknown')} · <strong>Latest NPC:</strong> ${escapeHtml(latest?.name ?? 'unknown')} (${escapeHtml(latest?.role ?? 'unknown')}) · <strong>Position:</strong> ${formatCoordinate(latest?.npcBlock)}</p>`
  const empty = events.length === 0 ? '<p class="empty">No LivingNPC telemetry events.</p>' : ''
  const clipped = viewport.clipped
    ? `<p class="warning">Viewport clipped: original ${viewport.originalWidth} × ${viewport.originalDepth} blocks, rendered ${viewport.width} × ${viewport.depth} blocks.</p>`
    : ''

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: light dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
body { margin: 0; padding: 24px; background: #0f172a; color: #e5e7eb; }
h1 { margin: 0 0 12px; font-size: 24px; }
main { display: grid; grid-template-columns: minmax(0, 1fr) 390px; gap: 18px; align-items: start; }
section { background: #111827; border: 1px solid #334155; border-radius: 12px; padding: 16px; }
svg { max-width: 100%; height: auto; background: #020617; border-radius: 8px; }
.grid-line { stroke: #1f2937; stroke-width: 1; }
.axis-label { fill: #94a3b8; font-size: 10px; }
.marker-label { fill: #f8fafc; font-size: 10px; paint-order: stroke; stroke: #020617; stroke-width: 3px; stroke-linejoin: round; }
.cards, .mini-grid { display: grid; gap: 10px; }
.card { border: 1px solid #334155; border-radius: 10px; padding: 10px; background: #0b1220; }
.panel-icon { width: 32px; height: 32px; image-rendering: pixelated; vertical-align: middle; margin-right: 8px; }
.kv { display: grid; grid-template-columns: 120px 1fr; gap: 4px 8px; margin-top: 6px; }
.kv dt { color: #94a3b8; }
.kv dd { margin: 0; overflow-wrap: anywhere; }
.legend { display: grid; gap: 6px; margin: 0; }
.legend div { display: flex; gap: 8px; align-items: center; }
.swatch { width: 14px; height: 14px; border-radius: 3px; border: 1px solid #cbd5e1; display: inline-block; }
ol, ul { padding-left: 20px; }
li { margin: 6px 0; }
.meta, .warning, .empty { color: #cbd5e1; }
.warning { color: #fbbf24; font-weight: 600; }
code { color: #bae6fd; }
@media (max-width: 980px) { main { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p class="meta"><strong>Server/world:</strong> ${escapeHtml(worlds.join(', ') || 'unknown')} · <strong>Source events:</strong> ${events.length}/${escapeHtml(String(snapshot?.totalRecorded ?? events.length))} · <strong>Latest tick:</strong> ${escapeHtml(latestTick)} · <strong>Update age:</strong> ${escapeHtml(updateAge)}</p>
<p class="meta">Viewport ${viewport.width} × ${viewport.depth} blocks, X ${viewport.minX}..${viewport.maxX}, Z ${viewport.minZ}..${viewport.maxZ}.</p>
${context}
${empty}
${clipped}
<main>
<section aria-label="NPC Observatory">
<h2>${panelIcon('npcRole', 'NPC role')}</h2>
${renderNpcCards(events)}
<h2>Pixel map</h2>
${svg}
</section>
<aside>
<section>
<h2>${panelIcon('economy', 'Economy')}</h2>
${renderEconomy(snapshot?.economy)}
</section>
<section>
<h2>${panelIcon('visitor', 'Visitors')}</h2>
${renderVisitors(snapshot?.visitors)}
</section>
<section>
<h2>${panelIcon('house', 'House / structures')}</h2>
${renderStructures(snapshot?.structures, snapshot?.houseScan)}
</section>
<section>
<h2>${panelIcon('village', 'Village')} Chú giải</h2>
${renderLegend()}
</section>
<section>
<h2>Evidence / Issues</h2>
${renderIssues(issues)}
</section>
<section>
<h2>${panelIcon('chest', 'Chest / storage')} Timeline</h2>
${renderTimeline(timeline)}
</section>
</aside>
</main>
</body>
</html>
`
}

export async function writeLivingNpcPixelMapHtmlFile(
  file: string,
  input: LivingNpcTelemetrySnapshot | TestReport,
  options: LivingNpcPixelMapRenderOptions = {}
): Promise<void> {
  const html = renderLivingNpcPixelMapHtml(input, options)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, html, 'utf8')
}

export async function writeLivingNpcPixelMapHtmlFromFile(
  inputFile: string,
  outputFile: string,
  options: LivingNpcPixelMapRenderOptions = {}
): Promise<void> {
  const input = parsePixelMapInput(await readFile(inputFile, 'utf8'))
  await writeLivingNpcPixelMapHtmlFile(outputFile, input, options)
}

export function parseLivingNpcPixelMapInput(payload: string): LivingNpcTelemetrySnapshot | TestReport {
  return parsePixelMapInput(payload)
}

function eventsFromSnapshot(snapshot: LivingNpcTelemetrySnapshot): MapEvent[] {
  return snapshot.events.map((event, index) => ({
    index,
    type: event.type,
    summary: `${event.name} ${event.role} ${event.state} path=${event.path ?? event.navigation?.path ?? 'unknown'}`,
    name: event.name,
    role: event.role,
    world: event.world,
    state: event.state,
    phase: event.phase,
    npcBlock: blockCoordinate(event.npcBlock),
    npcPrecise: preciseCoordinate(event.npcPrecise ?? event.npcBlock),
    targetBlock: blockCoordinate(event.targetBlock),
    targetPrecise: preciseCoordinate(event.targetPrecise ?? event.targetBlock),
    blockProbes: event.blockProbes,
    obstacle: event.obstacle,
    semanticPoint: semanticPoint(event.semanticPoint),
    timestampTick: event.timestampTick,
    elapsedMs: index === 0 ? 0 : Math.max(0, event.timestampMillis - snapshot.events[0]!.timestampMillis)
  }))
}

function parsePixelMapInput(payload: string): LivingNpcTelemetrySnapshot | TestReport {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid LivingNPC pixel map JSON: ${message}`)
  }
  if (isSnapshotLike(parsed)) return parsed
  if (isReportLike(parsed)) return parsed
  throw new Error('Invalid LivingNPC pixel map input: expected telemetry snapshot or LivingNpcTelemetryTestReport')
}

function isSnapshotLike(input: unknown): input is LivingNpcTelemetrySnapshot {
  if (!input || typeof input !== 'object') return false
  const candidate = input as Partial<LivingNpcTelemetrySnapshot>
  return candidate.schemaVersion === 1 && Array.isArray(candidate.events)
}

function isReportLike(input: unknown): input is TestReport {
  if (!input || typeof input !== 'object') return false
  const candidate = input as Partial<TestReport>
  return typeof candidate.runId === 'string' && Array.isArray(candidate.timeline) && Array.isArray(candidate.issues)
}

function eventsFromReport(report: TestReport | null): MapEvent[] {
  if (!report) return []
  return report.timeline.map((event, index) => {
    const data = livingNpcObserverData(event.data)
    return {
      index,
      type: event.type,
      summary: event.summary,
      name: data?.npc.name ?? 'unknown',
      role: data?.npc.role ?? 'unknown',
      world: data?.npc.world ?? data?.position.block?.world ?? 'unknown',
      state: data?.state.state ?? 'unknown',
      phase: data?.state.phase ?? 'unknown',
      npcBlock: data?.position.block ?? null,
      npcPrecise: data?.position.precise ?? null,
      targetBlock: data?.position.targetBlock ?? null,
      targetPrecise: data?.position.targetPrecise ?? null,
      blockProbes: data?.blockProbes ?? [],
      obstacle: data?.obstacle ?? null,
      semanticPoint: data?.semanticPoint ?? null,
      timestampTick: data?.timestampTick ?? null,
      elapsedMs: event.elapsedMs
    }
  })
}

function computeViewport(events: MapEvent[], options: LivingNpcPixelMapRenderOptions): Viewport {
  const margin = nonNegativeInteger(options.marginBlocks ?? DEFAULT_MARGIN_BLOCKS, 'marginBlocks')
  const maxWidth = positiveInteger(options.maxWidthBlocks ?? DEFAULT_MAX_WIDTH_BLOCKS, 'maxWidthBlocks')
  const maxDepth = positiveInteger(options.maxDepthBlocks ?? DEFAULT_MAX_DEPTH_BLOCKS, 'maxDepthBlocks')
  const coordinates = collectCoordinates(events)
  if (coordinates.length === 0) {
    return { minX: 0, maxX: -1, minZ: 0, maxZ: -1, width: 0, depth: 0, clipped: false, originalWidth: 0, originalDepth: 0 }
  }

  let minX = Math.min(...coordinates.map(coordinate => coordinate.x)) - margin
  let maxX = Math.max(...coordinates.map(coordinate => coordinate.x)) + margin
  let minZ = Math.min(...coordinates.map(coordinate => coordinate.z)) - margin
  let maxZ = Math.max(...coordinates.map(coordinate => coordinate.z)) + margin
  const originalWidth = maxX - minX + 1
  const originalDepth = maxZ - minZ + 1
  const exceeds = originalWidth > maxWidth || originalDepth > maxDepth
  if (exceeds && (options.overflow ?? 'clip') === 'throw') {
    throw new Error(`LivingNPC pixel map viewport exceeds bounds: ${originalWidth} × ${originalDepth} blocks > ${maxWidth} × ${maxDepth}`)
  }
  if (originalWidth > maxWidth) maxX = minX + maxWidth - 1
  if (originalDepth > maxDepth) maxZ = minZ + maxDepth - 1
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    width: Math.max(0, maxX - minX + 1),
    depth: Math.max(0, maxZ - minZ + 1),
    clipped: exceeds,
    originalWidth,
    originalDepth
  }
}

function collectCoordinates(events: MapEvent[]): Array<{ x: number; z: number }> {
  const coordinates: Array<{ x: number; z: number }> = []
  for (const event of events) {
    pushBlock(coordinates, event.npcBlock)
    pushBlock(coordinates, event.targetBlock)
    if (event.semanticPoint?.position) coordinates.push({ x: Math.floor(event.semanticPoint.position.x), z: Math.floor(event.semanticPoint.position.z) })
    for (const probe of event.blockProbes) coordinates.push({ x: probe.x, z: probe.z })
    if (event.obstacle) coordinates.push({ x: event.obstacle.x, z: event.obstacle.z })
  }
  return coordinates
}

function collectMarkers(events: MapEvent[]): MapMarker[] {
  const markers: MapMarker[] = []
  for (const event of events) {
    for (const probe of event.blockProbes) {
      const kind = probeKind(probe)
      markers.push({
        kind,
        x: probe.x,
        z: probe.z,
        label: probe.relation,
        title: `${probe.relation} ${probe.material} (${probe.x},${probe.y},${probe.z}) solid=${probe.solid} passable=${probe.passable}`,
        color: markerColors[kind],
        event
      })
    }
    if (event.obstacle && !event.blockProbes.some(probe => sameProbe(probe, event.obstacle!))) {
      markers.push({
        kind: 'probe-obstacle',
        x: event.obstacle.x,
        z: event.obstacle.z,
        label: event.obstacle.relation,
        title: `${event.obstacle.relation} ${event.obstacle.material} (${event.obstacle.x},${event.obstacle.y},${event.obstacle.z}) obstacle=true`,
        color: markerColors['probe-obstacle'],
        event
      })
    }
    if (event.targetBlock) {
      markers.push({
        kind: 'target',
        x: event.targetBlock.x,
        z: event.targetBlock.z,
        label: 'T',
        title: `${event.name} target block ${event.targetBlock.x},${event.targetBlock.y},${event.targetBlock.z}${event.targetPrecise ? `; target precise ${formatPrecise(event.targetPrecise)}` : ''}`,
        color: markerColors.target,
        event
      })
    }
    if (event.semanticPoint?.position) {
      markers.push({
        kind: 'semantic',
        x: Math.floor(event.semanticPoint.position.x),
        z: Math.floor(event.semanticPoint.position.z),
        label: semanticShortLabel(event.semanticPoint),
        title: `${event.semanticPoint.type} ${event.semanticPoint.name} ${formatPrecise(event.semanticPoint.position)}`,
        color: markerColors.semantic,
        event
      })
    }
    if (event.npcBlock) {
      markers.push({
        kind: 'npc',
        x: event.npcBlock.x,
        z: event.npcBlock.z,
        label: event.name.slice(0, 2),
        title: `${event.name} role=${event.role} state=${event.state} phase=${event.phase} block ${event.npcBlock.x},${event.npcBlock.y},${event.npcBlock.z}`,
        color: markerColors.npc,
        event
      })
    }
  }
  return markers
}

function renderSvg(viewport: Viewport, markers: MapMarker[], options: LivingNpcPixelMapRenderOptions): string {
  const cell = Math.min(MAX_CELL_PIXELS, Math.max(MIN_CELL_PIXELS, positiveInteger(options.cellPixels ?? DEFAULT_CELL_PIXELS, 'cellPixels')))
  const labelPad = 32
  const width = Math.max(1, viewport.width * cell + labelPad)
  const height = Math.max(1, viewport.depth * cell + labelPad)
  const lines: string[] = [
    `<svg data-testid="pixel-map" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="LivingNPC pixel map" viewBox="0 0 ${width} ${height}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#020617"/>`
  ]
  for (let x = 0; x <= viewport.width; x += 1) {
    const px = labelPad + x * cell
    lines.push(`<line class="grid-line" x1="${px}" y1="${labelPad}" x2="${px}" y2="${labelPad + viewport.depth * cell}"/>`)
  }
  for (let z = 0; z <= viewport.depth; z += 1) {
    const py = labelPad + z * cell
    lines.push(`<line class="grid-line" x1="${labelPad}" y1="${py}" x2="${labelPad + viewport.width * cell}" y2="${py}"/>`)
  }
  if (viewport.width > 0 && viewport.depth > 0) {
    lines.push(`<text class="axis-label" x="${labelPad}" y="16">X ${viewport.minX}..${viewport.maxX}</text>`)
    lines.push(`<text class="axis-label" x="4" y="${labelPad + 12}">Z ${viewport.minZ}</text>`)
  }
  for (const marker of markers) {
    const px = labelPad + (marker.x - viewport.minX) * cell
    const py = labelPad + (marker.z - viewport.minZ) * cell
    lines.push(`<rect class="marker marker-${escapeAttribute(marker.kind)}" data-kind="${escapeAttribute(marker.kind)}" data-npc="${dataValue(marker.event.name)}" data-role="${dataValue(marker.event.role)}" data-state="${dataValue(marker.event.state)}" data-phase="${dataValue(marker.event.phase)}" x="${px + 1}" y="${py + 1}" width="${Math.max(1, cell - 2)}" height="${Math.max(1, cell - 2)}" rx="3" fill="${marker.color}" opacity="0.9"><title>${escapeHtml(marker.title)}</title></rect>`)
    lines.push(`<text class="marker-label" x="${px + 3}" y="${py + Math.max(11, Math.floor(cell * 0.68))}">${escapeHtml(marker.label)}</text>`)
  }
  lines.push('</svg>')
  return lines.join('\n')
}

function panelIcon(icon: keyof typeof OBSERVATORY_ICON_IDS, label: string): string {
  const fileName = icon === 'npcRole' ? 'npc-role' : icon
  const file = path.resolve('assets', 'observatory-icons', `${fileName}.png`)
  if (!existsSync(file)) return escapeHtml(label)
  const data = readFileSync(file).toString('base64')
  return `<img class="panel-icon" src="data:image/png;base64,${data}" alt="${escapeAttribute(label)}">${escapeHtml(label)}`
}

function renderNpcCards(events: MapEvent[]): string {
  if (events.length === 0) return '<p class="empty">NPC cards unavailable: Chưa có telemetry NPC.</p>'
  const latestByNpc = new Map<string, MapEvent>()
  for (const event of events) latestByNpc.set(`${event.world}:${event.name}:${event.role}`, event)
  const cards = [...latestByNpc.values()].map(event => {
    const target = event.targetPrecise ?? event.targetBlock
    const blocker = event.obstacle
      ? `${event.obstacle.relation} ${event.obstacle.material} ${event.obstacle.x},${event.obstacle.y},${event.obstacle.z}`
      : 'none'
    return `<article class="card" data-npc="${dataValue(event.name)}" data-role="${dataValue(event.role)}" data-state="${dataValue(event.state)}" data-phase="${dataValue(event.phase)}">
<h3>${escapeHtml(event.name)} <small>${escapeHtml(event.role)}</small></h3>
<dl class="kv">
<dt>State/phase</dt><dd>${escapeHtml(event.state)} / ${escapeHtml(event.phase)}</dd>
<dt>Position</dt><dd>${formatCoordinate(event.npcBlock)}</dd>
<dt>Target</dt><dd>${target ? escapeHtml(formatCoordinateLike(target)) : 'unknown'}</dd>
<dt>Path</dt><dd>${escapeHtml(event.summary)}</dd>
<dt>Stuck/blocker</dt><dd>${escapeHtml(blocker)}</dd>
<dt>Semantic point</dt><dd>${event.semanticPoint ? `${escapeHtml(event.semanticPoint.type)} ${escapeHtml(event.semanticPoint.name)} ${event.semanticPoint.position ? escapeHtml(formatPrecise(event.semanticPoint.position)) : 'unknown'}` : 'unknown'}</dd>
</dl>
</article>`
  }).join('')
  return `<h3>NPC cards</h3><div class="cards">${cards}</div>`
}

function renderEconomy(economy: TelemetryEconomy | undefined): string {
  if (!economy) {
    return unavailable('Chưa có telemetry economy', 'Missing producer: LivingNPC NpcTelemetrySnapshot.economy')
  }
  const unit = economy.currencyUnit ?? 'minor'
  const balance = economy.balanceMinor == null
    ? '<p class="empty">Village balance: Không đủ dữ liệu.</p>'
    : `<p class="meta"><strong>Village balance</strong>: ${escapeHtml(String(economy.balanceMinor))} ${escapeHtml(unit)}</p>`
  const activities = economy.activities?.length
    ? `<ul>${economy.activities.map(activity => `<li>${escapeHtml(activity.npcName ?? activity.npcId ?? 'unknown')} ${escapeHtml(activity.role)} ${escapeHtml(activity.action)} ${activity.itemKey ? `${escapeHtml(activity.itemKey)} × ${escapeHtml(String(activity.amount ?? 0))}` : ''} ${activity.createdAt ? `<code>${escapeHtml(activity.createdAt)}</code>` : ''}</li>`).join('')}</ul>`
    : '<p class="empty">Activity ledger: Không đủ dữ liệu.</p>'
  const inventory = economy.inventory?.length
    ? `<p class="meta"><strong>Inventory</strong>: ${economy.inventory.map(item => `${escapeHtml(item.itemKey)} × ${escapeHtml(String(item.quantity))}`).join(', ')}</p>`
    : '<p class="empty">Production inventory: Không đủ dữ liệu.</p>'
  const timestamp = economy.timestampMillis == null ? 'unknown' : new Date(economy.timestampMillis).toISOString()
  return `${balance}<p class="meta"><strong>Timestamp</strong>: ${escapeHtml(timestamp)}</p>${inventory}<h3>Income / production / activity ledger</h3>${activities}`
}

function renderVisitors(visitors: TelemetryVisitors | undefined): string {
  if (!visitors) {
    return unavailable('Chưa có telemetry visitors', 'Missing producer: LivingNPC NpcTelemetrySnapshot.visitors')
  }
  const active = visitors.activeCount == null ? 'unknown' : String(visitors.activeCount)
  const max = visitors.maxActive == null ? 'unknown' : String(visitors.maxActive)
  const rows = visitors.visitors?.length
    ? `<ul>${visitors.visitors.map(visitor => {
        const demand = visitor.demand?.map(item => `${item.itemKey} × ${item.quantity}`).join(', ') ?? 'unknown'
        const purchase = visitor.purchase == null
          ? 'purchase unknown'
          : `spent ${visitor.purchase.spentMinor ?? 'unknown'}, remaining ${visitor.purchase.remainingMinor ?? 'unknown'}`
        return `<li><strong>${escapeHtml(visitor.name ?? visitor.uuid ?? visitor.visitId ?? 'unknown')}</strong> ${escapeHtml(visitor.phase ?? 'unknown')} wallet=${escapeHtml(String(visitor.walletMinor ?? 'unknown'))} target=${visitor.target ? escapeHtml(formatCoordinateLike(visitor.target)) : 'unknown'} demand=${escapeHtml(demand)} ${escapeHtml(purchase)}</li>`
      }).join('')}</ul>`
    : '<p class="empty">Không đủ dữ liệu visitor runtime.</p>'
  return `<p class="meta"><strong>Visitors active</strong>: ${escapeHtml(active)}/${escapeHtml(max)} · enabled=${escapeHtml(String(visitors.enabled ?? 'unknown'))}</p>${rows}`
}

function renderStructures(structures: TelemetryStructures | undefined, houseScan: TelemetryHouseScan | undefined): string {
  const rows = [
    ...(structures?.structures ?? []),
    ...(houseScan?.houses ?? [])
  ]
  if (rows.length === 0) {
    if (structures || houseScan) return '<p class="empty">House/structure telemetry present, nhưng không đủ dữ liệu bounds/scan.</p>'
    return unavailable('Chưa có bounded house-scan producer', 'Missing producer: LivingNPC NpcTelemetrySnapshot.structures hoặc houseScan')
  }
  const status = structures?.status ?? houseScan?.status ?? 'unknown'
  return `<p class="meta"><strong>Scan status</strong>: ${escapeHtml(status)}</p><ul>${rows.map(renderStructure).join('')}</ul>`
}

function renderStructure(structure: TelemetryStructure): string {
  return `<li><strong>${escapeHtml(structure.id)}</strong> ${escapeHtml(structure.type ?? 'house')} bounds ${escapeHtml(formatBounds(structure.bounds))}; beds=${escapeHtml(String(structure.beds ?? 'unknown'))}; work=${escapeHtml(String(structure.workstations ?? 'unknown'))}; doors=${escapeHtml(String(structure.doors ?? 'unknown'))}; occupancy=${escapeHtml(String(structure.occupancy ?? 'unknown'))}; scan=${escapeHtml(structure.scanStatus ?? 'unknown')}</li>`
}

function unavailable(title: string, detail: string): string {
  return `<p class="empty">${escapeHtml(title)}</p><p class="meta">${escapeHtml(detail)}</p>`
}

function latestFromSnapshot(snapshot: LivingNpcTelemetrySnapshot | undefined): number | null {
  if (!snapshot || snapshot.events.length === 0) return null
  return Math.max(...snapshot.events.map(event => event.timestampMillis))
}

function renderLegend(): string {
  const labels: Array<[MapMarker['kind'], string]> = [
    ['probe-passable', 'Block probe passable'],
    ['probe-solid', 'Block probe solid'],
    ['probe-door', 'Door'],
    ['probe-fence-gate', 'Fence gate'],
    ['probe-fence', 'Fence'],
    ['probe-obstacle', 'Obstacle'],
    ['npc', 'NPC block position'],
    ['target', 'Target block/precise'],
    ['semantic', 'Semantic point bed/seat/work/gate']
  ]
  return `<div class="legend">${labels.map(([kind, label]) => `<div><span class="swatch" style="background:${markerColors[kind]}"></span>${escapeHtml(label)}</div>`).join('')}</div>`
}

function renderIssues(issues: TestReport['issues']): string {
  if (issues.length === 0) return '<p class="meta">No evidence issues.</p>'
  return `<ul>${issues.map(issue => `<li><strong>${escapeHtml(issue.severity)}</strong> <code>${escapeHtml(issue.stepId)}</code>: ${escapeHtml(issue.message)}</li>`).join('')}</ul>`
}

function renderTimeline(timeline: Array<Pick<TimelineEvent, 'elapsedMs' | 'type' | 'summary'>>): string {
  if (timeline.length === 0) return '<p class="meta">No timeline data.</p>'
  return `<ol>${timeline.map(event => `<li><code>${escapeHtml(String(event.elapsedMs))}ms</code> <strong>${escapeHtml(event.type)}</strong><br>${escapeHtml(event.summary)}</li>`).join('')}</ol>`
}

function inViewport(marker: MapMarker, viewport: Viewport): boolean {
  return marker.x >= viewport.minX && marker.x <= viewport.maxX && marker.z >= viewport.minZ && marker.z <= viewport.maxZ
}

function probeKind(probe: LivingNpcTelemetryBlockProbe): MapMarker['kind'] {
  if (probe.obstacle) return 'probe-obstacle'
  if (probe.door) return 'probe-door'
  if (probe.fenceGate) return 'probe-fence-gate'
  if (probe.fence) return 'probe-fence'
  if (probe.solid) return 'probe-solid'
  return 'probe-passable'
}

function semanticShortLabel(point: LivingNpcObserverSemanticPoint): string {
  const normalized = `${point.type} ${point.name}`.toLowerCase()
  if (normalized.includes('bed') || normalized.includes('home')) return 'bed'
  if (normalized.includes('seat')) return 'seat'
  if (normalized.includes('work') || normalized.includes('plot')) return 'work'
  if (normalized.includes('gate')) return 'gate'
  return point.name.slice(0, 4)
}

function livingNpcObserverData(data: unknown): LivingNpcObserverEventData | null {
  if (!data || typeof data !== 'object') return null
  const candidate = data as Partial<LivingNpcObserverEventData>
  if (candidate.source !== 'livingnpc.telemetry') return null
  if (!candidate.npc || !candidate.position || !candidate.state) return null
  return candidate as LivingNpcObserverEventData
}

function blockCoordinate(position: LivingNpcTelemetryEvent['npcBlock']): BlockCoordinate | null {
  if (!position) return null
  return { world: position.world, x: position.xBlock, y: position.yBlock, z: position.zBlock }
}

function preciseCoordinate(position: LivingNpcTelemetryEvent['npcBlock']): PreciseCoordinate | null {
  if (!position) return null
  return { world: position.world, x: position.x, y: position.y, z: position.z, yaw: position.yaw, pitch: position.pitch }
}

function semanticPoint(point: LivingNpcTelemetryEvent['semanticPoint']): LivingNpcObserverSemanticPoint | null {
  if (!point) return null
  return { type: point.type, name: point.name, world: point.world, position: preciseCoordinate(point.position) }
}

function pushBlock(coordinates: Array<{ x: number; z: number }>, coordinate: BlockCoordinate | null): void {
  if (coordinate) coordinates.push({ x: coordinate.x, z: coordinate.z })
}

function sameProbe(a: LivingNpcTelemetryBlockProbe, b: LivingNpcTelemetryBlockProbe): boolean {
  return a.world === b.world && a.x === b.x && a.y === b.y && a.z === b.z && a.relation === b.relation
}

function formatCoordinate(position: BlockCoordinate | null | undefined): string {
  if (!position) return 'unknown'
  return `${escapeHtml(position.world)} ${position.x},${position.y},${position.z}`
}

function formatCoordinateLike(position: BlockCoordinate | PreciseCoordinate): string {
  return `${position.world} ${formatNumber(position.x)},${formatNumber(position.y)},${formatNumber(position.z)}`
}

function formatBounds(bounds: TelemetryStructure['bounds']): string {
  return `${bounds.world} ${bounds.minX},${bounds.minY},${bounds.minZ} → ${bounds.maxX},${bounds.maxY},${bounds.maxZ}`
}

function formatPrecise(position: PreciseCoordinate): string {
  return `${formatNumber(position.x)},${formatNumber(position.y)},${formatNumber(position.z)}`
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)))
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`)
  return value
}

function isSnapshot(input: LivingNpcTelemetrySnapshot | TestReport): input is LivingNpcTelemetrySnapshot {
  return 'events' in input
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => {
    switch (character) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case "'": return '&#39;'
      case '"': return '&quot;'
      default: return character
    }
  })
}

function escapeAttribute(value: string): string {
  return escapeHtml(value)
}

function dataValue(value: string): string {
  return escapeAttribute(encodeURIComponent(value))
}
