import type { Bot } from 'mineflayer'
import type { Item } from 'prismarine-item'
import type { GuiItemSnapshot, GuiSnapshot } from './types.js'

const MAX_GUI_ITEMS = 64
const MAX_LORE_LINES = 16
const MAX_TEXT_LENGTH = 256
const MAX_SELECTOR_LORE_LINES = 64
const MAX_SELECTOR_TEXT_LENGTH = 4_096
const MAX_COMPONENT_NODES = 512

function cleanGuiText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function componentText(
  value: unknown, seen: WeakSet<object>, depth: number, budget: { remaining: number }
): string {
  if (value === undefined || value === null || depth > 16) return ''
  if (typeof value === 'string') return value.slice(0, MAX_SELECTOR_TEXT_LENGTH)
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value).slice(0, MAX_SELECTOR_TEXT_LENGTH)
  }
  if (Array.isArray(value)) {
    if (budget.remaining-- <= 0) return ''
    let result = ''
    for (const item of value) {
      result += componentText(item, seen, depth + 1, budget).slice(0, MAX_SELECTOR_TEXT_LENGTH - result.length)
      if (result.length >= MAX_SELECTOR_TEXT_LENGTH) break
    }
    return result
  }
  if (!isRecord(value)) return ''
  if (budget.remaining-- <= 0) return ''

  if (seen.has(value)) return ''
  seen.add(value)
  try {
    const nbtType = value.type
    const nbtValue = value.value
    if (nbtType === 'string' && typeof nbtValue === 'string') {
      return nbtValue.slice(0, MAX_SELECTOR_TEXT_LENGTH)
    }
    if (nbtType === 'compound' && isRecord(nbtValue)) {
      return componentText(nbtValue, seen, depth + 1, budget)
    }
    if (nbtType === 'list' && isRecord(nbtValue) && Array.isArray(nbtValue.value)) {
      return componentText(nbtValue.value, seen, depth + 1, budget)
    }

    const toJson = value.toJSON
    if (typeof toJson === 'function') {
      try {
        const json = toJson.call(value)
        if (json !== value) {
          const decoded = componentText(json, seen, depth + 1, budget)
          if (decoded) return decoded
        }
      } catch {}
    }

    let result = ''
    const append = (text: string): void => {
      if (result.length < MAX_SELECTOR_TEXT_LENGTH) {
        result += text.slice(0, MAX_SELECTOR_TEXT_LENGTH - result.length)
      }
    }
    const text = value.text
    if (text !== undefined) append(componentText(text, seen, depth + 1, budget))

    const translate = value.translate
    const fallback = value.fallback
    const withArgs = value.with
    const fallbackText = componentText(fallback, seen, depth + 1, budget)
    const translateText = componentText(translate, seen, depth + 1, budget)
    if (fallbackText) append(fallbackText)
    else if (translateText) append(`${translateText}${withArgs !== undefined ? ' ' : ''}`)

    if (withArgs !== undefined) append(componentText(withArgs, seen, depth + 1, budget))

    const keybind = value.keybind
    if (keybind !== undefined) append(componentText(keybind, seen, depth + 1, budget))

    const selector = value.selector
    if (selector !== undefined) append(componentText(selector, seen, depth + 1, budget))

    const score = value.score
    if (isRecord(score)) {
      const scoreValue = score.value
      const scoreName = score.name
      if (typeof scoreValue === 'string') append(scoreValue)
      else if (typeof scoreName === 'string') append(scoreName)
    }

    for (const childKey of ['extra', 'children']) {
      const children = value[childKey]
      if (children !== undefined) append(componentText(children, seen, depth + 1, budget))
    }

    if (result) return result

    const customToString = value.toString
    if (typeof customToString === 'function' && customToString !== Object.prototype.toString) {
      try {
        const textValue = customToString.call(value)
        if (typeof textValue === 'string' && textValue !== '[object Object]') {
          return textValue.slice(0, MAX_SELECTOR_TEXT_LENGTH)
        }
      } catch {}
    }

    return ''
  } finally {
    seen.delete(value)
  }
}

function guiText(value: unknown): string {
  try {
    return cleanGuiText(componentText(
      value, new WeakSet<object>(), 0, { remaining: MAX_COMPONENT_NODES }
    ))
  } catch {
    return ''
  }
}

export function sanitizeGuiText(value: unknown): string {
  return guiText(value).slice(0, MAX_TEXT_LENGTH)
}

function snapshotItem(item: Item, inventoryStart: number): GuiItemSnapshot {
  const extended = item as Item & { customName?: unknown; customLore?: unknown[]; components?: unknown }
  const customName = extended.customName ? guiText(extended.customName) : undefined
  const customLore: unknown = extended.customLore
  return {
    slot: item.slot,
    section: item.slot < inventoryStart ? 'top' : 'player',
    material: item.name,
    displayName: guiText(item.displayName),
    ...(customName ? { customName } : {}),
    lore: Array.isArray(customLore) ? customLore.slice(0, MAX_SELECTOR_LORE_LINES).map(guiText) : [],
    count: item.count
  }
}

export function snapshotGui(bot: Bot): GuiSnapshot | null {
  const window = bot.currentWindow
  if (!window) return null
  const totalSlotCount = window.slots.length
  const reportedInventoryStart = Number(window.inventoryStart)
  const inventoryStart = Number.isInteger(reportedInventoryStart)
    && reportedInventoryStart >= 0
    && reportedInventoryStart <= totalSlotCount
    ? reportedInventoryStart
    : totalSlotCount
  return {
    id: window.id,
    type: String(window.type),
    title: guiText(window.title),
    topSlotCount: inventoryStart,
    totalSlotCount,
    inventoryStart,
    slotCount: totalSlotCount,
    items: window.slots.filter((item): item is Item => item !== null)
      .map(item => snapshotItem(item, inventoryStart))
  }
}

export function boundedGuiSnapshot(gui: GuiSnapshot): GuiSnapshot {
  return { ...gui, title: sanitizeGuiText(gui.title), items: boundedGuiItems(gui.items) }
}

export function boundedGuiItems(items: GuiItemSnapshot[]): GuiItemSnapshot[] {
  return items.slice(0, MAX_GUI_ITEMS).map(item => ({
    ...item,
    material: sanitizeGuiText(item.material),
    displayName: sanitizeGuiText(item.displayName),
    ...(item.customName ? { customName: sanitizeGuiText(item.customName) } : {}),
    lore: item.lore.slice(0, MAX_LORE_LINES).map(sanitizeGuiText)
  }))
}

export function itemSearchText(item: GuiItemSnapshot): string {
  return [item.material, item.displayName, item.customName].filter(Boolean).join('\n').toLocaleLowerCase()
}

export function formatGuiSnapshot(gui: GuiSnapshot): string {
  const rows = gui.items.map(item => {
    const name = item.customName || item.displayName || item.material
    const lore = item.lore.length > 0 ? ` | ${item.lore.join(' / ')}` : ''
    return `[${String(item.slot).padStart(2, '0')}] ${item.count}x ${item.material} | ${name}${lore}`
  })
  return [
    `+ GUI #${gui.id}: ${gui.title} (${gui.type}, ${gui.topSlotCount} top / ${gui.totalSlotCount} total)`,
    ...(rows.length > 0 ? rows : ['(no visible items)']),
    '+ END GUI'
  ].join('\n')
}
