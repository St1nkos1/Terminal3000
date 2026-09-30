import { useSyncExternalStore } from 'react'
import type { AppConfig, AppState, InitData, ViewState } from '../shared/types'

export interface UiState {
  app: AppState
  config: AppConfig
  view: ViewState
  osBuild: number
  // последние использованные вкладки, текущая первой
  mru: string[]
  // часы для «работает 14с», тикают раз в секунду
  now: number
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
  return {
    app: init.state,
    config: init.config,
    view: init.view,
    osBuild: init.osBuild,
    mru: init.view.activeTab ? [init.view.activeTab] : [],
    now
  }
}
