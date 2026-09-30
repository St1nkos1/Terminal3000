import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../src/main/config'
import { pageItems, type PaletteData } from '../../src/renderer/palette-pages'
import type { HooksState } from '../../src/shared/types'
import { setupActions } from '../fixtures/actions'

function hookItems(hooks: HooksState) {
  const d: PaletteData = {
    tabs: [],
    projects: [],
    config: structuredClone(DEFAULT_CONFIG),
    hooks,
    doNotDisturb: false,
    sidebarCollapsed: false,
    activeTab: null,
    layoutTabs: [],
    now: 0,
    homeDir: 'C:\\Users\\u'
  }
  return pageItems({ page: 'root' }, d)
    .filter((i) => i.key.endsWith('-hooks'))
    .map((i) => [i.key, i.label])
}

describe('хуки в палитре', () => {
  it('команды зависят от состояния хуков', () => {
    expect(hookItems({ state: 'missing' })).toEqual([['cmd:install-hooks', 'Установить хуки Claude Code']])
    expect(hookItems({ state: 'outdated' })).toEqual([
      ['cmd:install-hooks', 'Обновить хуки Claude Code'],
      ['cmd:uninstall-hooks', 'Удалить хуки Claude Code']
    ])
    expect(hookItems({ state: 'installed' })).toEqual([['cmd:uninstall-hooks', 'Удалить хуки Claude Code']])
    expect(hookItems({ state: 'broken', path: 'C:\\s.json', error: 'x' })).toEqual([])
  })
})

describe('хуки в действиях', () => {
  it('команды палитры ставят и удаляют хуки, палитра закрывается', async () => {
    const { store, actions, calls } = setupActions([])
    actions.run('palette')
    await actions.runCommand({ type: 'install-hooks' })
    expect(store.get().overlay).toBeNull()
    await actions.runCommand({ type: 'uninstall-hooks' })
    expect(calls.other).toEqual(['installHooks', 'uninstallHooks'])
  })

  it('приветствие: установить, затем закрыть; «Позже» только закрывает', async () => {
    const first = setupActions([], {}, { app: { firstRun: true, hooks: { state: 'missing' } } })
    await first.actions.welcomeInstall()
    expect(first.calls.other).toEqual(['installHooks', 'dismissWelcome'])
    const later = setupActions([], {}, { app: { firstRun: true } })
    later.actions.dismissWelcome()
    expect(later.calls.other).toEqual(['dismissWelcome'])
  })

  it('кнопки баннеров', async () => {
    const { actions, calls } = setupActions([])
    await actions.bannerCommand('install-hooks')
    await actions.bannerCommand('open-config')
    expect(calls.other).toEqual(['installHooks', 'openConfig'])
  })
})
