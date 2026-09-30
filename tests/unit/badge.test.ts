import { describe, expect, it } from 'vitest'
import { attentionCount, badgeText } from '../../src/renderer/badge'
import { makeTab } from '../fixtures/tabs'

describe('badge', () => {
  it('считает вкладки в waiting и done', () => {
    const tabs = [
      makeTab('a', 'C:\\p', { status: 'waiting' }),
      makeTab('b', 'C:\\p', { status: 'done' }),
      makeTab('c', 'C:\\p', { status: 'working' }),
      makeTab('d', 'C:\\p', { status: 'crashed' })
    ]
    expect(attentionCount(tabs)).toBe(2)
    expect(attentionCount([])).toBe(0)
  })

  it('больше девяти — «9+»', () => {
    expect(badgeText(3)).toBe('3')
    expect(badgeText(10)).toBe('9+')
  })
})
