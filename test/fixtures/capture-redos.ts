import { TestRun } from '../../src/runner.js'
import { scenarioSchema } from '../../src/scenario.js'

// Subprocess do test sở hữu, không kết nối server và không ghi report.
const scenario = scenarioSchema.parse({ name: 'regex-budget', steps: [
  { id: 'capture', action: 'capture', name: 'code', pattern: '^(a+)+$', source: 'chat' }
] })
const run = new TestRun(scenario, {
  host: 'localhost', port: 25565, username: 'offline-fixture', auth: 'offline'
}, '.')
run.bot = {} as never
run.events.push({ at: new Date().toISOString(), elapsedMs: 0,
  type: 'chat', summary: `${'a'.repeat(40)}!` })
const seam = run as unknown as {
  executeStep(step: unknown, signal: AbortSignal, cursor: number): Promise<unknown>
}
try {
  await seam.executeStep(scenario.steps[0], new AbortController().signal, 0)
  throw new Error('Unsafe regex unexpectedly completed')
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (!message.startsWith('INCONCLUSIVE_CAPTURE_PATTERN:')) throw error
  console.log(message)
}
