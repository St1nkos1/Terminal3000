import type { T3000Api } from '../shared/ipc'
import { layoutTabs, setSizes } from '../shared/layout'
import type { AppConfig, AppState, NewTabRequest, SplitDir, ViewState } from '../shared/types'
import { fixView, placeTab, showTab } from '../shared/view'
import type { Store, UiState } from './store'
import { touchMru } from './tab-order'

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

function sameView(a: ViewState, b: ViewState): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function createActions(d: ActionDeps) {
  const { store, api, views } = d

  // Все изменения вида идут сюда: правило fixView, видимые вкладки, отправка в main
  function setView(next: ViewState): void {
    const s = store.get()
    const fixed = fixView(next, s.app.tabs.map((t) => t.id))
    const view = { ...fixed, visibleTabs: d.pageVisible() ? layoutTabs(fixed.layout) : [] }
    if (sameView(view, s.view)) return
    store.set({ view })
    api.updateView(view)
  }

  function refreshView(): void {
    setView(store.get().view)
  }

  function activate(tab: string, opts: { mru?: boolean } = {}): void {
    if (!store.get().app.tabs.some((t) => t.id === tab)) return
    setView(showTab(store.get().view, tab))
    if (opts.mru !== false) store.set({ mru: touchMru(store.get().mru, tab) })
    views.focus(tab)
  }

  function place(tab: string, split?: SplitDir): void {
    setView(placeTab(store.get().view, tab, split))
    store.set({ mru: touchMru(store.get().mru, tab) })
    views.focus(tab)
  }

  async function openTab(req: NewTabRequest, split?: SplitDir): Promise<string | null> {
    const id = await api.createTab(req)
    if (id) place(id, split)
    return id
  }

  function onState(app: AppState): void {
    const known = new Set(app.tabs.map((t) => t.id))
    store.set({ app, mru: store.get().mru.filter((t) => known.has(t)) })
    views.prune(known)
    // закрытую вкладку убираем из раскладки
    refreshView()
  }

  function onConfig(config: AppConfig): void {
    store.set({ config })
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

  function resizeSplit(path: number[], sizes: number[]): void {
    const v = store.get().view
    if (v.layout) setView({ ...v, layout: setSizes(v.layout, path, sizes) })
  }

  async function pickFolderFor(tab: string): Promise<void> {
    const cwd = await api.pickFolder()
    if (cwd) api.setTabCwd(tab, cwd)
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
    resizeSplit,
    pickFolderFor
  }
}

export type Actions = ReturnType<typeof createActions>
