import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from '../src/server.js'
import { resolveApiCredential, resolveMinecraftAuth } from '../src/config.js'

const CREDENTIAL = 'test-credential-abcdefghijklmnop'

function serverWithCredential() {
  return createServer({
    logger: false,
    apiCredential: CREDENTIAL,
    runFactory: () => { throw new Error('runFactory must not be reached') }
  })
}

test('mọi route /api từ chối request thiếu credential', async t => {
  const app = serverWithCredential()
  t.after(() => app.close())

  const routes = [
    { method: 'GET' as const, url: '/api/scenarios' },
    { method: 'POST' as const, url: '/api/runs', payload: { scenario: 'queue-test' } },
    { method: 'GET' as const, url: '/api/runs/some-id' },
    { method: 'GET' as const, url: '/api/runs/some-id/report' },
    { method: 'POST' as const, url: '/api/runs/some-id/cancel' }
  ]

  for (const route of routes) {
    const response = await app.inject(route)
    assert.equal(response.statusCode, 401, `${route.method} ${route.url} phải trả 401`)
    assert.equal(response.json().error, 'Unauthorized')
    assert.equal(response.body.includes(CREDENTIAL), false, 'không được phản chiếu credential')
  }
})

test('credential sai bị từ chối, credential đúng được đi qua', async t => {
  const app = serverWithCredential()
  t.after(() => app.close())

  const wrong = await app.inject({
    method: 'GET', url: '/api/scenarios',
    headers: { authorization: `Bearer ${CREDENTIAL}x` }
  })
  assert.equal(wrong.statusCode, 401)

  const right = await app.inject({
    method: 'GET', url: '/api/scenarios',
    headers: { authorization: `Bearer ${CREDENTIAL}` }
  })
  assert.equal(right.statusCode, 200)
  assert.ok(Array.isArray(right.json().scenarios))
})

test('/health không cần credential nhưng không lộ chi tiết run', async t => {
  const app = serverWithCredential()
  t.after(() => app.close())

  const response = await app.inject({ method: 'GET', url: '/health' })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().ok, true)
})

test('scenario không tồn tại trả 404 và không lộ filesystem path', async t => {
  const app = createServer({
    logger: false,
    apiCredential: CREDENTIAL,
    scenarioLoader: async () => {
      const error = new Error(
        "ENOENT: no such file or directory, open 'E:\\AI.WORK\\botcheckerminecraft-botchecker\\scenarios\\nope.json'"
      ) as NodeJS.ErrnoException
      error.code = 'ENOENT'
      throw error
    },
    runFactory: () => { throw new Error('runFactory must not be reached') }
  })
  t.after(() => app.close())

  const response = await app.inject({
    method: 'POST', url: '/api/runs',
    headers: { authorization: `Bearer ${CREDENTIAL}` },
    payload: { scenario: 'nope' }
  })

  assert.equal(response.statusCode, 404)
  assert.equal(response.json().error, 'Scenario not found')
  assert.equal(/[A-Za-z]:\\|ENOENT|AI\.WORK/.test(response.body), false,
    `body không được lộ path: ${response.body}`)
})

test('lỗi không xác định trả thông điệp cố định, không phản chiếu message', async t => {
  const app = createServer({
    logger: false,
    apiCredential: CREDENTIAL,
    scenarioLoader: async () => { throw new Error('internal detail leaked/secret/path') },
    runFactory: () => { throw new Error('runFactory must not be reached') }
  })
  t.after(() => app.close())

  const response = await app.inject({
    method: 'POST', url: '/api/runs',
    headers: { authorization: `Bearer ${CREDENTIAL}` },
    payload: { scenario: 'boom' }
  })

  assert.equal(response.statusCode, 500)
  assert.equal(response.json().error, 'Internal error')
  assert.equal(response.body.includes('internal detail leaked'), false)
})

test('resolveApiCredential fail-closed với host non-loopback không credential', () => {
  assert.equal(resolveApiCredential('127.0.0.1', undefined), undefined)
  assert.equal(resolveApiCredential('::1', undefined), undefined)
  assert.equal(resolveApiCredential('localhost', undefined), undefined)
  assert.equal(resolveApiCredential('0.0.0.0', CREDENTIAL), CREDENTIAL)

  assert.throws(() => resolveApiCredential('0.0.0.0', undefined), /API_CREDENTIAL/)
  assert.throws(() => resolveApiCredential('192.168.1.10', undefined), /API_CREDENTIAL/)
  assert.throws(() => resolveApiCredential('0.0.0.0', 'short'), /API_CREDENTIAL/)
})

test('resolveMinecraftAuth chỉ nhận offline hoặc microsoft', () => {
  assert.equal(resolveMinecraftAuth(undefined), 'offline')
  assert.equal(resolveMinecraftAuth('offline'), 'offline')
  assert.equal(resolveMinecraftAuth('microsoft'), 'microsoft')

  for (const invalid of ['Microsoft', 'MICROSOFT', 'msa', 'mojang', '']) {
    assert.throws(() => resolveMinecraftAuth(invalid), /MC_AUTH/,
      `MC_AUTH=${JSON.stringify(invalid)} phải bị từ chối`)
  }
})

test('runs map bị evict sau khi vượt bound retention', async t => {
  const finished = new Set<string>()
  let counter = 0
  const app = createServer({
    logger: false,
    apiCredential: CREDENTIAL,
    queueCapacity: 64,
    maxRetainedRuns: 4,
    scenarioLoader: async () => ({ name: 'queue-test', steps: [] } as never),
    runFactory: () => {
      const id = `run-${counter += 1}`
      finished.add(id)
      return {
        id, status: 'passed' as const,
        start: async () => {}, cancel: () => {},
        persistCancelled: async () => {},
        view: () => ({ id }), report: () => ({ id })
      }
    }
  })
  t.after(() => app.close())

  const ids: string[] = []
  for (let index = 0; index < 10; index += 1) {
    const response = await app.inject({
      method: 'POST', url: '/api/runs',
      headers: { authorization: `Bearer ${CREDENTIAL}` },
      payload: { scenario: 'queue-test' }
    })
    assert.equal(response.statusCode, 202)
    ids.push(response.json().runId)
  }

  const oldest = await app.inject({
    method: 'GET', url: `/api/runs/${ids[0]}`,
    headers: { authorization: `Bearer ${CREDENTIAL}` }
  })
  assert.equal(oldest.statusCode, 404, 'run cũ nhất phải bị evict')

  const newest = await app.inject({
    method: 'GET', url: `/api/runs/${ids[ids.length - 1]}`,
    headers: { authorization: `Bearer ${CREDENTIAL}` }
  })
  assert.equal(newest.statusCode, 200, 'run mới nhất phải còn')
})
