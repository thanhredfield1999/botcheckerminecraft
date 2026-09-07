import assert from 'node:assert/strict'
import test from 'node:test'
import {
  entityIdentityLabels, pinUniqueEntity, validatePinnedEntity,
  validateUniquePinnedEntity
} from '../src/entity-observer.js'

const entity = (id: number, uuid?: string, x = 1) => ({
  id,
  uuid,
  name: 'player',
  username: 'Alex',
  displayName: 'Alex',
  position: { x, y: 64, z: 0 }
})

test('R3-05: observer case-normalization trả về NFC sau lowercase', () => {
  const npc = { ...entity(9, 'uuid-9'), displayName: 'J\u030Cade' }
  const position = { x: 0, y: 64, z: 0 }
  const pinned = pinUniqueEntity([npc], position, '\u01F0ade', 48, true)
  assert.equal(pinned.entity, npc)
  assert.equal(validateUniquePinnedEntity([npc], position, '\u01F0ade', 48, pinned.identity, npc), npc)
})

test('observer chuẩn hóa NFC ở pin và validate', () => {
  const npc = { ...entity(9, 'uuid-9'), displayName: 'Mảnh Thành Trì' }
  const query = npc.displayName.normalize('NFD')
  const position = { x: 0, y: 64, z: 0 }
  const pinned = pinUniqueEntity([npc], position, query, 48, true)
  assert.equal(validateUniquePinnedEntity([npc], position, query, 48, pinned.identity, npc), npc)
})

test('observer từ chối nhiều entity trùng tên thay vì chọn nearest tùy tiện', () => {
  assert.throws(
    () => pinUniqueEntity([entity(1, 'uuid-1', 1), entity(2, 'uuid-2', 2)],
      { x: 0, y: 64, z: 0 }, 'Alex', 64, true),
    /INCONCLUSIVE_IDENTITY.*2 entities/
  )
})

test('observer mặc định đòi UUID trước khi bắt đầu trajectory', () => {
  assert.throws(
    () => pinUniqueEntity([entity(1)], { x: 0, y: 64, z: 0 }, 'Alex', 64, true),
    /INCONCLUSIVE_IDENTITY.*UUID/
  )
})

test('observer khóa cả entity ID và UUID trong suốt trajectory', () => {
  const original = entity(7, 'uuid-alex')
  const pinned = pinUniqueEntity([original],
    { x: 0, y: 64, z: 0 }, 'Alex', 64, true).identity

  assert.equal(validatePinnedEntity(original, pinned, original).id, 7)
  assert.throws(
    () => validatePinnedEntity(entity(7, 'uuid-other'), pinned, original),
    /INCONCLUSIVE_IDENTITY.*UUID changed/
  )
  assert.throws(
    () => validatePinnedEntity(undefined, pinned),
    /INCONCLUSIVE_TRACKING.*disappeared/
  )
})

test('observer từ chối object entity mới dù server tái sử dụng cùng ID và UUID', () => {
  const original = entity(7, 'uuid-alex')
  const pinned = pinUniqueEntity([original],
    { x: 0, y: 64, z: 0 }, 'Alex', 64, true).identity

  assert.throws(
    () => validatePinnedEntity(entity(7, 'uuid-alex'), pinned, original),
    /INCONCLUSIVE_IDENTITY.*object replaced/
  )
})

test('observer từ chối ambiguity xuất hiện sau khi đã pin entity', () => {
  const original = entity(7, 'uuid-alex', 1)
  const identity = pinUniqueEntity([original],
    { x: 0, y: 64, z: 0 }, 'Alex', 64, true).identity

  assert.throws(
    () => validateUniquePinnedEntity(
      [original, entity(8, 'uuid-other', 2)],
      { x: 0, y: 64, z: 0 }, 'Alex', 64, identity, original),
    /INCONCLUSIVE_IDENTITY.*2 entities/
  )
})

test('observer nhận diện Citizens NPC qua custom name component', () => {
  const citizen = {
    id: 11,
    uuid: 'uuid-citizen',
    name: 'player',
    position: { x: 2, y: 64, z: 0 },
    getCustomName: () => ({ toString: () => 'ThanhRedfield' })
  }

  const pinned = pinUniqueEntity([citizen], { x: 0, y: 64, z: 0 }, 'thanhredfield', 48, true)

  assert.equal(pinned.entity.id, 11)
  assert.equal(pinned.identity.label, 'ThanhRedfield')
  assert.deepEqual(entityIdentityLabels(citizen), ['player', 'ThanhRedfield'])
})

test('observer lọc đúng UUID khi tên hiển thị bị trùng', () => {
  const target = {
    ...entity(11, '46a5553d-cedc-428f-b51a-4f5ddec03c9b', 2),
    getCustomName: () => ({ toString: () => 'ThanhRedfield' })
  }
  const other = {
    ...entity(12, 'uuid-other', 3),
    getCustomName: () => ({ toString: () => 'ThanhRedfield' })
  }
  assert.equal(pinUniqueEntity(
    [target, other], { x: 0, y: 64, z: 0 }, 'ThanhRedfield', 48, true,
    target.uuid
  ).entity.id, 11)
  assert.throws(
    () => pinUniqueEntity(
      [target, other], { x: 0, y: 64, z: 0 }, 'ThanhRedfield', 48, true,
      'uuid-missing'
    ),
    /INCONCLUSIVE_IDENTITY.*uuid-missing/
  )
})

test('observer bỏ qua custom name lỗi thay vì làm hỏng toàn bộ entity scan', () => {
  const malformed = {
    ...entity(12, 'uuid-malformed'),
    username: undefined,
    displayName: undefined,
    getCustomName: () => { throw new Error('invalid metadata') }
  }

  assert.deepEqual(entityIdentityLabels(malformed), ['player'])
  assert.throws(
    () => pinUniqueEntity([malformed], { x: 0, y: 64, z: 0 }, 'Alex', 48, true),
    /INCONCLUSIVE_TRACKING/
  )
})
