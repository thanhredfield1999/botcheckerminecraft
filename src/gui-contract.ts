export type GuiVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE'

export interface GuiItemObservation {
  title: string
  slot: number
  material: string
  displayName: string
  count: number
}

export interface GuiClickObservation {
  performed: boolean
  button: 'left' | 'right'
}

export interface GuiInteractionInput {
  expectedTitle: string
  expectedSlot: number
  expectedMaterial: string
  expectedClick: 'left' | 'right'
  before?: GuiItemObservation
  click?: GuiClickObservation
  after?: GuiItemObservation
  evidence: Record<string, unknown>
}

export interface GuiEvaluation {
  verdict: GuiVerdict
  message: string
  evidence: {
    expectedTitle: string
    expectedSlot: number
    expectedMaterial: string
    expectedClick: 'left' | 'right'
    clicked?: boolean
    beforeCount?: number
    afterCount?: number
  }
}

const CREDENTIAL_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key)/i
const MAX_EVIDENCE_BYTES = 8_192

export function evaluateGuiInteraction(input: GuiInteractionInput): GuiEvaluation {
  validateInput(input)
  const base = { expectedTitle: input.expectedTitle, expectedSlot: input.expectedSlot, expectedMaterial: input.expectedMaterial, expectedClick: input.expectedClick }
  if (!input.before || !input.click || !input.after) return { verdict: 'INCONCLUSIVE', message: 'INCONCLUSIVE_GUI_EVIDENCE: before, click or after observation missing', evidence: base }
  const evidence = { ...base, clicked: input.click.performed, beforeCount: input.before.count, afterCount: input.after.count }
  if (input.before.title !== input.expectedTitle || input.after.title !== input.expectedTitle) return { verdict: 'FAIL', message: 'GUI title did not match expected title', evidence }
  if (input.before.slot !== input.expectedSlot || input.before.material !== input.expectedMaterial) return { verdict: 'FAIL', message: 'GUI target item did not match expected slot or material', evidence }
  if (!input.click.performed || input.click.button !== input.expectedClick) return { verdict: 'FAIL', message: 'GUI click was not performed as expected', evidence }
  if (input.after.count >= input.before.count) return { verdict: 'FAIL', message: 'GUI click caused no observable item state change', evidence }
  return { verdict: 'PASS', message: 'GUI target and click effect matched expected observation', evidence }
}

function validateInput(input: GuiInteractionInput): void {
  validateText(input.expectedTitle, 'GUI title')
  validateText(input.expectedMaterial, 'GUI material')
  if (!Number.isInteger(input.expectedSlot) || input.expectedSlot < 0 || input.expectedSlot >  upperSlot()) throw new Error('Invalid GUI slot')
  if (!['left', 'right'].includes(input.expectedClick)) throw new Error('Invalid GUI click button')
  const serialized = JSON.stringify(input.evidence)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_EVIDENCE_BYTES) throw new Error('GUI evidence exceeds bounded payload')
  if (CREDENTIAL_PATTERN.test(serialized)) throw new Error('Credential-like GUI evidence rejected')
  for (const [label, item] of [['before', input.before], ['after', input.after]] as const) {
    if (item) {
      validateText(item.title, `${label} GUI title`)
      validateText(item.material, `${label} GUI material`)
      validateText(item.displayName, `${label} GUI display name`)
      if (!Number.isInteger(item.slot) || item.slot < 0 || item.slot > upperSlot()) throw new Error(`Invalid ${label} GUI slot`)
      if (!Number.isInteger(item.count) || item.count < 0) throw new Error(`Invalid ${label} GUI count`)
    }
  }
}

function upperSlot(): number { return 53 }
function validateText(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 256) throw new Error(`Invalid ${label}`)
  if (CREDENTIAL_PATTERN.test(value)) throw new Error(`Credential-like ${label} rejected`)
}

void CREDENTIAL_PATTERN
