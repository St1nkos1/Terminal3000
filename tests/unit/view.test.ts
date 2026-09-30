import { describe, expect, it } from 'vitest'
import { pane } from '../../src/shared/layout'
import { EMPTY_SIDEBAR, type LayoutNode, type ViewState } from '../../src/shared/types'
import { fixView, placeTab, showTab } from '../../src/shared/view'

const split: LayoutNode = { type: 'split', dir: 'row', sizes: [0.5, 0.5], children: [pane('a'), pane('b')] }

function view(layout: LayoutNode | null, activeTab: string | null, visibleTabs: string[] = []): ViewState {
  return { layout, activeTab, sidebar: EMPTY_SIDEBAR, visibleTabs }
}

describe('fixView', () => {
  it('выкидывает неизвестные вкладки и выбирает активную', () => {
    expect(fixView(view(split, 'gone', ['a', 'gone']), ['a', 'b'])).toEqual(view(split, 'a', ['a']))
    expect(fixView(view(split, 'b'), ['a'])).toEqual(view(pane('a'), 'a'))
  })

  it('пустая раскладка: активная вкладка встаёт в панель, иначе первая из списка', () => {
    expect(fixView(view(null, 'c'), ['c'])).toEqual(view(pane('c'), 'c'))
    expect(fixView(view(null, null), ['x', 'y'])).toEqual(view(pane('x'), 'x'))
    expect(fixView(view(pane('a'), 'a'), [])).toEqual(view(null, null))
  })
})

describe('showTab', () => {
  it('вкладка уже в раскладке — только становится активной', () => {
    expect(showTab(view(split, 'a'), 'b')).toEqual(view(split, 'b'))
  })

  it('вкладки нет в раскладке — встаёт на место активной', () => {
    const r = showTab(view(split, 'b'), 'c')
    expect(r.layout).toEqual({ type: 'split', dir: 'row', sizes: [0.5, 0.5], children: [pane('a'), pane('c')] })
    expect(r.activeTab).toBe('c')
  })

  it('пустая раскладка или активная вне раскладки', () => {
    expect(showTab(view(null, null), 'c')).toEqual(view(pane('c'), 'c'))
    expect(showTab(view(split, 'zzz'), 'c').layout).toEqual({
      type: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [pane('c'), pane('b')]
    })
  })
})

describe('placeTab', () => {
  it('со split делит активную панель, новая вкладка во второй половине', () => {
    const r = placeTab(view(split, 'b'), 'c', 'column')
    expect(r.layout).toEqual({
      type: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [pane('a'), { type: 'split', dir: 'column', sizes: [0.5, 0.5], children: [pane('b'), pane('c')] }]
    })
    expect(r.activeTab).toBe('c')
  })

  it('без split, с пустой раскладкой или для вкладки из раскладки — как showTab', () => {
    expect(placeTab(view(split, 'b'), 'c')).toEqual(showTab(view(split, 'b'), 'c'))
    expect(placeTab(view(null, null), 'c', 'row')).toEqual(view(pane('c'), 'c'))
    expect(placeTab(view(split, 'b'), 'a', 'row')).toEqual(view(split, 'a'))
  })
})
