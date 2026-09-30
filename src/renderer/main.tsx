import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { createRoot } from 'react-dom/client'
import { createActions } from './actions'
import { App } from './components/App'
import { AppCtx } from './context'
import { createStore, initialUiState, type UiState } from './store'
import { TerminalViews } from './terminal-view'

async function boot(): Promise<void> {
  const api = window.t3000
  const init = await api.getInit()
  const store = createStore<UiState>(initialUiState(init, Date.now()))
  const views = new TerminalViews(api, () => ({ config: store.get().config, osBuild: init.osBuild }))
  const actions = createActions({ store, api, views, pageVisible: () => document.visibilityState === 'visible' })

  api.onState((s) => actions.onState(s))
  api.onConfig((c) => actions.onConfig(c))
  api.onPtyData((tab, seq, data) => views.onData(tab, seq, data))
  api.onFocusTab((tab) => actions.activate(tab))

  // файл, брошенный мимо терминала, не должен открыться в окне
  document.addEventListener('dragover', (e) => e.preventDefault())
  document.addEventListener('drop', (e) => e.preventDefault())
  // окно свернули или развернули — меняются видимые вкладки
  document.addEventListener('visibilitychange', () => actions.refreshView())
  setInterval(() => store.set({ now: Date.now() }), 1000)
  // сообщить main, какие вкладки видны: спящие видимые вкладки стартуют
  actions.refreshView()

  const root = document.getElementById('root')
  if (!root) return
  createRoot(root).render(
    <AppCtx.Provider value={{ store, api, views, actions }}>
      <App />
    </AppCtx.Provider>
  )
}

void boot()
