import { describe, expect, it } from 'vitest'
import type { LayoutNode } from '../../src/shared/types'
import {
  containsTab,
  layoutTabs,
  normalizeLayout,
  pane,
  removeTab,
  replaceTab,
  setSizes,
  splitTab
} from '../../src/shared/layout'

const tree: LayoutNode = {
  type: 'split',
  dir: 'row',
  sizes: [0.5, 0.5],
  children: [
    pane('a'),
    { type: 'split', dir: 'column', sizes: [0.7, 0.3], children: [pane('b'), pane('c')] }
  ]
}

describe('layout', () => {
  it('layoutTabs перечисляет вкладки слева направо', () => {
    expect(layoutTabs(tree)).toEqual(['a', 'b', 'c'])
    expect(layoutTabs(null)).toEqual([])
    expect(containsTab(tree, 'c')).toBe(true)
    expect(containsTab(tree, 'x')).toBe(false)
  })

  it('replaceTab меняет вкладку в панели', () => {
    expect(layoutTabs(replaceTab(tree, 'b', 'x'))).toEqual(['a', 'x', 'c'])
  })

  it('removeTab схлопывает сплит с одним ребёнком', () => {
    const r = removeTab(tree, 'b')
    expect(r).toEqual({ type: 'split', dir: 'row', sizes: [0.5, 0.5], children: [pane('a'), pane('c')] })
    expect(removeTab(pane('a'), 'a')).toBeNull()
  })

  it('removeTab перенормирует пропорции', () => {
    const three: LayoutNode = {
      type: 'split',
      dir: 'row',
      sizes: [0.5, 0.25, 0.25],
      children: [pane('a'), pane('b'), pane('c')]
    }
    const r = removeTab(three, 'a')
    expect(r?.type === 'split' && r.sizes[0]).toBeCloseTo(0.5)
    expect(r?.type === 'split' && r.sizes[1]).toBeCloseTo(0.5)
  })

  it('splitTab делит панель пополам', () => {
    expect(splitTab(pane('a'), 'a', 'b', 'column')).toEqual({
      type: 'split',
      dir: 'column',
      sizes: [0.5, 0.5],
      children: [pane('a'), pane('b')]
    })
    expect(layoutTabs(splitTab(tree, 'c', 'd', 'row'))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('setSizes меняет пропорции узла по пути', () => {
    const r = setSizes(tree, [1], [1, 3])
    const inner = r.type === 'split' ? r.children[1] : null
    expect(inner?.type === 'split' && inner.sizes).toEqual([0.25, 0.75])
    expect(setSizes(tree, [], [1, 2, 3])).toBe(tree)
  })

  it('normalizeLayout чистит неизвестные, повторы и мусор', () => {
    const raw = {
      type: 'split',
      dir: 'row',
      sizes: [0.5, 'x', 0.5],
      children: [pane('a'), pane('gone'), pane('a'), pane('b')]
    }
    expect(normalizeLayout(raw, new Set(['a', 'b']))).toEqual({
      type: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [pane('a'), pane('b')]
    })
    expect(normalizeLayout({ type: 'split', dir: 'row', sizes: [], children: [pane('a')] }, new Set(['a']))).toEqual(
      pane('a')
    )
    expect(normalizeLayout('garbage', new Set(['a']))).toBeNull()
    expect(normalizeLayout({ type: 'split', dir: 'diag', children: [] }, new Set())).toBeNull()
  })
})
