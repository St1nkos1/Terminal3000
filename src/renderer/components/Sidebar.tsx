import { useMemo } from 'react'
import { layoutTabs } from '../../shared/layout'
import type { TabInfo } from '../../shared/types'
import { useApp } from '../context'
import { useStore } from '../store'
import { formatDuration, groupTabs, paneTitle, showsDuration, STATUS_ICON, STATUS_LABEL, tabLabel } from '../tab-order'

function TabRow({ tab, active, shown, now }: { tab: TabInfo; active: boolean; shown: boolean; now: number }) {
  const { actions } = useApp()
  // у обычной консоли текст статуса не нужен, хватает иконки
  const state = tab.status === 'shell' ? '' : STATUS_LABEL[tab.status]
  const time = showsDuration(tab.status) ? ` ${formatDuration(now - tab.statusSince)}` : ''
  return (
    <button
      className={`tab-row status-${tab.status}${active ? ' active' : ''}${shown ? ' shown' : ''}`}
      title={paneTitle(tab)}
      onClick={() => actions.activate(tab.id)}
    >
      <span className="icon">{STATUS_ICON[tab.status]}</span>
      <span className="label">{tabLabel(tab)}</span>
      <span className="state">
        {state}
        {time}
      </span>
    </button>
  )
}

export function Sidebar() {
  const { store, actions } = useApp()
  const tabs = useStore(store, (s) => s.app.tabs)
  const sidebar = useStore(store, (s) => s.view.sidebar)
  const activeTab = useStore(store, (s) => s.view.activeTab)
  const layout = useStore(store, (s) => s.view.layout)
  const now = useStore(store, (s) => s.now)
  const groups = useMemo(() => groupTabs(tabs), [tabs])
  const shown = useMemo(() => new Set(layoutTabs(layout)), [layout])

  if (sidebar.collapsed) {
    return (
      <nav className="sidebar collapsed">
        <button className="sidebar-toggle" title="Развернуть панель" onClick={() => actions.toggleSidebar()}>
          »
        </button>
        {groups.flatMap((g) =>
          g.tabs.map((t) => (
            <button
              key={t.id}
              className={`mini status-${t.status}${t.id === activeTab ? ' active' : ''}`}
              title={`${paneTitle(t)} — ${STATUS_LABEL[t.status]}`}
              onClick={() => actions.activate(t.id)}
            >
              {STATUS_ICON[t.status]}
            </button>
          ))
        )}
      </nav>
    )
  }

  return (
    <nav className="sidebar">
      <div className="sidebar-head">
        <span>Terminal3000</span>
        <button className="sidebar-toggle" title="Свернуть панель" onClick={() => actions.toggleSidebar()}>
          «
        </button>
      </div>
      <div className="groups">
        {groups.map((g) => {
          const collapsed = sidebar.collapsedGroups.includes(g.key)
          return (
            <section key={g.key} className="group">
              <button className="group-head" title={g.cwd} onClick={() => actions.toggleGroup(g.key)}>
                {collapsed ? '▸' : '▾'} {g.name}
              </button>
              {!collapsed &&
                g.tabs.map((t) => (
                  <TabRow key={t.id} tab={t} active={t.id === activeTab} shown={shown.has(t.id)} now={now} />
                ))}
            </section>
          )
        })}
      </div>
    </nav>
  )
}
