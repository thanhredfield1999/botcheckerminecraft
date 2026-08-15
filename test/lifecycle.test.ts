import assert from 'node:assert/strict'
import test from 'node:test'
import { RunLifecycle } from '../src/lifecycle.js'

test('cancellation stops a pending operation and runs cleanup once', async () => {
  let operationStopped = false
  let cleanupCalls = 0
  const lifecycle = new RunLifecycle()

  const operation = lifecycle.run(async signal => {
    if (signal.aborted) {
      operationStopped = true
      throw new Error('aborted')
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        operationStopped = true
        reject(new Error('aborted'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      signal.addEventListener('abort', () => resolve(), { once: true })
    })
  }, async () => {
    cleanupCalls++
  })

  lifecycle.cancel('test cancellation')
  await assert.rejects(operation, /aborted/)
  assert.equal(operationStopped, true)
  assert.equal(cleanupCalls, 1)
})

test('finish is idempotent and does not run cleanup twice', async () => {
  let cleanupCalls = 0
  const lifecycle = new RunLifecycle()

  await lifecycle.run(async () => undefined, async () => {
    cleanupCalls++
  })
  await lifecycle.finish()
  lifecycle.cancel('late cancellation')

  assert.equal(cleanupCalls, 1)
  assert.equal(lifecycle.signal.aborted, false)
})
