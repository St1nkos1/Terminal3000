import { describe, expect, it } from 'vitest'
import { buildKeymap, matchAction, parseCombo } from '../../src/renderer/keybindings'
import { DEFAULT_KEYBINDINGS } from '../../src/shared/types'

function ev(code: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {}, key = '') {
  return {
    key,
    code,
    ctrlKey: !!mods.ctrl,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
    metaKey: !!mods.meta
  }
}

describe('keybindings', () => {
  it('все сочетания по умолчанию разбираются', () => {
    const { map, errors } = buildKeymap(DEFAULT_KEYBINDINGS)
    expect(errors).toEqual([])
    expect(map.size).toBe(21)
  })

  it('parseCombo: модификаторы, регистр, знаки, F-клавиши и сами code', () => {
    expect(parseCombo('Ctrl+Shift+P')).toEqual({ ctrl: true, shift: true, alt: false, code: 'KeyP' })
    expect(parseCombo('ctrl + shift + p')).toEqual(parseCombo('Ctrl+Shift+P'))
    expect(parseCombo('Control+Alt+Delete')).toEqual({ ctrl: true, shift: false, alt: true, code: 'Delete' })
    expect(parseCombo('Ctrl+`')?.code).toBe('Backquote')
    expect(parseCombo('Ctrl+Shift+\\')?.code).toBe('Backslash')
    expect(parseCombo('Ctrl+Shift+-')?.code).toBe('Minus')
    expect(parseCombo('Ctrl+Plus')?.code).toBe('Equal')
    expect(parseCombo('Ctrl+1')?.code).toBe('Digit1')
    expect(parseCombo('Ctrl+Tab')?.code).toBe('Tab')
    expect(parseCombo('Ctrl+KeyK')?.code).toBe('KeyK')
    expect(parseCombo('F2')).toEqual({ ctrl: false, shift: false, alt: false, code: 'F2' })
    expect(parseCombo('Shift+F12')?.code).toBe('F12')
  })

  it('parseCombo: неверные сочетания и сочетания без Ctrl/Alt', () => {
    for (const s of ['', 'Ctrl+', 'Win+P', 'Ctrl+Shift+Nope', 'Ctrl+Щ', 'P', 'Shift+A', 'Enter']) {
      expect(parseCombo(s), s).toBeNull()
    }
  })

  it('русская раскладка: сравнение по code, а не по key', () => {
    const { map } = buildKeymap(DEFAULT_KEYBINDINGS)
    expect(matchAction(map, ev('KeyP', { ctrl: true, shift: true }, 'З'))).toBe('palette')
    expect(matchAction(map, ev('KeyT', { ctrl: true, shift: true }, 'Е'))).toBe('newTab')
    expect(matchAction(map, ev('Backquote', { ctrl: true }, 'ё'))).toBe('toggleConsole')
    expect(matchAction(map, ev('KeyJ', { ctrl: true, shift: true }, 'О'))).toBe('nextAttention')
  })

  it('модификаторы должны совпасть точно, Win не поддерживается', () => {
    const { map } = buildKeymap(DEFAULT_KEYBINDINGS)
    expect(matchAction(map, ev('KeyP', { ctrl: true }))).toBeNull()
    expect(matchAction(map, ev('KeyP', { ctrl: true, shift: true, alt: true }))).toBeNull()
    expect(matchAction(map, ev('KeyP', { ctrl: true, shift: true, meta: true }))).toBeNull()
    expect(matchAction(map, ev('Tab', { ctrl: true }))).toBe('nextTab')
    expect(matchAction(map, ev('Tab', { ctrl: true, shift: true }))).toBe('prevTab')
    expect(matchAction(map, ev('Digit1', { ctrl: true }))).toBe('goToTab1')
    expect(matchAction(map, ev('F2'))).toBe('rename')
    expect(matchAction(map, ev('KeyC', { ctrl: true }))).toBeNull()
  })

  it('ошибки: неразборчивое и повторное сочетание, пустое отключает действие', () => {
    const { map, errors } = buildKeymap({
      ...DEFAULT_KEYBINDINGS,
      palette: 'Ctrl+Щ',
      newTab: 'Ctrl+Shift+J',
      search: ''
    })
    expect(errors).toEqual([
      'keybindings.palette: не удалось разобрать «Ctrl+Щ»',
      'keybindings.nextAttention: «Ctrl+Shift+J» уже назначено на newTab'
    ])
    expect(matchAction(map, ev('KeyJ', { ctrl: true, shift: true }))).toBe('newTab')
    expect(matchAction(map, ev('KeyF', { ctrl: true, shift: true }))).toBeNull()
    expect([...map.values()]).not.toContain('search')
  })
})
