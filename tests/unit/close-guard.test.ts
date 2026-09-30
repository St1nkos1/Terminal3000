import { describe, expect, it } from 'vitest'
import { closeWarning } from '../../src/main/close-guard'
import { makeTab } from '../fixtures/tabs'

describe('closeWarning', () => {
  it('без работающего Claude окно закрывается без вопросов', () => {
    expect(closeWarning([])).toBeNull()
    expect(
      closeWarning([
        makeTab('a', 'C:\\work\\MyWebShop'),
        makeTab('b', 'C:\\work\\Data', { kind: 'claude', status: 'idle' }),
        makeTab('c', 'C:\\work\\Data', { kind: 'claude', status: 'done' }),
        makeTab('d', 'C:\\work\\Data', { kind: 'claude', status: 'crashed' })
      ])
    ).toBeNull()
  })

  it('Claude работает или ждёт — предупреждение со списком вкладок', () => {
    const w = closeWarning([
      makeTab('a', 'C:\\work\\MyWebShop', { kind: 'claude', status: 'working' }),
      makeTab('b', 'C:\\work\\Data', { kind: 'claude', status: 'waiting' }),
      makeTab('c', 'C:\\work\\Other', { kind: 'claude', status: 'idle' }),
      makeTab('d', 'C:\\work\\X', { kind: 'claude', status: 'working', customTitle: true, title: 'тесты' })
    ])
    expect(w).toContain('MyWebShop')
    expect(w).toContain('Data')
    expect(w).toContain('тесты')
    expect(w).not.toContain('Other')
  })
})
