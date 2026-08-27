import { evaluateGuiInteraction, type GuiClickObservation, type GuiEvaluation, type GuiInteractionInput, type GuiItemObservation } from './gui-contract.js'

export interface GuiRunnerInput extends Omit<GuiInteractionInput, 'before' | 'click' | 'after'> {
  before: () => Promise<GuiItemObservation>
  click: () => Promise<GuiClickObservation>
  after: () => Promise<GuiItemObservation>
}

export async function runGuiInteraction(input: GuiRunnerInput): Promise<GuiEvaluation> {
  try {
    const before = await input.before()
    const click = await input.click()
    const after = await input.after()
    return evaluateGuiInteraction({ ...input, before, click, after })
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 128) : 'provider failed'
    return { verdict: 'INCONCLUSIVE', message: `INCONCLUSIVE_GUI_PROVIDER: ${detail}`, evidence: { expectedTitle: input.expectedTitle, expectedSlot: input.expectedSlot, expectedMaterial: input.expectedMaterial, expectedClick: input.expectedClick } }
  }
}
