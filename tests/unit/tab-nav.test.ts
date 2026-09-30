import { describe, expect, it } from 'vitest'
import { pane } from '../../src/shared/layout'
import type { LayoutNode } from '../../src/shared/types'
import { consoleStep, mruStep, nextAttention } from '../../src/renderer/tab-order'
import { makeTab } from '../fixtures/tabs'

describe('mruStep', () => {
  it('шаги по кругу, список зафиксирован на время переключения', () => {
    const r1 = mruStep(['a', 'b', 'c'], null, 1)
    expect(r1).toEqual({ cycle: { list: ['a', 'b', 'c'], index: 1 }, tab: 'b' })
    // MRU мог поменяться, но пока Ctrl зажат, идём по старому списку
    const r2 = mruStep(['b', 'a', 'c'], r1!.cycle, 1)
    expect(r2?.tab).toBe('c')
    expect(mruStep(['a', 'b', 'c'], r2!.cycle, 1)?.tab).toBe('a')
    expect(mruStep(['a', 'b', 'c'], null, -1)?.tab).toBe('c')
    expect(mruStep(['a'], null, 1)).toBeNull()
  })
})

describe('nextAttention', () => {
  it('сначала waiting после текущей по порядку панели, потом done', () => {
    const tabs = [
      makeTab('a', 'C:\\p'),
      makeTab('b', 'C:\\p', { status: 'done' }),
      makeTab('c', 'D:\\q', { status: 'waiting' }),
      makeTab('d', 'C:\\p', { status: 'waiting' })
    ]
    // порядок панели: a, b, d (C:\p), c (D:\q)
    expect(nextAttention(tabs, 'a')).toBe('d')
    expect(nextAttention(tabs, 'd')).toBe('c')
    expect(nextAttention(tabs, 'c')).toBe('d')
    expect(nextAttention(tabs, null)).toBe('d')
    expect(nextAttention([makeTab('a', 'C:\\p', { status: 'done' })], 'a')).toBeNull()
  })
})

describe('consoleStep', () => {
  const claude = makeTab('c', 'C:\\p', { kind: 'claude', status: 'idle' })
  const shell = makeTab('s', 'c:/p/', { kind: 'shell' })
  const other = makeTab('o', 'D:\\q')
  const split: LayoutNode = { type: 'split', dir: 'column', sizes: [0.5, 0.5], children: [pane('c'), pane('s')] }

  it('консоли нет — создать в папке активной вкладки', () => {
    expect(consoleStep([claude, other], pane('c'), 'c')).toEqual({ type: 'create', cwd: 'C:\\p' })
  })

  it('консоль есть, но скрыта — показать; показана — скрыть', () => {
    expect(consoleStep([claude, shell], pane('c'), 'c')).toEqual({ type: 'show', tab: 's' })
    expect(consoleStep([claude, shell], split, 'c')).toEqual({ type: 'hide', tab: 's', back: 'c' })
  })

  it('активна сама консоль под вкладкой проекта — скрыть её', () => {
    expect(consoleStep([claude, shell], split, 's')).toEqual({ type: 'hide', tab: 's', back: 'c' })
    expect(consoleStep([claude, shell], pane('s'), 's')).toBeNull()
    expect(consoleStep([claude], null, null)).toBeNull()
  })
})
