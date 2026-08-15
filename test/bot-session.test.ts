import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { BotSession, waitForSpawn } from '../src/bot-session.js'

class FakeBot extends EventEmitter {
  currentWindow: object | null = { id: 7 }
  stops = 0
  closes = 0
  quits = 0
  pathfinder = { stop: () => { this.stops++ } }

  closeWindow(): void {
    this.closes++
    this.currentWindow = null
  }

  quit(): void {
    this.quits++
    queueMicrotask(() => this.emit('end', 'quit'))
  }
}

test('cleanup stops movement, closes GUI, removes owned listeners and waits for disconnect exactly once', async () => {
  const bot = new FakeBot()
  const session = new BotSession(bot, 100)
  let messages = 0
  session.on('messagestr', () => { messages++ })

  bot.emit('messagestr', 'before')
  await Promise.all([session.cleanup('done'), session.cleanup('again')])
  bot.emit('messagestr', 'after')

  assert.equal(messages, 1)
  assert.equal(bot.stops, 1)
  assert.equal(bot.closes, 1)
  assert.equal(bot.quits, 1)
  assert.equal(bot.listenerCount('messagestr'), 0)
  assert.equal(bot.listenerCount('end'), 0)
})

test('cleanup is bounded when the bot never emits end', async () => {
  const bot = new FakeBot()
  bot.quit = () => { bot.quits++ }
  const session = new BotSession(bot, 10)
  const started = Date.now()

  await session.cleanup('timeout')

  assert.equal(bot.quits, 1)
  assert.ok(Date.now() - started < 200)
  assert.equal(bot.listenerCount('end'), 0)
})

test('cleanup keeps the disconnect timeout referenced while the bot never emits end', async () => {
  const bot = new FakeBot()
  bot.quit = () => { bot.quits++ }
  const session = new BotSession(bot, 50)

  const originalSetTimeout = globalThis.setTimeout
  const scheduled: NodeJS.Timeout[] = []
  globalThis.setTimeout = ((callback: (...args: any[]) => void, ms?: number, ...args: any[]) => {
    const handle = originalSetTimeout(callback, ms, ...args)
    scheduled.push(handle)
    return handle
  }) as typeof setTimeout
  try {
    const pending = session.cleanup('timeout')
    assert.equal(scheduled.length, 1)
    assert.equal(typeof scheduled[0].hasRef, 'function')
    assert.equal(scheduled[0].hasRef(), true)
    await pending
  } finally {
    globalThis.setTimeout = originalSetTimeout
  }

  assert.equal(bot.quits, 1)
})

test('waitForSpawn rejects on kick and removes every temporary listener', async () => {
  const bot = new FakeBot()
  const waiting = waitForSpawn(bot, new AbortController().signal)

  bot.emit('kicked', 'denied')

  await assert.rejects(waiting, /Kicked: denied/)
  for (const event of ['spawn', 'error', 'kicked', 'end']) assert.equal(bot.listenerCount(event), 0)
})

test('waitForSpawn aborts and removes every temporary listener', async () => {
  const bot = new FakeBot()
  const controller = new AbortController()
  const waiting = waitForSpawn(bot, controller.signal)

  controller.abort(new Error('connect timeout'))

  await assert.rejects(waiting, /connect timeout/)
  for (const event of ['spawn', 'error', 'kicked', 'end']) assert.equal(bot.listenerCount(event), 0)
})
