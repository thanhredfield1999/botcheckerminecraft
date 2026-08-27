import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { RouteOracle } from '../src/route-oracle.ts'
import { loadScenario } from '../src/scenario.ts'
import { parseLivingNpcTelemetryFile, telemetryToTimelineEvents } from '../src/livingnpc-telemetry.ts'

const scenarioName = 'livingnpc-farmer-pathfinding-readonly'
const scenarioFile = path.resolve('scenarios', `${scenarioName}.json`)
const telemetryFile = path.resolve('test/fixtures/livingnpc-telemetry-snapshot.json')
const outputFile = path.resolve('reports/local-farmer-pathfinding-capability.json')
const scenario = await loadScenario(path.resolve('scenarios'), scenarioName)
const step = scenario.steps[0]
if (step.action !== 'observe_route') throw new Error('Expected observe_route scenario')

const oracle = new RouteOracle(step.checkpoints, step.gates.map(gate => ({
  checkpointId: gate.checkpointId,
  block: gate.block,
  approach: gate.approach,
  exit: gate.exit,
  crossing: {
    entryClearance: gate.entryClearance,
    exitClearance: gate.exitClearance,
    verticalTolerance: gate.verticalTolerance,
    requiredExitSamples: gate.requiredExitSamples,
    planeEpsilon: gate.planeEpsilon,
    corridorHalfWidth: gate.corridorHalfWidth,
    maxStepDistance: gate.maxStepDistance,
    exitDwellMs: gate.exitDwellMs
  }
})), 1.75)
const samples = [
  [199.5, 200.5, 0], [200.5, 200.5, 100], [201.5, 200.0, 200],
  [202.5, 199.8, 300], [203.3738, 200.1227, 400], [203.8896, 200.7665, 500],
  [205.1, 200.5, 600], [205.55, 200.5, 700], [205.9, 200.5, 800],
  [206.1722, 200.3915, 900], [207.5, 200.5, 1000], [209.0, 200.5, 1100],
  [210.5, 200.5, 1200], [212.0, 201.0, 1300]
]
let final
for (const [x, z, at] of samples) final = oracle.observe({ x, y: -60, z }, at, at >= 500 && at <= 900 ? ['B'] : [])

const telemetry = await parseLivingNpcTelemetryFile(telemetryFile)
const timeline = telemetryToTimelineEvents(telemetry)
const farmerEvents = timeline.filter(event => event.data.npc.role.toLowerCase() === 'farmer')
const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex')
const checks = {
  scenario_schema_valid: true,
  exact_uuid_required: step.targetUuid === 'df648175-d295-4e6e-a9f6-eefb0f43ff2f',
  read_only_authorization: (scenario.qa?.authorization.length ?? 0) > 0
    && scenario.qa?.authorization.every(item => item.startsWith('read-only-')) === true,
  ordered_route_pass: final?.passed === true,
  visited_all_checkpoints: JSON.stringify(final?.visited) === JSON.stringify(step.checkpoints.map(item => item.id)),
  gate_crossing_proven: final?.gateCrossings.B?.crossed === true,
  no_discontinuity: final?.discontinuityDetected === false,
  telemetry_schema_valid: true,
  farmer_identity_and_navigation_available: farmerEvents.some(event => event.data.npc.uuid && event.data.navigation?.path)
}
const verdict = Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL'
const report = {
  schemaVersion: 1,
  type: 'farmer-pathfinding-capability-local-validation',
  verdict,
  evidenceLevel: 'LOCAL_REPLAY_VERIFIED_NOT_PAPER_RUNTIME',
  inputs: {
    scenario: path.relative(process.cwd(), scenarioFile),
    scenarioSha256: await hash(scenarioFile),
    telemetryFixture: path.relative(process.cwd(), telemetryFile),
    telemetryFixtureSha256: await hash(telemetryFile)
  },
  checks,
  boundedCounts: { routeSamples: samples.length, telemetryEvents: telemetry.events.length, farmerEvents: farmerEvents.length },
  safety: {
    serverConnected: false,
    processStartedOrRestarted: false,
    productionModified: false,
    rawTelemetryEmbedded: false,
    credentialsEmbedded: false
  },
  limitation: 'Proves BotChecker capability and fixture contract locally; does not verify a current LivingNPC artifact on controlled Paper.'
}
await mkdir(path.dirname(outputFile), { recursive: true })
await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
process.stdout.write(`${verdict} ${outputFile}\n`)
