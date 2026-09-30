import { ACTION_IDS, type ActionId } from '../shared/types'
import type { KeyLike } from './input'

export interface Combo {
  ctrl: boolean
  shift: boolean
  alt: boolean
  code: string
}

const PUNCT: Record<string, string> = {
  '`': 'Backquote',
  '-': 'Minus',
  '=': 'Equal',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash'
}

const NAMED: Record<string, string> = {
  tab: 'Tab',
  enter: 'Enter',
  esc: 'Escape',
  escape: 'Escape',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  insert: 'Insert',
  ins: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  plus: 'Equal',
  minus: 'Minus'
}

const CODES = new Set([...Object.values(PUNCT), ...Object.values(NAMED), 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

// Имя клавиши из config.json → KeyboardEvent.code
function keyCode(name: string): string | null {
  if (name.length === 1) {
    const up = name.toUpperCase()
    if (up >= 'A' && up <= 'Z') return `Key${up}`
    if (up >= '0' && up <= '9') return `Digit${up}`
    return PUNCT[name] ?? null
  }
  const f = /^f([1-9]|1[0-9]|2[0-4])$/i.exec(name)
  if (f) return `F${f[1]}`
  const named = NAMED[name.toLowerCase()]
  if (named) return named
  // можно написать и сам code: KeyP, Digit1, BracketLeft
  if (/^(Key[A-Z]|Digit[0-9])$/.test(name) || CODES.has(name)) return name
  return null
}

export function parseCombo(s: string): Combo | null {
  const parts = s.split('+').map((p) => p.trim())
  if (parts.some((p) => p === '')) return null
  const code = keyCode(parts[parts.length - 1])
  if (!code) return null
  const c: Combo = { ctrl: false, shift: false, alt: false, code }
  for (const m of parts.slice(0, -1)) {
    const l = m.toLowerCase()
    if (l === 'ctrl' || l === 'control') c.ctrl = true
    else if (l === 'shift') c.shift = true
    else if (l === 'alt') c.alt = true
    else return null
  }
  // без Ctrl и Alt сочетание съело бы обычный ввод; исключение — F1…F24
  if (!c.ctrl && !c.alt && !/^F\d+$/.test(c.code)) return null
  return c
}

export function comboKey(c: Combo): string {
  return `${c.ctrl ? 'C' : ''}${c.shift ? 'S' : ''}${c.alt ? 'A' : ''}-${c.code}`
}

export function comboFromEvent(e: Pick<KeyLike, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey'>): Combo {
  return { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, code: e.code }
}

export function buildKeymap(bindings: Record<ActionId, string>): { map: Map<string, ActionId>; errors: string[] } {
  const map = new Map<string, ActionId>()
  const errors: string[] = []
  for (const id of ACTION_IDS) {
    const value = bindings[id]
    // пустая строка отключает действие
    if (!value) continue
    const combo = parseCombo(value)
    if (!combo) {
      errors.push(`keybindings.${id}: не удалось разобрать «${value}»`)
      continue
    }
    const key = comboKey(combo)
    const taken = map.get(key)
    if (taken) {
      errors.push(`keybindings.${id}: «${value}» уже назначено на ${taken}`)
      continue
    }
    map.set(key, id)
  }
  return { map, errors }
}

// По code, а не по key: в русской раскладке Ctrl+Shift+P даёт key «З»
export function matchAction(
  map: Map<string, ActionId>,
  e: Pick<KeyLike, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>
): ActionId | null {
  if (e.metaKey) return null
  return map.get(comboKey(comboFromEvent(e))) ?? null
}
