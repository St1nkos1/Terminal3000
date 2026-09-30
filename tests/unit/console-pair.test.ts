import { describe, expect, it, vi } from 'vitest'
import { pane } from '../../src/shared/layout'
import type { LayoutNode } from '../../src/shared/types'
import { setupActions } from '../fixtures/actions'
import { makeTab } from '../fixtures/tabs'

const col = (a: string, b: string, sizes = [0.5, 0.5]): LayoutNode => ({
  type: 'split',
  dir: 'column',
  sizes,
  children: [pane(a), pane(b)]
})

// Claude a в C:\p с консолью sa, Claude b в D:\q
const a = makeTab('a', 'C:\\p', { kind: 'claude', status: 'idle' })
const sa = makeTab('sa', 'C:\\p')
const b = makeTab('b', 'D:\\q', { kind: 'claude', status: 'idle' })
const sb = makeTab('sb', 'd:/q/')

describe('консоль под Claude', () => {
  it('переключение на Claude другого проекта меняет пару целиком', () => {
    const { store, actions, calls } = setupActions([a, sa, b, sb], { layout: col('a', 'sa', [0.7, 0.3]), activeTab: 'a' })
    actions.activate('b')
    expect(store.get().view.layout).toEqual(col('b', 'sb', [0.7, 0.3]))
    expect(store.get().view.activeTab).toBe('b')
    expect(calls.focus.at(-1)).toBe('b')
    expect(calls.createTab).toEqual([])
  })

  it('консоли у проекта нет — создаётся и встаёт под Claude, фокус остаётся на Claude', async () => {
    const { store, actions, calls, willCreate } = setupActions([a, sa, b], { layout: col('a', 'sa'), activeTab: 'a' })
    willCreate(makeTab('n', 'D:\\q'))
    actions.activate('b')
    expect(store.get().view.layout).toEqual(pane('b'))
    await vi.waitFor(() => expect(store.get().view.layout).toEqual(col('b', 'n')))
    expect(calls.createTab).toEqual([{ cwd: 'D:\\q', kind: 'shell' }])
    expect(store.get().view.activeTab).toBe('b')
    expect(calls.focus.at(-1)).toBe('b')
  })

  it('Claude уже на экране — клик не возвращает убранную консоль и не создаёт новую', () => {
    const { store, actions, calls } = setupActions([a, sa, b], { layout: pane('a'), activeTab: 'a' })
    actions.activate('a')
    expect(store.get().view.layout).toEqual(pane('a'))
    expect(calls.createTab).toEqual([])
  })

  it('Ctrl+Tab: пока зажат Ctrl, консоли не создаются; после — только для последней вкладки', async () => {
    const c = makeTab('c', 'E:\\r', { kind: 'claude', status: 'idle' })
    const { store, actions, calls, willCreate } = setupActions([a, sa, b, c], { layout: col('a', 'sa'), activeTab: 'a' })
    actions.activate('c')
    actions.activate('b')
    actions.activate('a')
    expect(calls.createTab).toHaveLength(2)
    // заказанные выше консоли (createTab вернул null) успевают завершиться
    await new Promise((r) => setTimeout(r, 0))
    calls.createTab.length = 0
    willCreate(makeTab('n', 'D:\\q'))
    actions.run('nextTab')
    actions.run('nextTab')
    expect(store.get().view.activeTab).toBe('c')
    actions.run('prevTab')
    expect(store.get().view.activeTab).toBe('b')
    expect(calls.createTab).toEqual([])
    actions.endCycle()
    await vi.waitFor(() => expect(store.get().view.layout).toEqual(col('b', 'n')))
    expect(calls.createTab).toEqual([{ cwd: 'D:\\q', kind: 'shell' }])
  })

  it('консоль уже создаётся — повторное переключение вторую не заказывает', () => {
    const { actions, calls } = setupActions([a, sa, b], { layout: col('a', 'sa'), activeTab: 'a' })
    actions.activate('b')
    actions.activate('a')
    actions.activate('b')
    expect(calls.createTab).toEqual([{ cwd: 'D:\\q', kind: 'shell' }])
  })

  it('новый Claude встаёт парой, через «Разделить…» — нет', async () => {
    const { store, actions, calls, willCreate } = setupActions([a, sa, b, sb], { layout: col('a', 'sa'), activeTab: 'a' })
    willCreate(makeTab('n', 'D:\\q', { kind: 'claude', status: 'starting' }))
    await actions.runCommand({ type: 'open', req: { cwd: 'D:\\q', kind: 'claude', claude: 'new' } })
    expect(store.get().view.layout).toEqual(col('n', 'sb'))

    willCreate(makeTab('m', 'E:\\r', { kind: 'claude', status: 'starting' }))
    await actions.runCommand({ type: 'open', req: { cwd: 'E:\\r', kind: 'claude', claude: 'new' }, split: 'row' })
    // сплит делит активную панель — Claude n, консоль под m не заказывается
    expect(store.get().view.layout).toEqual({
      type: 'split',
      dir: 'column',
      sizes: [0.5, 0.5],
      children: [{ type: 'split', dir: 'row', sizes: [0.5, 0.5], children: [pane('n'), pane('m')] }, pane('sb')]
    })
    expect(calls.createTab).toHaveLength(2)
  })

  it('консоль и выключенная настройка — по-старому: вкладка встаёт на место активной', () => {
    const { store, actions, calls } = setupActions([a, sa, b, sb], { layout: col('a', 'sa'), activeTab: 'a' })
    actions.activate('sb')
    expect(store.get().view.layout).toEqual(col('sb', 'sa'))
    actions.onConfig({ ...store.get().config, consoleUnderClaude: false })
    actions.activate('b')
    expect(store.get().view.layout).toEqual(col('b', 'sa'))
    expect(calls.createTab).toEqual([])
  })
})
