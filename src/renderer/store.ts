import { useSyncExternalStore } from 'react'
import type { ActionId, AppConfig, AppState, InitData, ViewState } from '../shared/types'
import { buildKeymap } from './keybindings'
import type { PaletteMode } from './palette-pages'
import type { MruCycle } from './tab-order'

export type Overlay =
  | { type: 'palette'; mode: PaletteMode; back: PaletteMode[] }
  | { type: 'rename'; tab: string }
  | { type: 'confirm-close'; tab: string }

export interface UiState {
  app: AppState
  config: AppConfig
  view: ViewState
  osBuild: number
  // последние использованные вкладки, текущая первой
  mru: string[]
  // Ctrl+Tab, пока зажат Ctrl
  mruCycle: MruCycle | null
  // часы для «работает 14с», тикают раз в секунду
  now: number
  overlay: Overlay | null
  // вкладка с открытой строкой поиска
  search: string | null
  keymap: Map<string, ActionId>
  keymapErrors: string[]
  // баннеры, закрытые до конца сеанса (bannerKey)
  dismissedBanners: string[]
}

export interface Store<T> {
  get(): T
  set(patch: Partial<T>): void
  subscribe(cb: () => void): () => void
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial
  const subs = new Set<() => void>()
  return {
    get: () => state,
    set: (patch) => {
      state = { ...state, ...patch }
      for (const cb of subs) cb()
    },
    subscribe: (cb) => {
      subs.add(cb)
      return () => {
        subs.delete(cb)
      }
    }
  }
}

// Селектор возвращает часть состояния или примитив: новый объект на каждый вызов зациклит React
export function useStore<T, R>(store: Store<T>, select: (s: T) => R): R {
  return useSyncExternalStore(store.subscribe, () => select(store.get()))
}

export function initialUiState(init: InitData, now: number): UiState {
  const { map, errors } = buildKeymap(init.config.keybindings)
  return {
    app: init.state,
    config: init.config,
    view: init.view,
    osBuild: init.osBuild,
    mru: init.view.activeTab ? [init.view.activeTab] : [],
    mruCycle: null,
    now,
    overlay: null,
    search: null,
    keymap: map,
    keymapErrors: errors,
    dismissedBanners: []
  }
}
