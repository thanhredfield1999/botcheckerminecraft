import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { summarizeProtocolDecodeError } from '../src/protocol-diagnostic.js'

test('protocol decode diagnostic fingerprints one bounded frame without retaining arbitrary error data', () => {
  const buffer = Buffer.from(Array.from({ length: 80 }, (_, index) => index))
  const error = Object.assign(new Error('array size is abnormally large, not reading: 1735156083'), {
    field: 'play.toClient.packet.params.slot.components.data.pages',
    buffer,
    password: 'khong-duoc-ghi'
  })

  const diagnostic = summarizeProtocolDecodeError(error)

  assert.deepEqual(diagnostic, {
    field: 'play.toClient.packet.params.slot.components.data.pages',
    frameLength: 80,
    frameSha256: createHash('sha256').update(buffer).digest('hex')
  })
  assert.doesNotMatch(JSON.stringify(diagnostic), /khong-duoc-ghi/)
  assert.equal('buffer' in diagnostic, false)
})

test('protocol decode diagnostic omits frame metadata when the parser did not attach a buffer', () => {
  const error = Object.assign(new Error('socket closed'), { field: 'play.toClient.packet' })

  assert.deepEqual(summarizeProtocolDecodeError(error), {
    field: 'play.toClient.packet'
  })
})
