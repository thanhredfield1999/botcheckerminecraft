import type { Bot } from 'mineflayer'
import type { Item } from 'prismarine-item'
import type { GuiItemSnapshot, GuiSnapshot } from './types.js'

function text(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'toString' in value && typeof value.toString === 'function') return value.toString()
  return String(value)
}

function snapshotItem(item: Item): GuiItemSnapshot {
  const extended = item as Item & { customName?: unknown; customLore?: unknown[]; components?: unknown }
  return {
    slot: item.slot,
    material: item.name,
    displayName: text(item.displayName),
    customName: extended.customName ? text(extended.customName) : undefined,
    lore: (extended.customLore ?? []).map(text),
    count: item.count,
    components: extended.components,
    nbt: item.nbt
  }
}

export function snapshotGui(bot: Bot): GuiSnapshot | null {
  const window = bot.currentWindow
  if (!window) return null
  return {
    id: window.id,
    type: String(window.type),
    title: text(window.title),
    slotCount: window.slots.length,
    items: window.slots.filter((item): item is Item => item !== null).map(snapshotItem)
  }
}

export function itemSearchText(item: GuiItemSnapshot): string {
  return [item.material, item.displayName, item.customName, ...item.lore].filter(Boolean).join('\n').toLocaleLowerCase()
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
