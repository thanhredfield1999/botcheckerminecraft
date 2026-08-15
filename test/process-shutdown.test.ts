import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { installShutdownHandlers } from '../src/process-shutdown.js'

class FakeProcess extends EventEmitter {
  exitCode: number | undefined
}

test('signal shutdown closes once and removes handlers', async () => {
  const process = new FakeProcess()
  let closes = 0
  let release!: () => void
  const closed = new Promise<void>(resolve => { release = resolve })
  const done = installShutdownHandlers({ close: async () => { closes++; await closed } }, process)

  process.emit('SIGTERM')
  process.emit('SIGINT')
  assert.equal(closes, 1)

  release()
  await done()
  assert.equal(process.listenerCount('SIGTERM'), 0)
  assert.equal(process.listenerCount('SIGINT'), 0)
})

test('shutdown failure marks the process unsuccessful', async () => {
  const process = new FakeProcess()
  const done = installShutdownHandlers({ close: async () => { throw new Error('close failed') } }, process)

  process.emit('SIGTERM')
  await done()

  assert.equal(process.exitCode, 1)
})
