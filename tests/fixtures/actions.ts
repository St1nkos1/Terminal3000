import { DEFAULT_CONFIG } from '../../src/main/config'
import { createActions, type ViewsControl } from '../../src/renderer/actions'
import { createStore, initialUiState, type UiState } from '../../src/renderer/store'
import type { T3000Api } from '../../src/shared/ipc'
import {
  EMPTY_SIDEBAR,
  type AppState,
  type HooksState,
  type NewTabRequest,
  type Project,
  type TabInfo,
  type ViewState
} from '../../src/shared/types'

export function appState(tabs: TabInfo[], extra: Partial<AppState> = {}): AppState {
  return { tabs, hooks: { state: 'installed' }, doNotDisturb: false, firstRun: false, banners: [], ...extra }
}

export interface SetupOptions {
  visible?: boolean
  pickFolder?: string | null
  app?: Partial<AppState>
  // что вернёт listProjects; Error — чтение не удалось
  projects?: Project[] | Error
}

export function setupActions(tabs: TabInfo[], view: Partial<ViewState> = {}, opts: SetupOptions = {}) {
  const calls = {
    updateView: [] as ViewState[],
    createTab: [] as NewTabRequest[],
    closeTab: [] as string[],
    setTabCwd: [] as [string, string][],
    startTab: [] as [string, string | undefined][],
    renameTab: [] as [string, string][],
    focus: [] as string[],
    pruned: [] as string[][],
    other: [] as string[]
  }
  const init = {
    state: appState(tabs, opts.app),
    config: structuredClone(DEFAULT_CONFIG),
    view: { layout: null, activeTab: null, sidebar: EMPTY_SIDEBAR, visibleTabs: [], ...view },
    osBuild: 26200,
    homeDir: 'C:\\Users\\u'
  }
  const store = createStore<UiState>(initialUiState(init, 0))
  // вкладки, которые по очереди вернёт createTab
  const nextTabs: TabInfo[] = []
  const api = {
    updateView: (v: ViewState) => {
      calls.updateView.push(v)
    },
    // как main: состояние с новой вкладкой приходит раньше ответа createTab
    createTab: async (req: NewTabRequest) => {
      calls.createTab.push(req)
      const t = nextTabs.shift()
      if (!t) return null
      actions.onState({ ...store.get().app, tabs: [...store.get().app.tabs, t] })
      return t.id
    },
    closeTab: (tab: string) => {
      calls.closeTab.push(tab)
    },
    setTabCwd: (tab: string, cwd: string) => {
      calls.setTabCwd.push([tab, cwd])
    },
    startTab: (tab: string, shell?: string) => {
      calls.startTab.push([tab, shell])
    },
    renameTab: (tab: string, title: string) => {
      calls.renameTab.push([tab, title])
    },
    listProjects: async (): Promise<Project[]> => {
      calls.other.push('listProjects')
      if (opts.projects instanceof Error) throw opts.projects
      return structuredClone(opts.projects ?? [])
    },
    pickFolder: async () => (opts.pickFolder === undefined ? 'D:\\new' : opts.pickFolder),
    toggleDoNotDisturb: () => {
      calls.other.push('toggleDoNotDisturb')
    },
    openConfig: () => {
      calls.other.push('openConfig')
    },
    installHooks: async (): Promise<HooksState> => {
      calls.other.push('installHooks')
      return { state: 'installed' }
    },
    uninstallHooks: async (): Promise<HooksState> => {
      calls.other.push('uninstallHooks')
      return { state: 'missing' }
    },
    dismissWelcome: () => {
      calls.other.push('dismissWelcome')
    }
  } as unknown as T3000Api
  const views: ViewsControl = {
    focus: (tab) => {
      calls.focus.push(tab)
    },
    prune: (known) => {
      calls.pruned.push([...known])
    },
    applyConfig: () => undefined
  }
  const actions = createActions({ store, api, views, pageVisible: () => opts.visible ?? true })
  return {
    store,
    actions,
    calls,
    willCreate: (...t: TabInfo[]) => {
      nextTabs.push(...t)
    }
  }
}
