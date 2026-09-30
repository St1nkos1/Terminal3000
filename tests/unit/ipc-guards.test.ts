import { describe, expect, it } from 'vitest'
import { isTabId, parseNewTabRequest, parseViewState } from '../../src/main/ipc-guards'

describe('ipc-guards', () => {
  it('isTabId', () => {
    expect(isTabId('t_1a2b')).toBe(true)
    expect(isTabId('')).toBe(false)
    expect(isTabId('x'.repeat(65))).toBe(false)
    expect(isTabId(5)).toBe(false)
  })

  it('parseNewTabRequest: корректные запросы', () => {
    expect(parseNewTabRequest({ cwd: 'C:\\p', kind: 'shell' })).toEqual({ cwd: 'C:\\p', kind: 'shell' })
    expect(
      parseNewTabRequest({ cwd: 'C:\\p', kind: 'claude', claude: 'resume', sessionId: 's1', title: 'T', extra: 1 })
    ).toEqual({ cwd: 'C:\\p', kind: 'claude', claude: 'resume', sessionId: 's1', title: 'T' })
  })

  it('parseNewTabRequest: мусор отбрасывается', () => {
    expect(parseNewTabRequest(null)).toBeNull()
    expect(parseNewTabRequest({ cwd: '', kind: 'shell' })).toBeNull()
    expect(parseNewTabRequest({ cwd: 'C:\\p', kind: 'python' })).toBeNull()
    expect(parseNewTabRequest({ cwd: 'C:\\p', kind: 'claude', claude: 'maybe' })).toBeNull()
    expect(parseNewTabRequest({ cwd: 'C:\\p', kind: 'shell', shell: 5 })).toBeNull()
  })

  it('parseViewState: проверяет форму, неизвестное чистит Controller', () => {
    const sidebar = { collapsed: false, collapsedGroups: ['c:/a', 7] }
    expect(parseViewState({ layout: { type: 'pane', tab: 't1' }, activeTab: 't1', sidebar, visibleTabs: ['t1', 3] })).toEqual({
      layout: { type: 'pane', tab: 't1' },
      activeTab: 't1',
      sidebar: { collapsed: false, collapsedGroups: ['c:/a'] },
      visibleTabs: ['t1']
    })
    expect(parseViewState({ layout: null, activeTab: null, sidebar, visibleTabs: [] })?.layout).toBeNull()
    expect(parseViewState({ layout: null, activeTab: 5, sidebar, visibleTabs: [] })).toBeNull()
    expect(parseViewState({ layout: null, activeTab: null, sidebar: {}, visibleTabs: [] })).toBeNull()
    expect(parseViewState('view')).toBeNull()
  })
})
