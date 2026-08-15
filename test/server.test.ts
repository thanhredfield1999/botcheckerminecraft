import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from '../src/server.js'
import { scenarioSchema } from '../src/scenario.js'
import type { RunStatus } from '../src/types.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(next => { resolve = next })
  return { promise, resolve }
}

const scenario = scenarioSchema.parse({
  name: 'queue-test',
  steps: [{ id: 'wait', action: 'wait', durationMs: 1 }]
})

test('API queues FIFO, exposes pressure, rejects overflow and cancels queued runs without starting them', async t => {
  const gates = [deferred(), deferred(), deferred()]
  const starts: string[] = []
  const persisted: string[] = []
  const created: Array<{ id: string; status: RunStatus }> = []
  let nextId = 0

  const app = createServer({
    logger: false,
    queueCapacity: 1,
    scenarioLoader: async () => scenario,
    runFactory: () => {
      const index = nextId++
      const run = {
        id: `run-${index + 1}`,
        status: 'queued' as RunStatus,
        async start() {
          starts.push(this.id)
          this.status = 'running'
          await gates[index].promise
          if ((this.status as RunStatus) !== 'cancelled') this.status = 'passed'
        },
        cancel() { this.status = 'cancelled' },
        async persistCancelled() { persisted.push(this.id) },
        view() { return { runId: this.id, status: this.status } },
        report() { return { runId: this.id, status: this.status } }
      }
      created.push(run)
      return run
    }
  })
  t.after(() => app.close())

  const first = await app.inject({ method: 'POST', url: '/api/runs', payload: { scenario: 'queue-test' } })
  const second = await app.inject({ method: 'POST', url: '/api/runs', payload: { scenario: 'queue-test' } })
  const overflow = await app.inject({ method: 'POST', url: '/api/runs', payload: { scenario: 'queue-test' } })

  assert.equal(first.statusCode, 202)
  assert.equal(second.statusCode, 202)
  assert.equal(overflow.statusCode, 429)
  assert.deepEqual(starts, ['run-1'])

  const health = await app.inject({ method: 'GET', url: '/health' })
  assert.deepEqual(health.json().queue, { active: 1, pending: 1, capacity: 1 })

  const cancelled = await app.inject({ method: 'POST', url: '/api/runs/run-2/cancel' })
  assert.equal(cancelled.statusCode, 200)
  assert.equal(cancelled.json().status, 'cancelled')
  assert.deepEqual(persisted, ['run-2'])

  gates[0].resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(starts, ['run-1'])
  assert.equal(created[1].status, 'cancelled')
})

test('closing the API cancels queued and active runs and waits for idle', async () => {
  const activeGate = deferred()
  const cancelled: string[] = []
  const persisted: string[] = []
  let nextId = 0
  const app = createServer({
    logger: false,
    queueCapacity: 1,
    scenarioLoader: async () => scenario,
    runFactory: () => {
      const id = `shutdown-${++nextId}`
      return {
        id,
        status: 'queued' as RunStatus,
        async start() {
          this.status = 'running'
          await activeGate.promise
        },
        cancel() { cancelled.push(id); this.status = 'cancelled' },
        async persistCancelled() { persisted.push(id) },
        view() { return { runId: id, status: this.status } },
        report() { return { runId: id, status: this.status } }
      }
    }
  })

  await app.inject({ method: 'POST', url: '/api/runs', payload: { scenario: 'queue-test' } })
  await app.inject({ method: 'POST', url: '/api/runs', payload: { scenario: 'queue-test' } })
  const closing = app.close()
  let closed = false
  void closing.then(() => { closed = true })
  await new Promise(resolve => setImmediate(resolve))

  assert.deepEqual(cancelled, ['shutdown-2', 'shutdown-1'])
  assert.deepEqual(persisted, ['shutdown-2'])
  assert.equal(closed, false)

  activeGate.resolve()
  await closing
  assert.equal(closed, true)
})
