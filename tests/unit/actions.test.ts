import { describe, expect, it } from 'vitest'
import { pane } from '../../src/shared/layout'
import { appState, setupActions as setup } from '../fixtures/actions'
import { makeTab } from '../fixtures/tabs'

const split = (a: string, b: string) => ({
  type: 'split' as const,
  dir: 'row' as const,
  sizes: [0.5, 0.5],
  children: [pane(a), pane(b)]
})

describe('actions', () => {
  it('activate: вкладка встаёт в активную панель, MRU, фокус и updateView', () => {
    const tabs = [makeTab('a', 'C:\\p'), makeTab('b', 'C:\\p'), makeTab('c', 'C:\\p')]
    const { store, actions, calls } = setup(tabs, { layout: split('a', 'b'), activeTab: 'b' })
    actions.activate('c')
    expect(store.get().view.layout).toEqual(split('a', 'c'))
    expect(store.get().view.activeTab).toBe('c')
    expect(store.get().view.visibleTabs).toEqual(['a', 'c'])
    expect(store.get().mru).toEqual(['c', 'b'])
    expect(calls.focus).toEqual(['c'])
    expect(calls.updateView.at(-1)).toEqual(store.get().view)
    actions.activate('zzz')
    expect(store.get().view.activeTab).toBe('c')
  })

  it('activate без MRU (для переключения по Ctrl+Tab)', () => {
    const { store, actions } = setup([makeTab('a', 'C:\\p'), makeTab('b', 'C:\\p')], { layout: pane('a'), activeTab: 'a' })
    actions.activate('b', { mru: false })
    expect(store.get().view.activeTab).toBe('b')
    expect(store.get().mru).toEqual(['a'])
  })

  it('openTab ставит новую вкладку в раскладку, со split — рядом с активной', async () => {
    const { store, actions, calls, willCreate } = setup([makeTab('a', 'C:\\p')], { layout: pane('a'), activeTab: 'a' })
    willCreate(makeTab('n', 'C:\\p'))
    expect(await actions.openTab({ cwd: 'C:\\p', kind: 'shell' }, 'row')).toBe('n')
    expect(calls.createTab).toEqual([{ cwd: 'C:\\p', kind: 'shell' }])
    expect(store.get().view.layout).toEqual(split('a', 'n'))
    expect(store.get().view.activeTab).toBe('n')
  })

  it('openTab: папки нет — вид не меняется', async () => {
    const { store, actions } = setup([makeTab('a', 'C:\\p')], { layout: pane('a'), activeTab: 'a' })
    expect(await actions.openTab({ cwd: 'C:\\gone', kind: 'shell' })).toBeNull()
    expect(store.get().view.layout).toEqual(pane('a'))
  })

  it('onState: закрытая вкладка уходит из раскладки, MRU и терминалов', () => {
    const tabs = [makeTab('a', 'C:\\p'), makeTab('b', 'C:\\p')]
    const { store, actions, calls } = setup(tabs, { layout: split('a', 'b'), activeTab: 'b' })
    actions.activate('a')
    actions.onState(appState([tabs[0]]))
    expect(store.get().view.layout).toEqual(pane('a'))
    expect(store.get().view.activeTab).toBe('a')
    expect(store.get().mru).toEqual(['a'])
    expect(calls.pruned.at(-1)).toEqual(['a'])
  })

  it('окно свёрнуто — видимых вкладок нет', () => {
    const { store, actions } = setup([makeTab('a', 'C:\\p')], { layout: pane('a'), activeTab: 'a' }, { visible: false })
    actions.refreshView()
    expect(store.get().view.visibleTabs).toEqual([])
  })

  it('панель, группы и пропорции сохраняются через updateView, одинаковый вид не шлётся', () => {
    const { store, actions, calls } = setup([makeTab('a', 'C:\\p'), makeTab('b', 'C:\\p')], {
      layout: split('a', 'b'),
      activeTab: 'a'
    })
    actions.refreshView()
    const sent = calls.updateView.length
    actions.refreshView()
    expect(calls.updateView.length).toBe(sent)
    actions.toggleSidebar()
    expect(store.get().view.sidebar.collapsed).toBe(true)
    actions.toggleGroup('c:/p')
    actions.toggleGroup('d:/q')
    actions.toggleGroup('d:/q')
    expect(store.get().view.sidebar.collapsedGroups).toEqual(['c:/p'])
    actions.resizeSplit([], [3, 1])
    const layout = store.get().view.layout
    expect(layout?.type === 'split' && layout.sizes).toEqual([0.75, 0.25])
    expect(calls.updateView.length).toBe(sent + 5)
  })

  it('выбрать папку для упавшей вкладки', async () => {
    const { actions, calls } = setup([makeTab('a', 'C:\\gone')])
    await actions.pickFolderFor('a')
    expect(calls.setTabCwd).toEqual([['a', 'D:\\new']])
  })
})
