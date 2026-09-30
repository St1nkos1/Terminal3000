import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../src/main/config'
import { layoutTabs, pane } from '../../src/shared/layout'
import type { Project } from '../../src/shared/types'
import { appState, setupActions } from '../fixtures/actions'
import { makeTab } from '../fixtures/tabs'

const column = (a: string, b: string) => ({
  type: 'split' as const,
  dir: 'column' as const,
  sizes: [0.5, 0.5],
  children: [pane(a), pane(b)]
})

describe('команды', () => {
  it('goToTab: N-я вкладка в порядке панели', () => {
    const tabs = [makeTab('a', 'C:\\p'), makeTab('b', 'D:\\q'), makeTab('c', 'C:\\p')]
    const { store, actions } = setupActions(tabs, { layout: pane('a'), activeTab: 'a' })
    actions.run('goToTab2')
    expect(store.get().view.activeTab).toBe('c')
    actions.run('goToTab3')
    expect(store.get().view.activeTab).toBe('b')
    actions.run('goToTab9')
    expect(store.get().view.activeTab).toBe('b')
  })

  it('Ctrl+Tab идёт по MRU, отпустили Ctrl — порядок обновился', () => {
    const tabs = [makeTab('a', 'C:\\p'), makeTab('b', 'C:\\p'), makeTab('c', 'C:\\p')]
    const { store, actions } = setupActions(tabs, { layout: pane('a'), activeTab: 'a' })
    actions.activate('c')
    actions.activate('b')
    actions.activate('a')
    expect(store.get().mru).toEqual(['a', 'b', 'c'])
    actions.run('nextTab')
    expect(store.get().view.activeTab).toBe('b')
    actions.run('nextTab')
    expect(store.get().view.activeTab).toBe('c')
    expect(store.get().mru).toEqual(['a', 'b', 'c'])
    actions.endCycle()
    expect(store.get().mru).toEqual(['c', 'a', 'b'])
    expect(store.get().mruCycle).toBeNull()
    actions.run('prevTab')
    expect(store.get().view.activeTab).toBe('b')
  })

  it('nextAttention: сначала waiting, потом done', () => {
    const tabs = [
      makeTab('a', 'C:\\p'),
      makeTab('b', 'C:\\p', { status: 'done' }),
      makeTab('c', 'C:\\p', { status: 'waiting' })
    ]
    const { store, actions } = setupActions(tabs, { layout: pane('a'), activeTab: 'a' })
    actions.run('nextAttention')
    expect(store.get().view.activeTab).toBe('c')
    actions.run('nextAttention')
    expect(store.get().view.activeTab).toBe('b')
  })

  it('закрытие: вопрос только если Claude работает или ждёт, остальное закрывается сразу', () => {
    const tabs = [
      makeTab('a', 'C:\\p', { kind: 'claude', status: 'working' }),
      makeTab('b', 'C:\\p'),
      makeTab('c', 'C:\\p', { kind: 'claude', status: 'idle' }),
      makeTab('d', 'C:\\p', { kind: 'claude', status: 'waiting' })
    ]
    const { store, actions, calls } = setupActions(tabs, { layout: pane('a'), activeTab: 'a' })
    actions.run('closeTab')
    expect(store.get().overlay).toEqual({ type: 'confirm-close', tab: 'a' })
    expect(calls.closeTab).toEqual([])
    actions.confirmClose('a')
    expect(calls.closeTab).toEqual(['a'])
    expect(store.get().overlay).toBeNull()
    // живая консоль и свободный Claude — без вопроса
    actions.requestClose('b')
    actions.requestClose('c')
    expect(calls.closeTab).toEqual(['a', 'b', 'c'])
    actions.requestClose('d')
    expect(store.get().overlay).toEqual({ type: 'confirm-close', tab: 'd' })
  })

  it('переименование: пробелы по краям обрезаются, диалог закрывается', () => {
    const { store, actions, calls } = setupActions([makeTab('a', 'C:\\p')], { layout: pane('a'), activeTab: 'a' })
    actions.run('rename')
    expect(store.get().overlay).toEqual({ type: 'rename', tab: 'a' })
    actions.renameTab('a', '  тесты ')
    expect(calls.renameTab).toEqual([['a', 'тесты']])
    expect(store.get().overlay).toBeNull()
    expect(calls.focus.at(-1)).toBe('a')
  })

  it('палитра: повторное сочетание закрывает, страницы и «назад»', async () => {
    const { store, actions } = setupActions([makeTab('a', 'C:\\p')], { layout: pane('a'), activeTab: 'a' })
    actions.run('palette')
    expect(store.get().overlay).toEqual({ type: 'palette', mode: { page: 'root' }, back: [] })
    actions.run('palette')
    expect(store.get().overlay).toBeNull()
    actions.run('newTab')
    await actions.runCommand({ type: 'page', mode: { page: 'project', cwd: 'C:\\p' } })
    expect(store.get().overlay).toEqual({
      type: 'palette',
      mode: { page: 'project', cwd: 'C:\\p' },
      back: [{ page: 'new-tab' }]
    })
    expect(actions.paletteBack()).toBe(true)
    expect(store.get().overlay).toEqual({ type: 'palette', mode: { page: 'new-tab' }, back: [] })
    expect(actions.paletteBack()).toBe(false)
  })

  it('меню группы: открывается у курсора, переживает новое состояние, ведёт в палитру', async () => {
    const tabs = [makeTab('a', 'C:\\p')]
    const { store, actions } = setupActions(tabs, { layout: pane('a'), activeTab: 'a' })
    actions.openGroupMenu('C:\\p', 40, 120)
    expect(store.get().overlay).toEqual({ type: 'group-menu', cwd: 'C:\\p', x: 40, y: 120 })
    actions.onState(appState([...tabs, makeTab('b', 'D:\\q')]))
    expect(store.get().overlay).toEqual({ type: 'group-menu', cwd: 'C:\\p', x: 40, y: 120 })
    // «Claude: выбрать разговор…» — палитра без «назад» в меню
    await actions.runCommand({ type: 'page', mode: { page: 'conversations', cwd: 'C:\\p' } })
    expect(store.get().overlay).toEqual({ type: 'palette', mode: { page: 'conversations', cwd: 'C:\\p' }, back: [] })
  })

  it('команды палитры: папка, новая вкладка рядом, оболочка, сплит с открытой вкладкой', async () => {
    const tabs = [makeTab('a', 'C:\\p'), makeTab('b', 'C:\\p')]
    const { store, actions, calls, willCreate } = setupActions(tabs, { layout: pane('a'), activeTab: 'a' })
    actions.run('newTab')
    await actions.runCommand({ type: 'pick-folder', split: 'row' })
    expect(store.get().overlay).toMatchObject({ mode: { page: 'project', cwd: 'D:\\new', split: 'row' } })

    willCreate(makeTab('n', 'C:\\p', { kind: 'claude' }))
    await actions.runCommand({ type: 'open', req: { cwd: 'C:\\p', kind: 'claude', claude: 'new' }, split: 'column' })
    expect(calls.createTab).toEqual([{ cwd: 'C:\\p', kind: 'claude', claude: 'new' }])
    expect(store.get().view.layout).toEqual(column('a', 'n'))
    expect(store.get().overlay).toBeNull()

    await actions.runCommand({ type: 'split-with', tab: 'b', dir: 'column' })
    expect(layoutTabs(store.get().view.layout)).toEqual(['a', 'n', 'b'])
    expect(store.get().view.activeTab).toBe('b')

    await actions.runCommand({ type: 'set-shell', tab: 'a', shell: 'cmd' })
    expect(calls.startTab).toEqual([['a', 'cmd']])
    await actions.runCommand({ type: 'open-config' })
    await actions.runCommand({ type: 'action', id: 'doNotDisturb' })
    expect(calls.other).toEqual(['openConfig', 'toggleDoNotDisturb'])
  })

  it('выбор папки отменён — палитра остаётся на месте', async () => {
    const { store, actions } = setupActions([], {}, { pickFolder: null })
    actions.run('newTab')
    await actions.runCommand({ type: 'pick-folder' })
    expect(store.get().overlay).toEqual({ type: 'palette', mode: { page: 'new-tab' }, back: [] })
  })

  it('консоль проекта: создать, скрыть, показать снова', async () => {
    const claude = makeTab('c', 'C:\\p', { kind: 'claude', status: 'idle' })
    const { store, actions, calls, willCreate } = setupActions([claude], { layout: pane('c'), activeTab: 'c' })
    willCreate(makeTab('s', 'C:\\p'))
    await actions.toggleConsole()
    expect(calls.createTab).toEqual([{ cwd: 'C:\\p', kind: 'shell' }])
    expect(store.get().view.layout).toEqual(column('c', 's'))
    expect(store.get().view.activeTab).toBe('s')
    await actions.toggleConsole()
    expect(store.get().view.layout).toEqual(pane('c'))
    expect(store.get().view.activeTab).toBe('c')
    await actions.toggleConsole()
    expect(store.get().view.layout).toEqual(column('c', 's'))
    expect(calls.createTab).toHaveLength(1)
  })

  it('стрелка Claude-вкладки: раскрытие перечитывает разговоры, закрытая вкладка забывается', async () => {
    const tabs = [makeTab('a', 'C:\\p', { kind: 'claude' }), makeTab('b', 'C:\\p', { kind: 'claude' })]
    const projects: Project[] = [
      { cwd: 'C:\\p', name: 'p', lastUsed: 1, conversations: [{ sessionId: 's1', cwd: 'C:\\p', title: 'x', mtime: 1 }] }
    ]
    const { store, actions, calls } = setupActions(tabs, { layout: pane('a'), activeTab: 'a' }, { projects })
    expect(store.get().historyTabs).toEqual([])
    expect(store.get().projects).toBeNull()
    await actions.toggleHistory('a')
    expect(store.get().historyTabs).toEqual(['a'])
    expect(store.get().projects).toEqual(projects)
    await actions.toggleHistory('b')
    expect(store.get().historyTabs).toEqual(['a', 'b'])
    // свернуть — без чтения
    await actions.toggleHistory('a')
    expect(store.get().historyTabs).toEqual(['b'])
    expect(calls.other).toEqual(['listProjects', 'listProjects'])
    actions.onState(appState([tabs[0]]))
    expect(store.get().historyTabs).toEqual([])
  })

  it('разговоры не прочитались — список пустой, а не вечная загрузка', async () => {
    const tabs = [makeTab('a', 'C:\\p', { kind: 'claude' })]
    const { store, actions } = setupActions(tabs, { layout: pane('a'), activeTab: 'a' }, { projects: new Error('EACCES') })
    await actions.toggleHistory('a')
    expect(store.get().projects).toEqual([])
  })

  it('разговор из панели: уже открытый — переход на его вкладку, иначе новая вкладка с resume', async () => {
    const tabs = [
      makeTab('a', 'C:\\p', { kind: 'claude', claudeSessionId: 's1' }),
      makeTab('b', 'C:\\p', { kind: 'claude', claudeSessionId: 's2' }),
      makeTab('sh', 'C:\\p')
    ]
    const { store, actions, calls, willCreate } = setupActions(tabs, { layout: pane('a'), activeTab: 'a' })
    await actions.resumeConversation({ sessionId: 's2', cwd: 'C:\\p', title: 'x', mtime: 0 })
    expect(store.get().view.activeTab).toBe('b')
    expect(calls.createTab).toEqual([])

    willCreate(makeTab('n', 'C:\\p', { kind: 'claude', claudeSessionId: 's3' }))
    await actions.resumeConversation({ sessionId: 's3', cwd: 'C:\\p', title: 'y', mtime: 0 })
    expect(calls.createTab).toEqual([{ cwd: 'C:\\p', kind: 'claude', claude: 'resume', sessionId: 's3' }])
    expect(store.get().view.activeTab).toBe('n')
  })

  it('поиск открывается и закрывается тем же сочетанием', () => {
    const { store, actions } = setupActions([makeTab('a', 'C:\\p')], { layout: pane('a'), activeTab: 'a' })
    actions.run('search')
    expect(store.get().search).toBe('a')
    actions.run('search')
    expect(store.get().search).toBeNull()
  })

  it('вкладку закрыли — её диалог и строка поиска закрываются', () => {
    const tabs = [makeTab('a', 'C:\\p'), makeTab('b', 'C:\\p')]
    const { store, actions } = setupActions(tabs, { layout: pane('a'), activeTab: 'a' })
    actions.run('search')
    actions.run('rename')
    actions.onState(appState([tabs[1]]))
    expect(store.get().overlay).toBeNull()
    expect(store.get().search).toBeNull()
  })

  it('новый config.json пересобирает клавиши и показывает ошибки', () => {
    const { store, actions } = setupActions([makeTab('a', 'C:\\p')], { layout: pane('a'), activeTab: 'a' })
    expect(store.get().keymapErrors).toEqual([])
    const config = structuredClone(DEFAULT_CONFIG)
    config.keybindings.palette = 'Ctrl+Щ'
    actions.onConfig(config)
    expect(store.get().keymapErrors).toEqual(['keybindings.palette: не удалось разобрать «Ctrl+Щ»'])
    expect([...store.get().keymap.values()]).not.toContain('palette')
  })
})
