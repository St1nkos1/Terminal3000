import { useEffect, useRef } from 'react'
import type { TabNote } from '../../shared/types'
import { useApp } from '../context'
import { useStore } from '../store'
import { SearchBar } from './SearchBar'
import { formatDuration, paneTitle, showsDuration, STATUS_ICON, statusText } from '../tab-order'

function NoteBar({ tab, note }: { tab: string; note: TabNote }) {
  const { actions } = useApp()
  return (
    <div className="note">
      <span className="note-text">{note.text}</span>
      {note.actions.includes('pick-folder') && (
        <button className="btn" onClick={() => void actions.pickFolderFor(tab)}>
          Выбрать папку
        </button>
      )}
      {note.actions.includes('pick-shell') && (
        <button className="btn" onClick={() => actions.openPalette({ page: 'shell', tab })}>
          Другая оболочка
        </button>
      )}
      {note.actions.includes('close') && (
        <button className="btn" onClick={() => actions.closeTab(tab)}>
          Закрыть вкладку
        </button>
      )}
    </div>
  )
}

export function TerminalPane({ tab }: { tab: string }) {
  const { store, views, actions } = useApp()
  const info = useStore(store, (s) => s.app.tabs.find((t) => t.id === tab))
  const active = useStore(store, (s) => s.view.activeTab === tab)
  const now = useStore(store, (s) => s.now)
  const hooksInstalled = useStore(store, (s) => s.app.hooks.state === 'installed')
  const searching = useStore(store, (s) => s.search === tab)
  const closeKey = useStore(store, (s) => s.config.keybindings.closeTab)
  const host = useRef<HTMLDivElement>(null)

  // элемент терминала переносится в эту панель и уносится при размонтировании, сам терминал живёт дальше
  useEffect(() => {
    const el = host.current
    if (!el) return
    views.show(tab, el)
    return () => views.hide(tab, el)
  }, [tab, views])

  useEffect(() => {
    if (active) views.focus(tab)
  }, [active, tab, views])

  return (
    <div className={`pane${active ? ' active' : ''}`} onMouseDown={() => actions.activate(tab)}>
      {info && (
        <div className={`pane-header status-${info.status}`}>
          <span className="pane-title">{paneTitle(info)}</span>
          <span className="status">
            {STATUS_ICON[info.status]} {statusText(info, hooksInstalled, now)}
            {showsDuration(info.status) ? ` ${formatDuration(now - info.statusSince)}` : ''}
          </span>
          <button
            className="pane-close"
            title={closeKey ? `Закрыть вкладку (${closeKey})` : 'Закрыть вкладку'}
            // mousedown не должен уходить в панель: она заберёт фокус в терминал
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => actions.requestClose(tab)}
          >
            ✕
          </button>
        </div>
      )}
      {info?.note && <NoteBar tab={tab} note={info.note} />}
      {searching && <SearchBar tab={tab} />}
      <div className="pane-body" ref={host} />
    </div>
  )
}
