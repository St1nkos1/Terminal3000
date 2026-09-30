import { useApp } from '../context'
import { useStore } from '../store'
import { PaneTree } from './PaneTree'
import { Sidebar } from './Sidebar'

const ROOT_PATH: number[] = []

export function App() {
  const { store } = useApp()
  const layout = useStore(store, (s) => s.view.layout)
  const newTabKey = useStore(store, (s) => s.config.keybindings.newTab)
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        {layout ? (
          <PaneTree node={layout} path={ROOT_PATH} />
        ) : (
          <div className="empty">Вкладок нет.{newTabKey ? ` ${newTabKey} — новая вкладка` : ''}</div>
        )}
      </main>
    </div>
  )
}
