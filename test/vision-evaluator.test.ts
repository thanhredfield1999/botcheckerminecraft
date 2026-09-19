import assert from 'node:assert/strict'
import test from 'node:test'
import {
  asciiFold,
  renderWindowFramePng,
  type WindowFrameSlot
} from '../src/vision-frame.js'
import {
  VISION_INCONCLUSIVE_API_NOT_CONFIGURED,
  createVisionEvaluator,
  type VisionEvaluatorConfig,
  type VisionEvaluatorResult
} from '../src/vision-evaluator.js'

function frameSlots(): readonly WindowFrameSlot[] {
  return Object.freeze([
    Object.freeze({ slot: 0, name: 'Diamond Sword', count: 1, lore: Object.freeze(['Sharpness V', 'ID: a1b2c3']) }),
    Object.freeze({ slot: 1, name: 'Stone', count: 64, lore: Object.freeze([]) })
  ])
}

function config(overrides: Partial<VisionEvaluatorConfig> = {}): VisionEvaluatorConfig {
  return {
    apiKeyEnvVariable: 'BOTCHECKER_VISION_TEST_KEY',
    baseUrl: 'https://example.invalid/v1',
    model: 'vision-test-model',
    timeoutMs: 10_000,
    maxResponseBytes: 64 * 1024,
    ...overrides
  }
}

test('renderWindowFramePng sinh PNG hợp lệ và deterministic', () => {
  const a = renderWindowFramePng({ title: 'ItemGuard - Recorded item history', slots: frameSlots() })
  const b = renderWindowFramePng({ title: 'ItemGuard - Recorded item history', slots: frameSlots() })
  assert.ok(a.byteLength > 100, 'PNG phải có kích thước đáng kể')
  assert.deepEqual(a, b, 'cùng input phải cho cùng bytes (deterministic)')
  // PNG signature 8 bytes chuẩn.
  assert.deepEqual([...a.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  // Phải chứa chunk IHDR + IDAT + IEND.
  const text = a.toString('latin1')
  assert.ok(text.includes('IHDR'))
  assert.ok(text.includes('IDAT'))
  assert.ok(text.includes('IEND'))
})

test('asciiFold giữ chữ ASCII và gấp dấu tiếng Việt an toàn', () => {
  assert.equal(asciiFold('Đá quý §6Vàng'), 'Da quy Vang')
  assert.equal(asciiFold('ABC abc 123'), 'ABC abc 123')
  assert.equal(asciiFold('₿\u0000\x01'), '???')
})

test('createVisionEvaluator fail-closed khi thiếu API key', async () => {
  const evaluator = createVisionEvaluator({
    config: config(),
    fetchImpl: async () => { throw new Error('không được gọi khi thiếu key') }
  })
  const result: VisionEvaluatorResult = await evaluator.evaluate({
    pngBase64: Buffer.from(renderWindowFramePng({ title: 'T', slots: frameSlots() })).toString('base64'),
    prompt: 'Có menu ItemGuard đang mở không?'
  }, { apiKey: undefined })
  assert.equal(result.verdict, 'INCONCLUSIVE')
  assert.equal(result.code, VISION_INCONCLUSIVE_API_NOT_CONFIGURED)
})

test('createVisionEvaluator gọi API OpenAI-compatible và parse verdict PASS', async () => {
  let capturedUrl = ''
  let capturedBody: unknown
  const evaluator = createVisionEvaluator({
    config: config(),
    fetchImpl: async (url: unknown, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          verdict: 'PASS', reason: 'Menu ItemGuard hiển thị đúng', matched: ['title'], missing: []
        }) } }]
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
  })
  const pngBase64 = Buffer.from(renderWindowFramePng({ title: 'T', slots: frameSlots() })).toString('base64')
  const result = await evaluator.evaluate({ pngBase64, prompt: 'Có menu không?' }, { apiKey: 'test-key-12345' })
  assert.equal(result.verdict, 'PASS')
  assert.equal(capturedUrl, 'https://example.invalid/v1/chat/completions')
  const body = capturedBody as { model: string, messages: { content: Array<{ type?: string, text?: string, image_url?: { url: string } }> }[] }
  assert.equal(body.model, 'vision-test-model')
  assert.ok(!JSON.stringify(body).includes('test-key-12345'), 'key không được lọt vào body')
  const content = body.messages[0].content
  assert.ok(content.some(part => part.type === 'text' && String(part.text).includes('Có menu không?')))
  assert.ok(content.some(part => part.type === 'image_url' && part.image_url?.url.startsWith('data:image/png;base64,')))
})

test('createVisionEvaluator báo FAIL khi AI kết luận FAIL và INCONCLUSIVE khi response sai dạng', async () => {
  const failEvaluator = createVisionEvaluator({
    config: config(),
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ verdict: 'FAIL', reason: 'title sai', matched: [], missing: ['title'] }) } }]
    }), { status: 200 })
  })
  const failResult = await failEvaluator.evaluate({
    pngBase64: 'cG5n', prompt: 'kiểm tra'
  }, { apiKey: 'test-key-12345' })
  assert.equal(failResult.verdict, 'FAIL')

  const malformedEvaluator = createVisionEvaluator({
    config: config(),
    fetchImpl: async () => new Response('không phải json', { status: 200 })
  })
  const malformed = await malformedEvaluator.evaluate({
    pngBase64: 'cG5n', prompt: 'kiểm tra'
  }, { apiKey: 'test-key-12345' })
  assert.equal(malformed.verdict, 'INCONCLUSIVE')
  assert.equal(malformed.code, 'VISION_MALFORMED_RESPONSE')

  const httpErrorEvaluator = createVisionEvaluator({
    config: config(),
    fetchImpl: async () => new Response('quota', { status: 429 })
  })
  const httpError = await httpErrorEvaluator.evaluate({
    pngBase64: 'cG5n', prompt: 'kiểm tra'
  }, { apiKey: 'test-key-12345' })
  assert.equal(httpError.verdict, 'INCONCLUSIVE')
  assert.equal(httpError.code, 'VISION_HTTP_ERROR')
})

test('createVisionEvaluator reject config URL/chars và prompt quá dài', () => {
  assert.throws(() => createVisionEvaluator({ config: config({ baseUrl: 'http://insecure.example/v1' }) }))
  assert.throws(() => createVisionEvaluator({ config: config({ model: 'bad model name!' }) }))
})