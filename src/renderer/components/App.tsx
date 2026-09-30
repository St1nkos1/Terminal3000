import { useEffect } from 'react'
import { useApp } from '../context'
import { matchAction } from '../keybindings'
import { useStore } from '../store'
import { Banners } from './Banner'
import { ConfirmClose, ConfirmResume, RenameDialog } from './Dialog'
import { GroupMenu } from './GroupMenu'
import { Palette } from './Palette'
import { PaneTree } from './PaneTree'
import { Sidebar } from './Sidebar'
import { Welcome } from './Welcome'

const ROOT_PATH: number[] = []

export function App() {
  const { store, actions } = useApp()
  const layout = useStore(store, (s) => s.view.layout)
  const overlay = useStore(store, (s) => s.overlay)
  const newTabKey = useStore(store, (s) => s.config.keybindings.newTab)
  const firstRun = useStore(store, (s) => s.app.firstRun)

  // Сочетания приложения перехватываются в capture на window: раньше xterm и полей ввода
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const id = matchAction(store.get().keymap, e)
      if (!id) return
      e.preventDefault()
      e.stopPropagation()
      // зажатая клавиша повторяет только переключение вкладок
      if (e.repeat && id !== 'nextTab' && id !== 'prevTab') return
      actions.run(id)
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Control') actions.endCycle()
    }
    const blur = () => actions.endCycle()
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('blur', blur)
    }
  }, [store, actions])

  return (
    <div className="app">
      <Sidebar />
      <div className="content">
        <Banners />
        <main className="main">
          {layout ? (
            <PaneTree node={layout} path={ROOT_PATH} />
          ) : (
            <div className="empty">Вкладок нет.{newTabKey ? ` ${newTabKey} — новая вкладка` : ''}</div>
          )}
        </main>
      </div>
      {overlay?.type === 'palette' && <Palette overlay={overlay} />}
      {overlay?.type === 'group-menu' && <GroupMenu overlay={overlay} />}
      {overlay?.type === 'rename' && <RenameDialog tab={overlay.tab} />}
      {overlay?.type === 'confirm-close' && <ConfirmClose tab={overlay.tab} />}
      {overlay?.type === 'confirm-resume' && <ConfirmResume overlay={overlay} />}
      {firstRun && <Welcome />}
    </div>
  )
}
