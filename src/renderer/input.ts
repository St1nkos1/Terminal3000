export interface KeyLike {
  type: string
  code: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

export type TerminalKey = 'copy' | 'paste' | 'newline'

// По code, а не по key: в русской раскладке Ctrl+V даёт key «м»
export function terminalKeyAction(e: KeyLike, hasSelection: boolean): TerminalKey | null {
  if (e.altKey || e.metaKey) return null
  if (e.ctrlKey && !e.shiftKey && e.code === 'KeyC') return hasSelection ? 'copy' : null
  if (e.ctrlKey && e.code === 'KeyV') return 'paste'
  if (!e.ctrlKey && e.shiftKey && (e.code === 'Enter' || e.code === 'NumpadEnter')) return 'newline'
  return null
}

export type ClipboardInput = { type: 'text'; text: string } | { type: 'raw'; data: string } | null

// Картинка без текста: сырой Ctrl+V, Claude сам заберёт скриншот из буфера
export function clipboardInput(clip: { text: string; hasImage: boolean }): ClipboardInput {
  if (clip.text) return { type: 'text', text: clip.text }
  if (clip.hasImage) return { type: 'raw', data: '\x16' }
  return null
}

export function quotePaths(paths: string[]): string {
  return paths
    .filter((p) => p !== '')
    .map((p) => `"${p}"`)
    .join(' ')
}

export interface LinkHandler {
  activate(event: MouseEvent, uri: string): void
  allowNonHttpProtocols: boolean
}

// Ссылки OSC 8: без своего обработчика xterm показывает confirm() и открывает пустое окно
export function osc8LinkHandler(open: (uri: string) => void): LinkHandler {
  return {
    allowNonHttpProtocols: false,
    activate: (event, uri) => {
      event.preventDefault()
      open(uri)
    }
  }
}
