import { describe, expect, it } from 'vitest'
import { pane } from '../../src/shared/layout'
import { EMPTY_SIDEBAR, type LayoutNode, type ViewState } from '../../src/shared/types'
import { attachConsole, fixView, placeTab, showTab, showWithConsole } from '../../src/shared/view'

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

describe('showWithConsole', () => {
  // консоли в тестах — вкладки s*, остальные — Claude
  const isShell = (t: string) => t.startsWith('s')
  const col = (a: LayoutNode, b: LayoutNode, sizes = [0.5, 0.5]): LayoutNode => ({
    type: 'split',
    dir: 'column',
    sizes,
    children: [a, b]
  })
  const row = (a: LayoutNode, b: LayoutNode): LayoutNode => ({ type: 'split', dir: 'row', sizes: [0.5, 0.5], children: [a, b] })

  it('одна панель превращается в пару «Claude над консолью»', () => {
    expect(showWithConsole(view(pane('a'), 'a'), 'b', 'sb', isShell)).toEqual(view(col(pane('b'), pane('sb')), 'b'))
    expect(showWithConsole(view(null, null), 'b', 'sb', isShell)).toEqual(view(col(pane('b'), pane('sb')), 'b'))
  })

  it('пара другого проекта сменяется целиком, пропорции остаются — с какой бы её половины ни был фокус', () => {
    const pair = col(pane('a'), pane('sa'), [0.7, 0.3])
    const want = view(col(pane('b'), pane('sb'), [0.7, 0.3]), 'b')
    expect(showWithConsole(view(pair, 'a'), 'b', 'sb', isShell)).toEqual(want)
    expect(showWithConsole(view(pair, 'sa'), 'b', 'sb', isShell)).toEqual(want)
  })

  it('консоли ещё нет — пара сменяется одной панелью', () => {
    expect(showWithConsole(view(col(pane('a'), pane('sa')), 'a'), 'b', null, isShell)).toEqual(view(pane('b'), 'b'))
  })

  it('консоль уже на экране в другом месте — не дублируется', () => {
    const layout = row(col(pane('a'), pane('sa')), pane('sb'))
    expect(showWithConsole(view(layout, 'a'), 'b', 'sb', isShell)).toEqual(view(row(pane('b'), pane('sb')), 'b'))
  })

  it('консоль в той самой панели, куда встаёт Claude, — встаёт под него', () => {
    expect(showWithConsole(view(pane('sb'), 'sb'), 'b', 'sb', isShell)).toEqual(view(col(pane('b'), pane('sb')), 'b'))
  })

  it('два Claude рядом: пара встаёт только в активной половине', () => {
    expect(showWithConsole(view(row(pane('a'), pane('c')), 'c'), 'b', 'sb', isShell)).toEqual(
      view(row(pane('a'), col(pane('b'), pane('sb'))), 'b')
    )
  })

  it('Claude уже на экране — только становится активным, убранная консоль не возвращается', () => {
    const layout = row(pane('a'), pane('b'))
    expect(showWithConsole(view(layout, 'a'), 'b', 'sb', isShell)).toEqual(view(layout, 'b'))
  })
})

describe('attachConsole', () => {
  it('консоль встаёт под вкладкой, фокус остаётся на ней', () => {
    expect(attachConsole(view(split, 'a'), 'a', 'sa')).toEqual(
      view(
        {
          type: 'split',
          dir: 'row',
          sizes: [0.5, 0.5],
          children: [{ type: 'split', dir: 'column', sizes: [0.5, 0.5], children: [pane('a'), pane('sa')] }, pane('b')]
        },
        'a'
      )
    )
  })

  it('вкладка ушла с экрана или консоль уже на нём — ничего не меняется', () => {
    expect(attachConsole(view(split, 'a'), 'c', 'sc')).toEqual(view(split, 'a'))
    expect(attachConsole(view(split, 'a'), 'a', 'b')).toEqual(view(split, 'a'))
  })
})
