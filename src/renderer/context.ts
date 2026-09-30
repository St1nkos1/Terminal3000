import { createContext, useContext } from 'react'
import type { T3000Api } from '../shared/ipc'
import type { Actions } from './actions'
import type { Store, UiState } from './store'
import type { TerminalViews } from './terminal-view'

export interface AppServices {
  store: Store<UiState>
  api: T3000Api
  views: TerminalViews
  actions: Actions
}

export const AppCtx = createContext<AppServices | null>(null)

export function useApp(): AppServices {
  const s = useContext(AppCtx)
  if (!s) throw new Error('AppCtx не задан')
  return s
}
