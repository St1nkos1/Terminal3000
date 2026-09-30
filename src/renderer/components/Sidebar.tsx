import { Fragment, useMemo } from 'react'
import { layoutTabs } from '../../shared/layout'
import type { TabInfo } from '../../shared/types'
import { useApp } from '../context'
import { formatAge, tabHistory } from '../palette-pages'
import { useStore } from '../store'
import {
  formatDuration,
  groupTabs,
  paneTitle,
  showsDuration,
  STATUS_ICON,
  statusText,
  tabLabel
} from '../tab-order'

function TabRow({
  tab,
  active,
  shown,
  now,
  hooksInstalled,
  expanded
}: {
  tab: TabInfo
  active: boolean
  shown: boolean
  now: number
  hooksInstalled: boolean
  expanded: boolean
}) {
  const { actions } = useApp()
  // у обычной консоли текст статуса не нужен, хватает иконки
  const state = tab.status === 'shell' ? '' : statusText(tab, hooksInstalled, now)
  const time = showsDuration(tab.status) ? ` ${formatDuration(now - tab.statusSince)}` : ''
  // строка — div: внутри неё своя кнопка закрытия, а кнопка в кнопке недопустима
  return (
    <div
      role="button"
      tabIndex={0}
      className={`tab-row status-${tab.status}${active ? ' active' : ''}${shown ? ' shown' : ''}`}
      title={paneTitle(tab)}
      onClick={() => actions.activate(tab.id)}
      onDoubleClick={() => actions.startRename(tab.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') actions.activate(tab.id)
      }}
      // средняя кнопка мыши закрывает вкладку, как в браузере
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault()
      }}
      onAuxClick={(e) => {
        if (e.button === 1) actions.requestClose(tab.id)
      }}
    >
      {tab.kind === 'claude' && (
        <button
          className="tab-expand"
          title={expanded ? 'Скрыть прошлые разговоры' : 'Прошлые разговоры проекта'}
          aria-expanded={expanded}
          onClick={(e) => {
            e.stopPropagation()
            void actions.toggleHistory(tab.id)
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {expanded ? '▾' : '▸'}
        </button>
      )}
      <span className="icon">{STATUS_ICON[tab.status]}</span>
      <span className="label">{tabLabel(tab)}</span>
      <span className="state">
        {state}
        {time}
      </span>
      <button
        className="tab-close"
        title="Закрыть вкладку"
        onClick={(e) => {
          e.stopPropagation()
          actions.requestClose(tab.id)
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        ✕
      </button>
    </div>
  )
}

// Прошлые разговоры проекта под Claude-вкладкой; ● — разговор уже открыт в другой вкладке
function TabHistoryList({ tab, now }: { tab: TabInfo; now: number }) {
  const { store, actions } = useApp()
  const projects = useStore(store, (s) => s.projects)
  const tabs = useStore(store, (s) => s.app.tabs)
  const history = useMemo(() => (projects ? tabHistory(tab, projects, tabs) : null), [tab, projects, tabs])
  if (!history) return <div className="history-note">загрузка…</div>
  if (history.items.length === 0) return <div className="history-note">других разговоров нет</div>
  const all = () => actions.openPalette({ page: 'conversations', cwd: tab.cwd })
  return (
    <div className="history">
      {history.items.map(({ conversation: c, openIn }) => {
        // в этой вкладке; с Ctrl — в новой, как раньше
        const resume = (newTab: boolean) => void actions.resumeConversation(c, newTab ? undefined : tab.id)
        const when = new Date(c.mtime).toLocaleString('ru-RU')
        return (
          <div
            key={c.sessionId}
            role="button"
            tabIndex={0}
            className="history-row"
            title={`${c.title}\n${when}${openIn ? '\nуже открыт во вкладке' : '\nCtrl+клик — в новой вкладке'}`}
            onClick={(e) => resume(e.ctrlKey)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') resume(e.ctrlKey)
            }}
          >
            <span className="history-mark">{openIn ? '●' : ''}</span>
            <span className="label">{c.title}</span>
            <span className="state">{formatAge(now - c.mtime)}</span>
          </div>
        )
      })}
      {history.more && (
        <div
          role="button"
          tabIndex={0}
          className="history-row more"
          onClick={all}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') all()
          }}
        >
          <span className="history-mark" />
          <span className="label">Все разговоры ({history.total})…</span>
        </div>
      )}
    </div>
  )
}

export function Sidebar() {
  const { store, actions } = useApp()
  const tabs = useStore(store, (s) => s.app.tabs)
  const sidebar = useStore(store, (s) => s.view.sidebar)
  const activeTab = useStore(store, (s) => s.view.activeTab)
  const layout = useStore(store, (s) => s.view.layout)
  const now = useStore(store, (s) => s.now)
  const hooksInstalled = useStore(store, (s) => s.app.hooks.state === 'installed')
  const newTabKey = useStore(store, (s) => s.config.keybindings.newTab)
  const historyTabs = useStore(store, (s) => s.historyTabs)
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
              title={`${paneTitle(t)} — ${statusText(t, hooksInstalled, now)}`}
              onClick={() => actions.activate(t.id)}
              onAuxClick={(e) => {
                if (e.button === 1) actions.requestClose(t.id)
              }}
            >
              {STATUS_ICON[t.status]}
            </button>
          ))
        )}
        <button className="mini" title={`Новая вкладка ${newTabKey}`} onClick={() => actions.run('newTab')}>
          +
        </button>
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
              <button
                className="group-head"
                title={g.cwd}
                onClick={() => actions.toggleGroup(g.key)}
                // правый клик — меню нового сеанса в папке группы
                onContextMenu={(e) => {
                  e.preventDefault()
                  actions.openGroupMenu(g.cwd, e.clientX, e.clientY)
                }}
              >
                {collapsed ? '▸' : '▾'} {g.name}
              </button>
              {!collapsed &&
                g.tabs.map((t) => {
                  const expanded = t.kind === 'claude' && historyTabs.includes(t.id)
                  return (
                    <Fragment key={t.id}>
                      <TabRow
                        tab={t}
                        active={t.id === activeTab}
                        shown={shown.has(t.id)}
                        now={now}
                        hooksInstalled={hooksInstalled}
                        expanded={expanded}
                      />
                      {expanded && <TabHistoryList tab={t} now={now} />}
                    </Fragment>
                  )
                })}
            </section>
          )
        })}
      </div>
      <button className="new-tab" onClick={() => actions.run('newTab')}>
        <span>+ Новая вкладка</span>
        <span className="hint">{newTabKey}</span>
      </button>
    </nav>
  )
}
