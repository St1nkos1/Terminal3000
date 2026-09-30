import { describe, expect, it } from 'vitest'
import { OscScanner } from '../../src/main/osc'

const SEQ = '\x1b]7777;t3000;claude-exit;3\x07'

describe('OscScanner', () => {
  it('находит код выхода в чанке', () => {
    expect(new OscScanner().feed(`abc${SEQ}def`)).toEqual([3])
  })

  it('отрицательный код и терминатор ESC \\', () => {
    expect(new OscScanner().feed('\x1b]7777;t3000;claude-exit;-1\x1b\\')).toEqual([-1])
  })

  it('несколько последовательностей в одном чанке', () => {
    const s = new OscScanner()
    expect(s.feed(`${SEQ}x\x1b]7777;t3000;claude-exit;0\x07`)).toEqual([3, 0])
    expect(s.feed('обычный вывод')).toEqual([])
  })

  it('разрезанный чанк: любое место разреза', () => {
    const cases: [string, number][] = [
      [SEQ, 3],
      ['\x1b]7777;t3000;claude-exit;42\x1b\\', 42]
    ]
    for (const [seq, code] of cases) {
      const text = `до${seq}после`
      for (let i = 1; i < text.length; i++) {
        const s = new OscScanner()
        expect([...s.feed(text.slice(0, i)), ...s.feed(text.slice(i))], `разрез на ${i}`).toEqual([code])
      }
    }
  })

  it('последовательность в трёх чанках', () => {
    const s = new OscScanner()
    expect(s.feed('\x1b]77')).toEqual([])
    expect(s.feed('77;t3000;claude-')).toEqual([])
    expect(s.feed('exit;5\x07')).toEqual([5])
  })

  it('чужие OSC и ESC не дают ложных срабатываний', () => {
    const s = new OscScanner()
    expect(s.feed('\x1b]0;заголовок\x07\x1b]7777;t3000;other;1\x07')).toEqual([])
    expect(s.feed('\x1b[0m')).toEqual([])
    expect(s.feed(']7777;t3000;claude-exit;1\x07')).toEqual([])
    expect(s.feed('\x1b]7777;t3000;claude-exit;x\x07')).toEqual([])
  })
})
