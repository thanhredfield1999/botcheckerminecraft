/**
 * AI vision evaluator — library-only, fail-closed.
 *
 * Nhận một frame PNG (do `vision-frame.ts` render từ trạng thái client mà
 * BotChecker quan sát được) và một prompt đánh giá, gửi tới một endpoint
 * OpenAI-compatible vision API, rồi parse verdict PASS/FAIL/INCONCLUSIVE.
 *
 * An toàn:
 * - API key CHỈ được đọc từ `process.env[apiKeyEnvVariable]` tại thời điểm gọi;
 *   key không bao giờ được nhận literal, không vào body request, không vào
 *   evidence, không vào log.
 * - Không có key -> INCONCLUSIVE (VISION_INCONCLUSIVE_API_NOT_CONFIGURED) chứ
 *   không tự bịa verdict.
 * - baseUrl bắt buộc https (hoặc http-loopback cho test/controlled).
 * - Response giới hạn `maxResponseBytes`; non-200, malformed JSON, verdict lạ
 *   đều thành INCONCLUSIVE với mã lỗi cố định, không lộ nội dung provider.
 * - Không spawn, không đọc file, không import runtime server — thuần fetch
 *   library có thể bị inject ở test.
 */
import { z } from 'zod'

export const VISION_INCONCLUSIVE_API_NOT_CONFIGURED = 'VISION_INCONCLUSIVE_API_NOT_CONFIGURED'
export const VISION_HTTP_ERROR = 'VISION_HTTP_ERROR'
export const VISION_MALFORMED_RESPONSE = 'VISION_MALFORMED_RESPONSE'
export const VISION_INVALID_VERDICT = 'VISION_INVALID_VERDICT'

export interface VisionEvaluatorConfig {
  /** Tên env var chứa API key; key KHÔNG bao giờ được truyền literal. */
  readonly apiKeyEnvVariable: string
  readonly baseUrl: string
  readonly model: string
  readonly timeoutMs: number
  readonly maxResponseBytes: number
  /** Endpoint đường dẫn tương đối, mặc định /chat/completions. */
  readonly endpoint?: string
}

export interface VisionEvaluationInput {
  readonly pngBase64: string
  readonly prompt: string
}

export interface VisionEvaluatorResult {
  readonly verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'
  readonly code: string
  readonly reason: string
}

export interface VisionEvaluatorOptions {
  readonly config: VisionEvaluatorConfig
  readonly fetchImpl?: typeof fetch
  readonly nowMs?: () => number
  readonly randomBytes?: (size: number) => Uint8Array
}

const verifierSchema = z.object({
  verdict: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']),
  reason: z.string().max(512).default('')
}).passthrough()

function sanitizeReason(value: string): string {
  // Chỉ giữ ASCII printable + a few separators; chặn ký tự điều khiển đẩy log/evidence lệch.
  return value.normalize('NFC').replace(/[^\x20-\x7E\u00C0-\u024F]/g, ' ').trim().slice(0, 512)
}

function isLoopbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    return true
  } catch {
    return false
  }
}

export function createVisionEvaluator(options: VisionEvaluatorOptions) {
  const config = options.config
  const fetchImpl = options.fetchImpl ?? fetch

  if (typeof config.apiKeyEnvVariable !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(config.apiKeyEnvVariable)) {
    throw new Error('Vision API key environment variable is invalid')
  }
  if (typeof config.baseUrl !== 'string' || !isLoopbackUrl(config.baseUrl)) {
    throw new Error('Vision API base URL must be https (hoặc loopback http cho test)')
  }
  if (typeof config.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:\/-]{0,127}$/.test(config.model)) {
    throw new Error('Vision API model name is invalid')
  }
  if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 120_000) {
    throw new Error('Vision API timeout is invalid')
  }
  if (!Number.isSafeInteger(config.maxResponseBytes) || config.maxResponseBytes < 1 || config.maxResponseBytes > 4 * 1024 * 1024) {
    throw new Error('Vision API max response bytes is invalid')
  }

  return Object.freeze({
    async evaluate(input: VisionEvaluationInput, auth: { readonly apiKey: string | undefined }): Promise<VisionEvaluatorResult> {
      const prompt = typeof input.prompt === 'string' && input.prompt.length > 0 && input.prompt.length <= 4000
        ? input.prompt
        : 'Kiem tra trang thai GUI va ket luan PASS/FAIL/INCONCLUSIVE.'
      const pngBase64 = typeof input.pngBase64 === 'string' && input.pngBase64.length > 0
        && input.pngBase64.length <= 4 * 1024 * 1024
        ? input.pngBase64
        : null

      const apiKey = auth.apiKey
      if (!apiKey || apiKey.length < 8) {
        return Object.freeze({
          verdict: 'INCONCLUSIVE' as const,
          code: VISION_INCONCLUSIVE_API_NOT_CONFIGURED,
          reason: 'Vision API key chua duoc cau hinh'
        })
      }
      if (pngBase64 === null) {
        return Object.freeze({
          verdict: 'INCONCLUSIVE' as const,
          code: VISION_MALFORMED_RESPONSE,
          reason: 'Frame PNG khong hop le hoac qua lon'
        })
      }

      const endpoint = (config.endpoint ?? '/chat/completions').startsWith('/')
        ? (config.endpoint ?? '/chat/completions')
        : `/${config.endpoint ?? 'chat/completions'}`
      const url = `${config.baseUrl.replace(/\/+$/, '')}${endpoint}`
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), config.timeoutMs)

      let response: Response
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: config.model,
            temperature: 0,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: `data:image/png;base64,${pngBase64}` } }
              ]
            }]
          }),
          signal: controller.signal
        })
      } catch {
        return Object.freeze({
          verdict: 'INCONCLUSIVE' as const,
          code: VISION_HTTP_ERROR,
          reason: 'Vision API khong tra loi duoc'
        })
      } finally {
        clearTimeout(timer)
      }

      if (!response.ok) {
        return Object.freeze({
          verdict: 'INCONCLUSIVE' as const,
          code: VISION_HTTP_ERROR,
          reason: `Vision API HTTP ${response.status}`
        })
      }

      let bodyText: string
      try {
        const buffer = await response.arrayBuffer()
        if (buffer.byteLength > config.maxResponseBytes) {
          throw new Error('oversized')
        }
        bodyText = Buffer.from(buffer).toString('utf8')
      } catch {
        return Object.freeze({
          verdict: 'INCONCLUSIVE' as const,
          code: VISION_MALFORMED_RESPONSE,
          reason: 'Vision API response vuot gioi han'
        })
      }

      let content: string | undefined
      try {
        const body = JSON.parse(bodyText) as { choices?: { message?: { content?: unknown } }[] }
        const raw = body.choices?.[0]?.message?.content
        content = typeof raw === 'string' ? raw : undefined
      } catch {
        content = undefined
      }
      if (content === undefined) {
        return Object.freeze({
          verdict: 'INCONCLUSIVE' as const,
          code: VISION_MALFORMED_RESPONSE,
          reason: 'Vision API khong tra ve content hop le'
        })
      }

      let parsed: z.infer<typeof verifierSchema>
      try {
        parsed = verifierSchema.parse(JSON.parse(content))
      } catch {
        return Object.freeze({
          verdict: 'INCONCLUSIVE' as const,
          code: VISION_INVALID_VERDICT,
          reason: 'Verdict tu Vision API khong hop le'
        })
      }

      return Object.freeze({
        verdict: parsed.verdict,
        code: parsed.verdict,
        reason: sanitizeReason(parsed.reason)
      })
    }
  })
}