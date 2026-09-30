import { describe, expect, it } from 'vitest'
import { clipboardInput, osc8LinkHandler, quotePaths, terminalKeyAction, type KeyLike } from '../../src/renderer/input'

describe('ссылки OSC 8 (gh, ls --hyperlink)', () => {
  it('открываются через main, без confirm() и пустого окна xterm', () => {
    const opened: string[] = []
    let prevented = false
    const handler = osc8LinkHandler((uri) => opened.push(uri))
    const event = { preventDefault: () => (prevented = true) } as unknown as MouseEvent
    handler.activate(event, 'https://github.com/st1nkos/Terminal3000')
    expect(opened).toEqual(['https://github.com/st1nkos/Terminal3000'])
    expect(prevented).toBe(true)
    // file:// и прочие схемы xterm даже не активирует
    expect(handler.allowNonHttpProtocols).toBe(false)
  })
})

function key(code: string, mods: Partial<KeyLike> = {}): KeyLike {
  return { type: 'keydown', code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods }
}

describe('terminalKeyAction', () => {
  it('Ctrl+C копирует только при выделении', () => {
    expect(terminalKeyAction(key('KeyC', { ctrlKey: true }), true)).toBe('copy')
    expect(terminalKeyAction(key('KeyC', { ctrlKey: true }), false)).toBeNull()
    expect(terminalKeyAction(key('KeyC', { ctrlKey: true, shiftKey: true }), true)).toBeNull()
  })

  it('Ctrl+V и Ctrl+Shift+V вставляют, в том числе в русской раскладке (key = «м»)', () => {
    expect(terminalKeyAction(key('KeyV', { ctrlKey: true }), false)).toBe('paste')
    expect(terminalKeyAction(key('KeyV', { ctrlKey: true, shiftKey: true }), false)).toBe('paste')
    expect(terminalKeyAction({ ...key('KeyV', { ctrlKey: true }), key: 'м' } as KeyLike, false)).toBe('paste')
  })

  it('Shift+Enter — перенос строки, Alt и Win не трогаем', () => {
    expect(terminalKeyAction(key('Enter', { shiftKey: true }), false)).toBe('newline')
    expect(terminalKeyAction(key('NumpadEnter', { shiftKey: true }), false)).toBe('newline')
    expect(terminalKeyAction(key('Enter'), false)).toBeNull()
    expect(terminalKeyAction(key('KeyV', { ctrlKey: true, altKey: true }), false)).toBeNull()
    expect(terminalKeyAction(key('KeyV', { ctrlKey: true, metaKey: true }), false)).toBeNull()
  })
})

describe('буфер обмена и файлы', () => {
  it('текст вставляется, картинка без текста — сырой Ctrl+V', () => {
    expect(clipboardInput({ text: 'ls', hasImage: true })).toEqual({ type: 'text', text: 'ls' })
    expect(clipboardInput({ text: '', hasImage: true })).toEqual({ type: 'raw', data: '\x16' })
    expect(clipboardInput({ text: '', hasImage: false })).toBeNull()
  })

  it('пути в кавычках через пробел', () => {
    expect(quotePaths(['C:\\Мои файлы\\a.png', 'D:\\b.txt'])).toBe('"C:\\Мои файлы\\a.png" "D:\\b.txt"')
    expect(quotePaths(['', 'D:\\b.txt'])).toBe('"D:\\b.txt"')
    expect(quotePaths([])).toBe('')
  })
})
