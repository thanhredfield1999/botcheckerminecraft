import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import {
  analyzeLivingNpcTelemetry,
  livingNpcTelemetrySnapshotSchema,
  parseLivingNpcTelemetryFile,
  parseLivingNpcTelemetryString,
  telemetryToTimelineEvents
} from '../src/livingnpc-telemetry.js'

const fixturePath = path.resolve('test/fixtures/livingnpc-telemetry-snapshot.json')

async function fixtureText(): Promise<string> {
  return readFile(fixturePath, 'utf8')
}

test('parser đọc fixture JSON đúng schema LivingNPC telemetry Paper', async () => {
  const snapshot = await parseLivingNpcTelemetryFile(fixturePath)

  assert.equal(snapshot.schemaVersion, 1)
  assert.equal(snapshot.capacity, 512)
  assert.equal(snapshot.totalRecorded, 3)
  assert.equal(snapshot.events.length, 3)
  assert.equal(snapshot.events[0].npcId, '46a5553d-cedc-428f-b51a-4f5ddec03c9b')
  assert.equal(snapshot.events[0].navigation?.distanceMargin, null)
  assert.equal(snapshot.events[0].npcPrecise?.x, 59.25)
  assert.equal(snapshot.events[0].blockProbes[1].material, 'STONE')
})

test('parser giữ backward compatibility khi snapshot cũ không có optional Observatory sections', async () => {
  const snapshot = await parseLivingNpcTelemetryFile(fixturePath)

  assert.equal(snapshot.economy, undefined)
  assert.equal(snapshot.visitors, undefined)
  assert.equal(snapshot.structures, undefined)
  assert.equal(snapshot.houseScan, undefined)
})

test('parser nhận optional Observatory sections khi producer bounded gửi dữ liệu thật', () => {
  const snapshot = parseLivingNpcTelemetryString(JSON.stringify({
    schemaVersion: 1,
    capacity: 64,
    totalRecorded: 1,
    events: [minimalEvent()],
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
        target: minimalPosition(),
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
    },
    houseScan: {
      schemaVersion: 1,
      status: 'bounded-scan-complete',
      houses: [{
        id: 'house-2',
        bounds: { world: 'StillCliff', minX: 10, minY: 60, minZ: 20, maxX: 15, maxY: 66, maxZ: 28 },
        beds: 1,
        workstations: 0,
        doors: 2,
        occupancy: 0,
        scanStatus: 'complete'
      }]
    }
  }))

  assert.equal(snapshot.economy?.balanceMinor, 1250)
  assert.equal(snapshot.economy?.activities?.[0]?.action, 'Thu hoạch')
  assert.equal(snapshot.visitors?.visitors?.[0]?.purchase?.spentMinor, 200)
  assert.equal(snapshot.structures?.structures?.[0]?.bounds.maxZ, 8)
  assert.equal(snapshot.houseScan?.houses?.[0]?.doors, 2)
})

test('parser từ chối malformed, schema mismatch, extra key và payload vượt giới hạn', async () => {
  assert.throws(() => parseLivingNpcTelemetryString('{'), /Invalid JSON/)
  assert.throws(() => parseLivingNpcTelemetryString('{"schemaVersion":2,"capacity":1,"totalRecorded":0,"events":[]}'), /Invalid LivingNPC telemetry snapshot/)

  const extraKey = JSON.stringify({ schemaVersion: 1, capacity: 1, totalRecorded: 0, events: [], extra: true })
  assert.throws(() => parseLivingNpcTelemetryString(extraKey), /Invalid LivingNPC telemetry snapshot/)

  const oversized = `${' '.repeat(1025)}{"schemaVersion":1,"capacity":1,"totalRecorded":0,"events":[]}`
  assert.throws(() => parseLivingNpcTelemetryString(oversized, { maxBytes: 1024 }), /payload too large/)
})

test('parser từ chối event/probe unbounded và tọa độ non-finite hoặc ngoài world bound', () => {
  assert.throws(() => parseLivingNpcTelemetryString(JSON.stringify({
    schemaVersion: 1,
    capacity: 2,
    totalRecorded: 0,
    events: Array.from({ length: 3 }, () => minimalEvent())
  }), { maxEvents: 2 }), /Invalid LivingNPC telemetry snapshot/)

  assert.throws(() => parseLivingNpcTelemetryString(JSON.stringify({
    schemaVersion: 1,
    capacity: 64,
    totalRecorded: 1,
    events: [{ ...minimalEvent(), blockProbes: Array.from({ length: 9 }, () => minimalProbe()) }]
  }), { maxBlockProbesPerEvent: 8 }), /Invalid LivingNPC telemetry snapshot/)

  assert.throws(() => parseLivingNpcTelemetryString('{"schemaVersion":1,"capacity":64,"totalRecorded":1,"events":[{"schemaVersion":1,"type":"ACTION","npcId":"46a5553d-cedc-428f-b51a-4f5ddec03c9b","name":"Steve","role":"farmer","world":"StillCliff","npcBlock":{"world":"StillCliff","xBlock":59,"yBlock":-60,"zBlock":-1,"x":NaN,"y":-60,"z":-0.9,"yaw":90,"pitch":0},"npcPrecise":null,"targetBlock":null,"targetPrecise":null,"state":"GOING","phase":"GOING","navigation":null,"path":"present","obstacle":null,"semanticPoint":null,"blockProbes":[],"timestampTick":1,"timestampMillis":1}]}'), /Invalid JSON/)

  assert.throws(() => parseLivingNpcTelemetryString(JSON.stringify({
    schemaVersion: 1,
    capacity: 64,
    totalRecorded: 1,
    events: [{ ...minimalEvent(), npcBlock: { ...minimalPosition(), x: 30_000_000 } }]
  })), /Invalid LivingNPC telemetry snapshot/)
})

test('parser từ chối optional Observatory sections vượt bounds', () => {
  const base = { schemaVersion: 1, capacity: 64, totalRecorded: 1, events: [minimalEvent()] }

  assert.throws(() => parseLivingNpcTelemetryString(JSON.stringify({
    ...base,
    economy: {
      schemaVersion: 1,
      villageId: 'stillcliff',
      activities: Array.from({ length: 17 }, () => ({
        npcId: '46a5553d-cedc-428f-b51a-4f5ddec03c9b', role: 'farmer', action: 'x', itemKey: 'wheat', amount: 1
      }))
    }
  })), /Invalid LivingNPC telemetry snapshot/)

  assert.throws(() => parseLivingNpcTelemetryString(JSON.stringify({
    ...base,
    visitors: { schemaVersion: 1, visitors: Array.from({ length: 17 }, (_, index) => ({ visitId: `visitor:${index}`, name: 'Aldous', phase: 'SHOPPING' })) }
  })), /Invalid LivingNPC telemetry snapshot/)

  assert.throws(() => parseLivingNpcTelemetryString(JSON.stringify({
    ...base,
    houseScan: {
      schemaVersion: 1,
      houses: Array.from({ length: 33 }, (_, index) => ({
        id: `house-${index}`,
        bounds: { world: 'StillCliff', minX: 1, minY: 60, minZ: 2, maxX: 5, maxY: 66, maxZ: 8 }
      }))
    }
  })), /Invalid LivingNPC telemetry snapshot/)
})

test('adapter chuyển telemetry event thành timeline/observer event đủ identity, tọa độ, navigation, probes và semantic target', async () => {
  const snapshot = await parseLivingNpcTelemetryFile(fixturePath)
  const events = telemetryToTimelineEvents(snapshot)

  assert.equal(events.length, 3)
  assert.equal(events[0].type, 'livingnpc.telemetry.ACTION')
  assert.equal(events[0].summary, 'Steve farmer GOING_TO_PLOT path=present')
  assert.deepEqual(events[0].data?.npc, {
    uuid: '46a5553d-cedc-428f-b51a-4f5ddec03c9b', name: 'Steve', role: 'farmer', world: 'StillCliff'
  })
  assert.deepEqual(events[0].data?.position?.block, { world: 'StillCliff', x: 59, y: -60, z: -1 })
  assert.deepEqual(events[0].data?.position?.precise, { world: 'StillCliff', x: 59.25, y: -60, z: -0.9, yaw: 90, pitch: 0 })
  assert.deepEqual(events[0].data?.state, { state: 'GOING_TO_PLOT', phase: 'GOING_TO_PLOT' })
  assert.equal(events[0].data?.navigation?.path, 'present')
  assert.equal(events[0].data?.blockProbes?.[1]?.obstacle, true)
  assert.deepEqual(events[0].data?.semanticPoint, {
    type: 'PLOT', name: 'plot', world: 'StillCliff', position: { world: 'StillCliff', x: 60.5, y: -60, z: -0.5, yaw: 0, pitch: 0 }
  })
})

test('evidence helpers phát hiện STUCK/path absent, shared semantic target collision và role mismatch có metadata', async () => {
  const snapshot = await parseLivingNpcTelemetryFile(fixturePath)
  const evidence = analyzeLivingNpcTelemetry(snapshot, {
    expectedRolesByNpcId: { '46a5553d-cedc-428f-b51a-4f5ddec03c9b': 'rancher' }
  })

  assert.deepEqual(evidence.map(item => item.code), [
    'LIVINGNPC_ROLE_MISMATCH',
    'LIVINGNPC_STUCK_PATH_ABSENT',
    'LIVINGNPC_SEMANTIC_TARGET_COLLISION'
  ])
  const roleMismatch = evidence[0]
  const stuck = evidence[1]
  const collision = evidence[2]
  assert.equal(roleMismatch.code, 'LIVINGNPC_ROLE_MISMATCH')
  assert.equal(roleMismatch.verdict, 'INCONCLUSIVE')
  assert.equal(roleMismatch.npc.uuid, '46a5553d-cedc-428f-b51a-4f5ddec03c9b')
  assert.equal(stuck.code, 'LIVINGNPC_STUCK_PATH_ABSENT')
  assert.equal(stuck.npc.name, 'Alex')
  assert.equal(stuck.navigation?.cancelReason, 'STUCK')
  assert.equal(collision.code, 'LIVINGNPC_SEMANTIC_TARGET_COLLISION')
  assert.deepEqual(collision.participants.map(participant => participant.name).sort(), ['Alex', 'Steve'])
})

test('evidence helper không tự kết luận khi thiếu metadata đối chiếu role', async () => {
  const snapshot = await parseLivingNpcTelemetryFile(fixturePath)
  const evidence = analyzeLivingNpcTelemetry(snapshot)

  assert.deepEqual(evidence.map(item => item.code), [
    'LIVINGNPC_STUCK_PATH_ABSENT',
    'LIVINGNPC_SEMANTIC_TARGET_COLLISION'
  ])
})

function minimalEvent() {
  return {
    schemaVersion: 1,
    type: 'ACTION',
    npcId: '46a5553d-cedc-428f-b51a-4f5ddec03c9b',
    name: 'Steve',
    role: 'farmer',
    world: 'StillCliff',
    npcBlock: minimalPosition(),
    npcPrecise: minimalPosition(),
    targetBlock: null,
    targetPrecise: null,
    state: 'GOING_TO_PLOT',
    phase: 'GOING_TO_PLOT',
    navigation: null,
    path: 'present',
    obstacle: null,
    semanticPoint: null,
    blockProbes: [],
    timestampTick: 1,
    timestampMillis: 1710000000000
  }
}

function minimalPosition() {
  return {
    world: 'StillCliff',
    xBlock: 59,
    yBlock: -60,
    zBlock: -1,
    x: 59.25,
    y: -60,
    z: -0.9,
    yaw: 90,
    pitch: 0
  }
}

function minimalProbe() {
  return {
    relation: 'feet',
    world: 'StillCliff',
    x: 59,
    y: -60,
    z: -1,
    material: 'AIR',
    solid: false,
    passable: true,
    loadedChunk: true,
    door: false,
    fenceGate: false,
    fence: false,
    obstacle: false
  }
}

void livingNpcTelemetrySnapshotSchema
