# BotChecker AI vision evaluation (assert_vision)

Status: 2026-09-19 — implemented + focused tests green; full gate running. Fail-closed by design:
without configuration, `assert_vision` yields INCONCLUSIVE and never fabricates a verdict.

## Purpose

BotChecker is a headless protocol client — it has no real client screen. To evaluate the
PLAYER-VISIBLE state with an AI vision model, BotChecker renders what it actually observes
(GUI title + slots + item names/lore) into a deterministic PNG frame, then asks an
OpenAI-compatible vision API to judge it against a scenario-provided prompt.

## Configuration (env only — no key in repo/scenarios/reports)

| Env | Bắt buộc | Mô tả |
|---|---|---|
| `BOTCHECKER_VISION_BASE_URL` | có (để bật) | base URL, phải https (hoặc loopback http test) |
| `BOTCHECKER_VISION_MODEL` | có (để bật) | tên model vision |
| `BOTCHECKER_VISION_API_KEY_ENV` | mặc định `BOTCHECKER_VISION_API_KEY` | TÊN env var chứa key — key chỉ đọc lúc chạy từ process.env |
| `BOTCHECKER_VISION_TIMEOUT_MS` | mặc định 60000 | timeout request |
| `BOTCHECKER_VISION_MAX_RESPONSE_BYTES` | mặc định 65536 | cap response |

The server wires the evaluator only when BASE_URL + MODEL are set. The API key is read from
`process.env[BOTCHECKER_VISION_API_KEY_ENV]` at request time and never leaves the Node process:
it is not in the HTTP body, report, evidence, or repository.

## Scenario step

```json
{ "id": "menu_dung", "action": "assert_vision",
  "prompt": "Trong ảnh có menu 'ItemGuard - Recorded item history' với item 'Diamond Sword' khong?",
  "expectVerdict": "PASS",
  "requiresGui": true,
  "timeoutMs": 30000 }
```

- `prompt`: câu hỏi đánh giá (1..2000 ký tự) — gửi cùng ảnh.
- `expectVerdict` (default `PASS`): verdict kỳ vọng; step PASS khi API trả đúng verdict này.
- `requiresGui` (default true): chờ một GUI mở trước khi chụp; false cho phép frame không có GUI.
- `timeoutMs` (default 30000, max 120000).

## Fail-closed

- Không wire evaluator (thiếu config) → `INCONCLUSIVE_VISION_NOT_CONFIGURED`.
- Không có GUI mở (khi requiresGui) → `INCONCLUSIVE_VISION_GUI_CLOSED`.
- Không key env / key ngắn → INCONCLUSIVE (`VISION_INCONCLUSIVE_API_NOT_CONFIGURED`).
- HTTP lỗi → `VISION_HTTP_ERROR`; response sai dạng → `VISION_MALFORMED_RESPONSE`;
  verdict lạ → `VISION_INVALID_VERDICT`; oversize → INCONCLUSIVE.
- Lý do từ API được sanitize (bounded, printable); feature evidence chỉ ghi SHA-256 của frame,
  không lưu ảnh/key.

## Evidence

Step evidence: `{ prompt, expected, verdict, code, reason, framePngSha256 }` — bounded,
không chứa API key. Frame PNG deterministic (title + slots ASCII-fold, font 5x7) ở
`src/vision-frame.ts`; evaluator OpenAI-compatible ở `src/vision-evaluator.ts`.

## Files

- `src/vision-frame.ts` — render GUI snapshot → PNG (zlib-only, no dependency).
- `src/vision-evaluator.ts` — OpenAI-compatible vision call, bounded + sanitized.
- `src/scenario.ts`, `src/runner.ts` — step `assert_vision` + execution.
- `src/config.ts`, `src/server.ts` — env config + wiring.
- `test/vision-evaluator.test.ts`, `test/vision-runner.test.ts` — focused tests.