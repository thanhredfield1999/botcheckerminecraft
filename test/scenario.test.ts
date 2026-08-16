import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { loadScenario, scenarioSchema } from '../src/scenario.js'

test('scenario requires a GUI selector', () => {
  const result = scenarioSchema.safeParse({
    name: 'invalid',
    steps: [{ id: 'click', action: 'click_gui' }]
  })
  assert.equal(result.success, false)
})

test('scenario applies safe defaults', () => {
  const scenario = scenarioSchema.parse({
    name: 'valid',
    steps: [{ id: 'menu', action: 'click_gui', nameIncludes: 'Fishing' }]
  })
  assert.equal(scenario.steps[0].timeoutMs, 30_000)
  assert.equal(scenario.steps[0].optional, false)
  assert.equal(scenario.steps[0].action === 'click_gui' && scenario.steps[0].inspectDelayMs, 750)
})

test('GUI assertion rejects an empty postcondition', () => {
  const parsed = scenarioSchema.safeParse({ name: 'GUI postcondition', steps: [{ id: 'gui', action: 'assert_gui', titleIncludes: 'Menu' }] })
  assert.equal(parsed.success, true)
  assert.equal(scenarioSchema.safeParse({ name: 'empty GUI assertion', steps: [{ id: 'empty', action: 'assert_gui' }] }).success, false)
})

test('NPC interaction supports human-like travel and waiting for its GUI', () => {
  const scenario = scenarioSchema.parse({
    name: 'npc quest',
    steps: [{
      id: 'quest_npc',
      action: 'interact_entity',
      nameIncludes: 'Nhiem Vu',
      x: 100,
      y: 64,
      z: -20,
      waitForGui: true
    }]
  })
  const step = scenario.steps[0]
  assert.equal(step.action === 'interact_entity' && step.travel, 'walk')
  assert.equal(step.action === 'interact_entity' && step.interactionRange, 2.5)
})

test('NPC interaction supports a trimmed exact UUID identity', () => {
  const requiredUuid = '46a5553d-cedc-428f-b51a-4f5ddec03c9b'
  const scenario = scenarioSchema.parse({
    name: 'exact npc interaction',
    steps: [{
      id: 'npc', action: 'interact_entity', nameIncludes: 'ThanhRedfield',
      requiredUuid: `  ${requiredUuid}  `
    }]
  })

  const step = scenario.steps[0]
  assert.equal(step.action === 'interact_entity' && step.requiredUuid, requiredUuid)
})

test('NPC interaction rejects an invalid exact UUID identity', () => {
  const result = scenarioSchema.safeParse({
    name: 'invalid exact npc interaction',
    steps: [{
      id: 'npc', action: 'interact_entity', nameIncludes: 'ThanhRedfield',
      requiredUuid: 'not-a-uuid'
    }]
  })

  assert.equal(result.success, false)
})

test('NPC coordinates must be complete', () => {
  const result = scenarioSchema.safeParse({
    name: 'invalid npc',
    steps: [{ id: 'npc', action: 'interact_entity', nameIncludes: 'Quest', x: 1 }]
  })
  assert.equal(result.success, false)
})

test('read-only runtime assertions apply safe defaults', () => {
  const scenario = scenarioSchema.parse({
    name: 'living npc smoke',
    steps: [
      { id: 'state', action: 'assert_state', minimumHealth: 20, minimumFood: 20 },
      { id: 'npc', action: 'assert_nearby_entity', nameIncludes: 'ThanhRedfield' }
    ]
  })

  assert.deepEqual(scenario.steps[0], {
    id: 'state', action: 'assert_state', timeoutMs: 30_000, optional: false,
    minimumHealth: 20, minimumFood: 20, gui: 'closed'
  })
  assert.deepEqual(scenario.steps[1], {
    id: 'npc', action: 'assert_nearby_entity', timeoutMs: 30_000, optional: false,
    nameIncludes: 'ThanhRedfield', maxDistance: 48
  })
})

test('nearby entity assertion supports exact UUID identity', () => {
  const scenario = scenarioSchema.parse({
    name: 'living npc identity',
    steps: [{
      id: 'npc', action: 'assert_nearby_entity', nameIncludes: 'ThanhRedfield',
      requiredUuid: '46a5553d-cedc-428f-b51a-4f5ddec03c9b'
    }]
  })
  assert.equal(scenario.steps[0].action === 'assert_nearby_entity' && scenario.steps[0].requiredUuid,
    '46a5553d-cedc-428f-b51a-4f5ddec03c9b')
  assert.equal(scenarioSchema.safeParse({
    name: 'invalid identity',
    steps: [{ id: 'npc', action: 'assert_nearby_entity', nameIncludes: 'NPC', requiredUuid: 'not-a-uuid' }]
  }).success, false)
})

test('entity diagnostic áp dụng giới hạn an toàn mặc định', () => {
  const scenario = scenarioSchema.parse({
    name: 'citizens metadata probe',
    steps: [{ id: 'entities', action: 'inspect_entities' }]
  })

  assert.deepEqual(scenario.steps[0], {
    id: 'entities', action: 'inspect_entities', timeoutMs: 30_000, optional: false,
    maxDistance: 48, limit: 64
  })
  assert.equal(scenarioSchema.safeParse({
    name: 'unbounded probe',
    steps: [{ id: 'entities', action: 'inspect_entities', limit: 65 }]
  }).success, false)
})

test('load observer chỉ cho phép cửa sổ quan sát bounded', () => {
  const scenario = scenarioSchema.parse({
    name: 'bounded load observation',
    steps: [{ id: 'observe', action: 'observe_load' }]
  })

  assert.deepEqual(scenario.steps[0], {
    id: 'observe', action: 'observe_load', timeoutMs: 30_000, optional: false,
    durationMs: 5_000, sampleMs: 500, maxDistance: 48,
    maxEntities: 64, maxInventoryItems: 46
  })
  for (const step of [
    { id: 'observe', action: 'observe_load', durationMs: 30_001 },
    { id: 'observe', action: 'observe_load', sampleMs: 99 },
    { id: 'observe', action: 'observe_load', maxDistance: 49 },
    { id: 'observe', action: 'observe_load', maxEntities: 65 },
    { id: 'observe', action: 'observe_load', maxInventoryItems: 47 }
  ]) {
    assert.equal(scenarioSchema.safeParse({ name: 'unbounded', steps: [step] }).success, false)
  }
})

test('crossing observer áp dụng continuity, aperture, dwell và UUID an toàn mặc định', () => {
  const scenario = scenarioSchema.parse({
    name: 'crossing observer',
    steps: [{
      id: 'cross', action: 'observe_crossing', nameIncludes: 'Alex',
      approach: { x: -18.5, y: -60, z: -67.5 },
      exit: { x: -16.5, y: -60, z: -66.5 }
    }]
  })
  const step = scenario.steps[0]

  assert.equal(step.action === 'observe_crossing' && step.requireUuid, true)
  assert.equal(step.action === 'observe_crossing' && step.planeEpsilon, 0.1)
  assert.equal(step.action === 'observe_crossing' && step.corridorHalfWidth, 0.75)
  assert.equal(step.action === 'observe_crossing' && step.maxStepDistance, 1.75)
  assert.equal(step.action === 'observe_crossing' && step.exitDwellMs, 300)
})

const crossingStep = {
  id: 'cross', action: 'observe_crossing', nameIncludes: 'Alex',
  approach: { x: -1, y: 64, z: 0 },
  exit: { x: 1, y: 64, z: 0 }
} as const

test('crossing observer bắt buộc khóa identity và pairing của LivingNPC', () => {
  assert.equal(scenarioSchema.safeParse({
    name: 'partial pairing',
    steps: [{ ...crossingStep, targetUuid: '3d1d6e6d-6f19-4214-b794-f3ba0c202a1d' }]
  }).success, false)

  const paired = scenarioSchema.parse({
    name: 'paired crossing',
    steps: [{
      ...crossingStep,
      targetUuid: '3d1d6e6d-6f19-4214-b794-f3ba0c202a1d',
      serverWorld: 'StillCliff',
      dimension: 'minecraft:overworld',
      gateBlock: { x: 0, y: 64, z: 0 },
      approach: { x: -0.5, y: 64, z: 0.5 },
      exit: { x: 1.5, y: 64, z: 0.5 }
    }]
  })
  const step = paired.steps[0]
  assert.equal(step.action === 'observe_crossing' && step.targetUuid,
    '3d1d6e6d-6f19-4214-b794-f3ba0c202a1d')
  assert.equal(step.action === 'observe_crossing' && step.serverWorld, 'StillCliff')
  assert.equal(step.action === 'observe_crossing' && step.dimension, 'minecraft:overworld')
  assert.deepEqual(step.action === 'observe_crossing' && step.gateBlock,
    { x: 0, y: 64, z: 0 })
})

test('paired crossing từ chối endpoint lệch khỏi hai phía đối xứng của gateBlock', () => {
  const result = scenarioSchema.safeParse({
    name: 'misaligned release crossing',
    steps: [{
      id: 'cross', action: 'observe_crossing', nameIncludes: 'Alex',
      targetUuid: '3d1d6e6d-6f19-4214-b794-f3ba0c202a1d',
      serverWorld: 'StillCliff', dimension: 'overworld',
      gateBlock: { x: -17, y: -60, z: -67 },
      approach: { x: -18.5, y: -60, z: -67.5 },
      exit: { x: -16.5, y: -60, z: -66.5 }
    }]
  })

  assert.equal(result.success, false)
})

test('scenario từ chối typo thay vì âm thầm làm yếu crossing evidence', () => {
  assert.equal(scenarioSchema.safeParse({
    name: 'typo',
    steps: [{ ...crossingStep, requiredExitSample: 9 }]
  }).success, false)
})

test('scenario không cho phép tắt UUID requirement của crossing proof', () => {
  assert.equal(scenarioSchema.safeParse({
    name: 'weak identity',
    steps: [{ ...crossingStep, requireUuid: false }]
  }).success, false)
})

test('scenario từ chối step ID trùng để report không nhập nhằng', () => {
  assert.equal(scenarioSchema.safeParse({
    name: 'duplicate',
    steps: [crossingStep, { id: 'cross', action: 'wait', durationMs: 0 }]
  }).success, false)
})

test('scenario từ chối crossing chỉ khác Y hoặc lệch cao độ quá tolerance', () => {
  assert.equal(scenarioSchema.safeParse({
    name: 'vertical only',
    steps: [{ ...crossingStep,
      approach: { x: 0, y: 64, z: 0 }, exit: { x: 0, y: 65, z: 0 } }]
  }).success, false)
  assert.equal(scenarioSchema.safeParse({
    name: 'vertical mismatch',
    steps: [{ ...crossingStep,
      approach: { x: -1, y: 64, z: 0 }, exit: { x: 1, y: 66, z: 0 },
      verticalTolerance: 1 }]
  }).success, false)
})

test('scenario từ chối endpoint không đủ clearance và tọa độ ngoài world border', () => {
  assert.equal(scenarioSchema.safeParse({
    name: 'short geometry',
    steps: [{ ...crossingStep,
      approach: { x: -0.1, y: 64, z: 0 }, exit: { x: 0.1, y: 64, z: 0 },
      entryClearance: 0.3, exitClearance: 0.3 }]
  }).success, false)
  assert.equal(scenarioSchema.safeParse({
    name: 'overflow geometry',
    steps: [{ ...crossingStep,
      approach: { x: -1e308, y: 64, z: 0 }, exit: { x: 1e308, y: 64, z: 0 } }]
  }).success, false)
})

test('mọi fixture scenario trong repository đều hợp lệ dưới schema strict', async () => {
  const scenarioDir = path.resolve('scenarios')
  const names = (await readdir(scenarioDir))
    .filter(file => file.endsWith('.json'))
    .map(file => file.slice(0, -'.json'.length))
    .sort()

  for (const name of names) await loadScenario(scenarioDir, name)

  assert.ok(names.length > 0)
})

test('fixture LivingNPC crossing khóa exact UUID, world, gate và hai phía cửa', async () => {
  const scenario = await loadScenario(path.resolve('scenarios'), 'living-npc-crossing-observer')
  assert.deepEqual(scenario.steps.map(step => step.action), ['wait', 'observe_crossing'])

  const step = scenario.steps[1]
  assert.equal(step.action, 'observe_crossing')
  if (step.action !== 'observe_crossing') return
  assert.equal(step.targetUuid, '3d1d6e6d-6f19-4214-b794-f3ba0c202a1d')
  assert.equal(step.serverWorld, 'StillCliff')
  assert.equal(step.dimension, 'overworld')
  assert.deepEqual(step.gateBlock, { x: -17, y: -60, z: -67 })
  assert.deepEqual(step.approach, { x: -17.5, y: -60, z: -66.5 })
  assert.deepEqual(step.exit, { x: -15.5, y: -60, z: -66.5 })
})

test('fixture ThanhRedfield identity-only khóa UUID và không chứa action gây mutation hoặc movement', async () => {
  const scenario = await loadScenario(path.resolve('scenarios'), 'citizens-thanhredfield-identity-only')
  const actions = scenario.steps.map(step => step.action)

  assert.deepEqual(actions, ['assert_state', 'inspect_entities', 'assert_nearby_entity', 'assert_state'])
  const identityStep = scenario.steps[2]
  assert.equal(identityStep.action === 'assert_nearby_entity' && identityStep.requiredUuid,
    '46a5553d-cedc-428f-b51a-4f5ddec03c9b')
  assert.equal(identityStep.action === 'assert_nearby_entity' && identityStep.maxDistance, 48)
})

test('fixture restaurant tycoon ordering GUI khóa exact sequence, selectors, command và không click thanh toán', async () => {
  const scenario = await loadScenario(path.resolve('scenarios'), 'restaurant-tycoon-ordering-gui')
  const steps = scenario.steps

  const lowerDescription = scenario.description.toLowerCase()
  assert.ok(scenario.maxDurationMs <= 180_000)
  assert.ok(lowerDescription.includes('plot_1'), 'description must state owner plot_1')
  assert.ok(lowerDescription.includes('setup supply'), 'description must state setup supply')
  assert.ok(lowerDescription.includes('chuẩn bị trước'), 'description must state the DB test fixture must be prepared beforehand')
  assert.ok(lowerDescription.includes('không thanh toán'), 'description must state no payment is performed')
  assert.ok(lowerDescription.includes('xác nhận'), 'description must state confirmation is opened')

  assert.deepEqual(steps.map(step => step.action), [
    'assert_state', 'chat', 'wait_for_text', 'wait_for_gui',
    'click_gui', 'click_gui', 'assert_gui', 'assert_state'
  ])

  const stateBefore = steps[0]
  assert.equal(stateBefore.action === 'assert_state' && stateBefore.minimumHealth, 20)
  assert.equal(stateBefore.action === 'assert_state' && stateBefore.minimumFood, 20)
  assert.equal(stateBefore.action === 'assert_state' && stateBefore.gui, 'closed')

  const command = steps[1]
  assert.equal(command.action === 'chat' && command.message, '/restaurant order plot_1')

  const guidance = steps[2]
  assert.equal(guidance.action === 'wait_for_text' && guidance.text, 'Đang kiểm tra quyền sở hữu và thiết lập nhập hàng...')
  assert.equal(guidance.action === 'wait_for_text' && guidance.source, 'chat')

  const orderGui = steps[3]
  assert.equal(orderGui.action === 'wait_for_gui' && orderGui.titleIncludes, 'Đặt nguyên liệu - plot_1')

  const selectTomato = steps[4]
  assert.equal(selectTomato.action === 'click_gui' && selectTomato.nameIncludes, 'Cà chua')
  assert.equal(selectTomato.action === 'click_gui' && selectTomato.button, 'left')
  assert.ok(selectTomato.action === 'click_gui' && selectTomato.inspectDelayMs >= 750)

  const confirmOrder = steps[5]
  assert.equal(confirmOrder.action === 'click_gui' && confirmOrder.nameIncludes, 'Xác nhận đơn')
  assert.equal(confirmOrder.action === 'click_gui' && confirmOrder.button, 'left')
  assert.ok(confirmOrder.action === 'click_gui' && confirmOrder.inspectDelayMs >= 750)

  const paymentGui = steps[6]
  assert.equal(paymentGui.action === 'assert_gui' && paymentGui.titleIncludes, 'Xác nhận thanh toán')
  assert.deepEqual(paymentGui.action === 'assert_gui' && paymentGui.items, [
    { slot: 11, nameIncludes: 'Thanh toán', loreIncludes: 'ghi bền vững', count: 1 }
  ])

  const stateAfter = steps[7]
  assert.equal(stateAfter.action === 'assert_state' && stateAfter.minimumHealth, 20)
  assert.equal(stateAfter.action === 'assert_state' && stateAfter.minimumFood, 20)
  assert.equal(stateAfter.action === 'assert_state' && stateAfter.gui, 'open')

  const mutatingOrMovement = ['go_to', 'interact_entity', 'equip', 'fish', 'plant', 'assert_inventory', 'observe_crossing']
  assert.equal(steps.some(step => mutatingOrMovement.includes(step.action)), false)
  for (const step of steps) {
    if (step.action !== 'click_gui') continue
    assert.notEqual(step.nameIncludes, 'Xác nhận thanh toán')
    assert.equal((step.nameIncludes?.toLowerCase().includes('thanh toán') ?? false), false)
    assert.equal((step.loreIncludes?.toLowerCase().includes('thanh toán') ?? false), false)
  }
})

test('fixture ThanhRedfield player journey khóa exact UUID trước khi tương tác', async () => {
  const scenario = await loadScenario(path.resolve('scenarios'), 'citizens-thanhredfield-player-journey')
  const interactions = scenario.steps.filter(step => step.action === 'interact_entity')

  assert.ok(interactions.length > 0)
  for (const step of interactions) {
    assert.equal(step.action === 'interact_entity' && step.requiredUuid,
      '46a5553d-cedc-428f-b51a-4f5ddec03c9b')
    assert.equal(step.action === 'interact_entity' && step.maxDistance, 48)
  }
})
