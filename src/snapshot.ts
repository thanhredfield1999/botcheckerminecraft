import type { Bot } from 'mineflayer'
import type { Item } from 'prismarine-item'
import type { GuiItemSnapshot, GuiSnapshot } from './types.js'

const MAX_GUI_ITEMS = 64
const MAX_LORE_LINES = 16
const MAX_TEXT_LENGTH = 256

function guiText(value: unknown): string {
  if (value === undefined || value === null) return ''
  try {
    const raw = typeof value === 'string'
      ? value
      : typeof value === 'object' && 'toString' in value && typeof value.toString === 'function'
        ? value.toString()
        : String(value)
    return raw.replace(/[\u0000-\u001f\u007f]/g, ' ')
  } catch {
    return ''
  }
}

export function sanitizeGuiText(value: unknown): string {
  return guiText(value).slice(0, MAX_TEXT_LENGTH)
}

function snapshotItem(item: Item): GuiItemSnapshot {
  const extended = item as Item & { customName?: unknown; customLore?: unknown[]; components?: unknown }
  const customName = extended.customName ? guiText(extended.customName) : undefined
  const customLore: unknown = extended.customLore
  return {
    slot: item.slot,
    material: item.name,
    displayName: guiText(item.displayName),
    ...(customName ? { customName } : {}),
    lore: Array.isArray(customLore) ? customLore.map(guiText) : [],
    count: item.count
  }
}

export function snapshotGui(bot: Bot): GuiSnapshot | null {
  const window = bot.currentWindow
  if (!window) return null
  return {
    id: window.id,
    type: String(window.type),
    title: guiText(window.title),
    slotCount: window.slots.length,
    items: window.slots.filter((item): item is Item => item !== null).map(snapshotItem)
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
    `+ GUI #${gui.id}: ${gui.title} (${gui.type}, ${gui.slotCount} slots)`,
    ...(rows.length > 0 ? rows : ['(no visible items)']),
    '+ END GUI'
  ].join('\n')
}
