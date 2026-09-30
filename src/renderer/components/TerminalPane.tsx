import { useEffect, useRef } from 'react'
import type { TabNote } from '../../shared/types'
import { useApp } from '../context'
import { useStore } from '../store'
import { formatDuration, paneTitle, showsDuration, STATUS_ICON, STATUS_LABEL } from '../tab-order'

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
            {STATUS_ICON[info.status]} {STATUS_LABEL[info.status]}
            {showsDuration(info.status) ? ` ${formatDuration(now - info.statusSince)}` : ''}
          </span>
        </div>
      )}
      {info?.note && <NoteBar tab={tab} note={info.note} />}
      <div className="pane-body" ref={host} />
    </div>
  )
}
