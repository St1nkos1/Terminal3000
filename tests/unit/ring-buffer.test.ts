import { describe, expect, it } from 'vitest'
import { RingBuffer } from '../../src/main/ring-buffer'

describe('RingBuffer', () => {
  it('хранит всё, пока не превышен лимит', () => {
    const b = new RingBuffer(10)
    b.push('abc')
    b.push('')
    b.push('def')
    expect(b.text()).toBe('abcdef')
  })

  it('оставляет последние maxChars символов', () => {
    const b = new RingBuffer(5)
    b.push('abc')
    b.push('defg')
    expect(b.text()).toBe('cdefg')
  })

  it('чанк больше лимита', () => {
    const b = new RingBuffer(3)
    b.push('abcdef')
    expect(b.text()).toBe('def')
  })

  it('не начинается с половины суррогатной пары', () => {
    const b = new RingBuffer(3)
    // эмодзи занимает две единицы UTF-16
    b.push('😀ab')
    expect(b.text()).toBe('ab')
    b.push('c')
    expect(b.text()).toBe('abc')
  })

  it('тысячи мелких чанков', () => {
    const b = new RingBuffer(100)
    for (let i = 0; i < 10000; i++) b.push(String(i % 10))
    const t = b.text()
    expect(t).toHaveLength(100)
    expect(t.endsWith('6789')).toBe(true)
  })
})
