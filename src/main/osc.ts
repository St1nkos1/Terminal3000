// Служебная последовательность обёртки claude (Task 4): ESC ] 7777;t3000;claude-exit;<код> BEL или ESC \
const PREFIX = '\x1b]7777;t3000;claude-exit;'
// eslint-disable-next-line no-control-regex
const CLAUDE_EXIT = /\x1b\]7777;t3000;claude-exit;(-?\d{1,10})(?:\x07|\x1b\\)/g
// префикс, знак, до 10 цифр и ESC из терминатора ESC \
const MAX_TAIL = PREFIX.length + 12

// Может ли s оказаться началом последовательности, которую допишет следующий чанк
function isPartial(s: string): boolean {
  if (s.length <= PREFIX.length) return PREFIX.startsWith(s)
  // eslint-disable-next-line no-control-regex
  return s.startsWith(PREFIX) && /^-?\d{0,10}\x1b?$/.test(s.slice(PREFIX.length))
}

function pendingTail(text: string, from: number): string {
  const last = text.lastIndexOf('\x1b')
  if (last < from) return ''
  // последний ESC может быть половиной терминатора ESC \, тогда последовательность началась раньше
  const prev = last > 0 ? text.lastIndexOf('\x1b', last - 1) : -1
  for (const i of [prev, last]) {
    if (i < from) continue
    const s = text.slice(i)
    if (s.length <= MAX_TAIL && isPartial(s)) return s
  }
  return ''
}

// Ищет коды выхода claude в потоке pty, в том числе в последовательностях, разрезанных между чанками
export class OscScanner {
  private tail = ''

  feed(chunk: string): number[] {
    const text = this.tail + chunk
    const codes: number[] = []
    let end = 0
    for (const m of text.matchAll(CLAUDE_EXIT)) {
      codes.push(Number(m[1]))
      end = m.index + m[0].length
    }
    this.tail = pendingTail(text, end)
    return codes
  }
}
