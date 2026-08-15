import assert from 'node:assert/strict'
import test from 'node:test'
import { RunQueue } from '../src/queue.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(next => { resolve = next })
  return { promise, resolve }
}

test('queue runs one task at a time in FIFO order', async () => {
  const queue = new RunQueue(3)
  const first = deferred()
  const events: string[] = []

  const firstId = queue.enqueue({
    id: 'first',
    run: async () => { events.push('first:start'); await first.promise; events.push('first:end') },
    cancel: () => events.push('first:cancel')
  })
  queue.enqueue({
    id: 'second',
    run: async () => { events.push('second:start') },
    cancel: () => events.push('second:cancel')
  })

  await Promise.resolve()
  assert.deepEqual(events, ['first:start'])
  assert.equal(queue.cancel(firstId), true)
  first.resolve()
  await queue.idle()

  assert.deepEqual(events, ['first:start', 'first:cancel', 'first:end', 'second:start'])
})

test('queue capacity limits pending tasks without counting the active task', () => {
  const queue = new RunQueue(1)
  const first = deferred()
  queue.enqueue({ id: 'first', run: () => first.promise, cancel: () => undefined })
  queue.enqueue({ id: 'second', run: async () => undefined, cancel: () => undefined })

  assert.throws(() => queue.enqueue({ id: 'third', run: async () => undefined, cancel: () => undefined }), /queue is full/i)
  first.resolve()
})

test('queue continues after a task rejects', async () => {
  const queue = new RunQueue(1)
  const events: string[] = []
  queue.enqueue({ id: 'first', run: async () => { throw new Error('expected failure') }, cancel: () => undefined })
  queue.enqueue({ id: 'second', run: async () => { events.push('second:run') }, cancel: () => undefined })

  await queue.idle()
  assert.deepEqual(events, ['second:run'])
})

test('cancelling a queued task never starts it', async () => {
  const queue = new RunQueue(2)
  const events: string[] = []
  const first = deferred()

  queue.enqueue({ id: 'first', run: () => first.promise, cancel: () => events.push('first:cancel') })
  const secondId = queue.enqueue({
    id: 'second',
    run: async () => { events.push('second:run') },
    cancel: () => events.push('second:cancel')
  })

  assert.equal(queue.cancel(secondId), true)
  first.resolve()
  await queue.idle()

  assert.deepEqual(events, ['second:cancel'])
})

test('queue reports active and pending counts', async () => {
  const queue = new RunQueue(2)
  const first = deferred()
  queue.enqueue({ id: 'first', run: () => first.promise, cancel: () => undefined })
  queue.enqueue({ id: 'second', run: async () => undefined, cancel: () => undefined })

  await Promise.resolve()
  assert.deepEqual(queue.snapshot(), { active: 1, pending: 1, capacity: 2 })
  first.resolve()
  await queue.idle()
  assert.deepEqual(queue.snapshot(), { active: 0, pending: 0, capacity: 2 })
})

void test
