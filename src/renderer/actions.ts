import { isBusyClaude } from '../shared/busy'
import type { T3000Api } from '../shared/ipc'
import { containsTab, layoutTabs, removeTab, setSizes } from '../shared/layout'
import { cwdKey } from '../shared/text'
import type {
  ActionId,
  AppConfig,
  AppState,
  BannerCommand,
  Conversation,
  NewTabRequest,
  Project,
  SplitDir,
  ViewState
} from '../shared/types'
import { attachConsole, fixView, placeTab, showWithConsole } from '../shared/view'
import { buildKeymap } from './keybindings'
import type { PaletteCommand, PaletteMode } from './palette-pages'
import type { Store, UiState } from './store'
import { consoleStep, conversationTab, mruStep, nextAttention, panelOrder, projectConsole, touchMru } from './tab-order'

export interface ViewsControl {
  focus(tab: string): void
  prune(known: ReadonlySet<string>): void
  applyConfig(config: AppConfig): void
}

export interface ActionDeps {
  store: Store<UiState>
  api: T3000Api
  views: ViewsControl
  // false, когда окно свёрнуто: тогда вкладки не видны
  pageVisible(): boolean
}

// Баннер закрывают до конца сеанса; с другим текстом (новая ошибка) он появится снова
export function bannerKey(b: { id: string; text: string }): string {
  return `${b.id}|${b.text}`
}

export function visibleBanners<T extends { id: string; text: string }>(banners: T[], dismissed: readonly string[]): T[] {
  return banners.filter((b) => !dismissed.includes(bannerKey(b)))
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function createActions(d: ActionDeps) {
  const { store, api, views } = d

  // Все изменения вида идут сюда: правило fixView, видимые вкладки, отправка в main
  function setView(next: ViewState): void {
    const s = store.get()
    const fixed = fixView(next, s.app.tabs.map((t) => t.id))
    const view = { ...fixed, visibleTabs: d.pageVisible() ? layoutTabs(fixed.layout) : [] }
    if (same(view, s.view)) return
    store.set({ view })
    api.updateView(view)
  }

  function refreshView(): void {
    setView(store.get().view)
  }

  // папки, для которых консоль под Claude уже создаётся
  const creatingConsole = new Set<string>()
  // Claude, вставший на экран во время Ctrl+Tab без консоли: её создаст endCycle
  let consoleAfterCycle: string | null = null

  // Вкладка на экран; Claude без явного сплита встаёт парой с консолью своего проекта.
  // true — вкладка пришла на экран, а консоли у проекта нет: её нужно создать
  function show(tab: string, split?: SplitDir): boolean {
    const s = store.get()
    const info = s.app.tabs.find((t) => t.id === tab)
    if (split || !info || info.kind !== 'claude' || !s.config.consoleUnderClaude) {
      setView(placeTab(s.view, tab, split))
      return false
    }
    const onScreen = containsTab(s.view.layout, tab)
    const shell = projectConsole(s.app.tabs, info)
    const shells = new Set(s.app.tabs.filter((t) => t.kind === 'shell').map((t) => t.id))
    setView(showWithConsole(s.view, tab, shell?.id ?? null, (t) => shells.has(t)))
    return !onScreen && !shell
  }

  // Консоль встаёт под вкладкой, если та ещё на экране; на папку заказывается одна
  async function createConsole(tab: string): Promise<void> {
    const info = store.get().app.tabs.find((t) => t.id === tab)
    if (!info) return
    const key = cwdKey(info.cwd)
    if (creatingConsole.has(key)) return
    creatingConsole.add(key)
    try {
      const id = await api.createTab({ cwd: info.cwd, kind: 'shell' })
      if (id) setView(attachConsole(store.get().view, tab, id))
    } finally {
      creatingConsole.delete(key)
    }
  }

  // cycle: Ctrl+Tab — консоль создаётся, только когда отпустят Ctrl,
  // иначе один проход по вкладкам запустит по PowerShell на каждый проект
  function activate(tab: string, opts: { mru?: boolean; cycle?: boolean } = {}): void {
    if (!store.get().app.tabs.some((t) => t.id === tab)) return
    const needsConsole = show(tab)
    if (opts.mru !== false) store.set({ mru: touchMru(store.get().mru, tab) })
    views.focus(tab)
    if (opts.cycle) consoleAfterCycle = needsConsole ? tab : null
    else if (needsConsole) void createConsole(tab)
  }

  function place(tab: string, split?: SplitDir): void {
    const needsConsole = show(tab, split)
    store.set({ mru: touchMru(store.get().mru, tab) })
    views.focus(tab)
    if (needsConsole) void createConsole(tab)
  }

  async function openTab(req: NewTabRequest, split?: SplitDir): Promise<string | null> {
    const id = await api.createTab(req)
    if (id) place(id, split)
    return id
  }

  function onState(app: AppState): void {
    const known = new Set(app.tabs.map((t) => t.id))
    const s = store.get()
    // диалог и строка поиска закрытой вкладки больше не нужны
    const overlay = s.overlay && 'tab' in s.overlay && !known.has(s.overlay.tab) ? null : s.overlay
    const search = s.search && known.has(s.search) ? s.search : null
    const historyTabs = s.historyTabs.filter((t) => known.has(t))
    store.set({ app, mru: s.mru.filter((t) => known.has(t)), overlay, search, historyTabs })
    views.prune(known)
    // закрытую вкладку убираем из раскладки
    refreshView()
  }

  function onConfig(config: AppConfig): void {
    const { map, errors } = buildKeymap(config.keybindings)
    store.set({ config, keymap: map, keymapErrors: errors })
    views.applyConfig(config)
  }

  // Состояние придёт из main, вид починит onState
  function closeTab(tab: string): void {
    api.closeTab(tab)
  }

  function toggleSidebar(): void {
    const v = store.get().view
    setView({ ...v, sidebar: { ...v.sidebar, collapsed: !v.sidebar.collapsed } })
  }

  function toggleGroup(key: string): void {
    const v = store.get().view
    const groups = v.sidebar.collapsedGroups
    const collapsedGroups = groups.includes(key) ? groups.filter((g) => g !== key) : [...groups, key]
    setView({ ...v, sidebar: { ...v.sidebar, collapsedGroups } })
  }

  // номер последнего чтения разговоров: ответ старого чтения не затирает свежий
  let projectsRead = 0

  // Стрелка Claude-вкладки: при каждом раскрытии список разговоров перечитывается
  async function toggleHistory(tab: string): Promise<void> {
    const open = store.get().historyTabs
    if (open.includes(tab)) {
      store.set({ historyTabs: open.filter((t) => t !== tab) })
      return
    }
    store.set({ historyTabs: [...open, tab] })
    const n = ++projectsRead
    let projects: Project[]
    try {
      projects = await api.listProjects()
    } catch {
      projects = []
    }
    if (n === projectsRead) store.set({ projects })
  }

  // Разговор, уже открытый во вкладке, второй раз не запускается
  async function resumeConversation(c: Conversation): Promise<void> {
    const open = conversationTab(store.get().app.tabs, c.sessionId)
    if (open) activate(open.id)
    else await openTab({ cwd: c.cwd, kind: 'claude', claude: 'resume', sessionId: c.sessionId })
  }

  function resizeSplit(path: number[], sizes: number[]): void {
    const v = store.get().view
    if (v.layout) setView({ ...v, layout: setSizes(v.layout, path, sizes) })
  }

  async function pickFolderFor(tab: string): Promise<void> {
    const cwd = await api.pickFolder()
    if (cwd) api.setTabCwd(tab, cwd)
  }

  // Палитра и диалоги

  function closeOverlay(): void {
    store.set({ overlay: null })
    const active = store.get().view.activeTab
    if (active) views.focus(active)
  }

  function openPalette(mode: PaletteMode = { page: 'root' }): void {
    const o = store.get().overlay
    // повторное нажатие того же сочетания закрывает палитру
    if (o?.type === 'palette' && o.back.length === 0 && same(o.mode, mode)) {
      closeOverlay()
      return
    }
    store.set({ overlay: { type: 'palette', mode, back: [] } })
  }

  function openGroupMenu(cwd: string, x: number, y: number): void {
    store.set({ overlay: { type: 'group-menu', cwd, x, y } })
  }

  function palettePage(mode: PaletteMode): void {
    const o = store.get().overlay
    const back = o?.type === 'palette' ? [...o.back, o.mode] : []
    store.set({ overlay: { type: 'palette', mode, back } })
  }

  function paletteBack(): boolean {
    const o = store.get().overlay
    if (o?.type !== 'palette' || o.back.length === 0) return false
    store.set({ overlay: { type: 'palette', mode: o.back[o.back.length - 1], back: o.back.slice(0, -1) } })
    return true
  }

  async function runCommand(c: PaletteCommand): Promise<void> {
    switch (c.type) {
      case 'show-tab':
        closeOverlay()
        activate(c.tab)
        return
      case 'page':
        palettePage(c.mode)
        return
      case 'open':
        closeOverlay()
        await openTab(c.req, c.split)
        return
      case 'pick-folder': {
        const cwd = await api.pickFolder()
        if (cwd) palettePage({ page: 'project', cwd, ...(c.split ? { split: c.split } : {}) })
        return
      }
      case 'split-with':
        closeOverlay()
        place(c.tab, c.dir)
        return
      case 'set-shell':
        closeOverlay()
        api.startTab(c.tab, c.shell)
        return
      case 'action':
        closeOverlay()
        run(c.id)
        return
      case 'open-config':
        closeOverlay()
        api.openConfig()
        return
      case 'toggle-sidebar':
        closeOverlay()
        toggleSidebar()
        return
      case 'install-hooks':
        closeOverlay()
        await installHooks()
        return
      case 'uninstall-hooks':
        closeOverlay()
        await uninstallHooks()
        return
    }
  }

  function startRename(tab: string): void {
    store.set({ overlay: { type: 'rename', tab } })
  }

  function renameTab(tab: string, title: string): void {
    api.renameTab(tab, title.trim())
    closeOverlay()
  }

  function requestClose(tab: string): void {
    const info = store.get().app.tabs.find((t) => t.id === tab)
    if (!info) return
    // консоль и свободный Claude закрываются сразу, вопрос — только если Claude работает или ждёт
    if (isBusyClaude(info)) store.set({ overlay: { type: 'confirm-close', tab } })
    else closeTab(tab)
  }

  function confirmClose(tab: string): void {
    store.set({ overlay: null })
    closeTab(tab)
  }

  function closeSearch(): void {
    const tab = store.get().search
    store.set({ search: null })
    if (tab) views.focus(tab)
  }

  // Ctrl+Tab / Ctrl+Shift+Tab: MRU не меняется, пока зажат Ctrl
  function cycle(dir: 1 | -1): void {
    const s = store.get()
    const r = mruStep(s.mru, s.mruCycle, dir)
    if (!r) return
    store.set({ mruCycle: r.cycle })
    activate(r.tab, { mru: false, cycle: true })
  }

  function endCycle(): void {
    const s = store.get()
    if (!s.mruCycle) return
    const active = s.view.activeTab
    store.set({ mruCycle: null, mru: active ? touchMru(s.mru, active) : s.mru })
    const pending = consoleAfterCycle
    consoleAfterCycle = null
    if (pending && pending === active) void createConsole(pending)
  }

  async function toggleConsole(): Promise<void> {
    const s = store.get()
    const step = consoleStep(s.app.tabs, s.view.layout, s.view.activeTab)
    if (!step) return
    if (step.type === 'hide') {
      setView({ ...s.view, layout: removeTab(s.view.layout, step.tab), activeTab: step.back })
      views.focus(step.back)
    } else if (step.type === 'show') {
      place(step.tab, 'column')
    } else {
      await openTab({ cwd: step.cwd, kind: 'shell' }, 'column')
    }
  }

  // Новое состояние хуков придёт из main вместе с AppState
  async function installHooks(): Promise<void> {
    await api.installHooks()
  }

  async function uninstallHooks(): Promise<void> {
    await api.uninstallHooks()
  }

  function dismissWelcome(): void {
    api.dismissWelcome()
  }

  async function welcomeInstall(): Promise<void> {
    await installHooks()
    dismissWelcome()
  }

  async function bannerCommand(c: BannerCommand): Promise<void> {
    if (c === 'install-hooks') await installHooks()
    else api.openConfig()
  }

  function dismissBanner(key: string): void {
    const dismissed = store.get().dismissedBanners
    if (!dismissed.includes(key)) store.set({ dismissedBanners: [...dismissed, key] })
  }

  function run(id: ActionId): void {
    const s = store.get()
    const active = s.view.activeTab
    switch (id) {
      case 'palette':
        openPalette()
        return
      case 'newTab':
        openPalette({ page: 'new-tab' })
        return
      case 'nextTab':
        cycle(1)
        return
      case 'prevTab':
        cycle(-1)
        return
      case 'nextAttention': {
        const tab = nextAttention(s.app.tabs, active)
        if (tab) activate(tab)
        return
      }
      case 'toggleConsole':
        void toggleConsole()
        return
      case 'splitVertical':
        if (active) openPalette({ page: 'split', dir: 'row' })
        return
      case 'splitHorizontal':
        if (active) openPalette({ page: 'split', dir: 'column' })
        return
      case 'search':
        if (active && s.search === active) closeSearch()
        else if (active) store.set({ search: active })
        return
      case 'rename':
        if (active) startRename(active)
        return
      case 'closeTab':
        if (active) requestClose(active)
        return
      case 'doNotDisturb':
        api.toggleDoNotDisturb()
        return
      default: {
        // goToTab1…goToTab9
        const tab = panelOrder(s.app.tabs)[Number(id.slice('goToTab'.length)) - 1]
        if (tab) activate(tab)
      }
    }
  }

  return {
    setView,
    refreshView,
    activate,
    place,
    openTab,
    onState,
    onConfig,
    closeTab,
    toggleSidebar,
    toggleGroup,
    toggleHistory,
    resumeConversation,
    resizeSplit,
    pickFolderFor,
    run,
    runCommand,
    openPalette,
    openGroupMenu,
    paletteBack,
    closeOverlay,
    startRename,
    renameTab,
    requestClose,
    confirmClose,
    closeSearch,
    endCycle,
    toggleConsole,
    installHooks,
    uninstallHooks,
    dismissWelcome,
    welcomeInstall,
    bannerCommand,
    dismissBanner
  }
}

export type Actions = ReturnType<typeof createActions>
