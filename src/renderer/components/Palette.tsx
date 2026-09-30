import { useEffect, useState, type KeyboardEvent } from 'react'
import { layoutTabs } from '../../shared/layout'
import type { Project } from '../../shared/types'
import { useApp } from '../context'
import { fuzzyFilter } from '../fuzzy'
import { pageItems, pagePlaceholder, type PaletteData, type PaletteItem, type PaletteMode } from '../palette-pages'
import { useStore, type Overlay } from '../store'

const MAX_ITEMS = 100

// Проекты и разговоры читаются один раз на открытие; null — ещё читаются
export function useProjects(): Project[] | null {
  const { api } = useApp()
  const [projects, setProjects] = useState<Project[] | null>(null)
  useEffect(() => {
    let alive = true
    api.listProjects().then(
      (p) => {
        if (alive) setProjects(p)
      },
      () => {
        if (alive) setProjects([])
      }
    )
    return () => {
      alive = false
    }
  }, [api])
  return projects
}

export function usePaletteData(projects: Project[] | null): PaletteData {
  const { store } = useApp()
  const tabs = useStore(store, (s) => s.app.tabs)
  const hooks = useStore(store, (s) => s.app.hooks)
  const doNotDisturb = useStore(store, (s) => s.app.doNotDisturb)
  const config = useStore(store, (s) => s.config)
  const view = useStore(store, (s) => s.view)
  const now = useStore(store, (s) => s.now)
  const homeDir = useStore(store, (s) => s.homeDir)
  return {
    tabs,
    projects,
    config,
    hooks,
    doNotDisturb,
    sidebarCollapsed: view.sidebar.collapsed,
    activeTab: view.activeTab,
    layoutTabs: layoutTabs(view.layout),
    now,
    homeDir
  }
}

function PalettePage({ mode, projects }: { mode: PaletteMode; projects: Project[] | null }) {
  const { actions } = useApp()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)

  const data = usePaletteData(projects)
  const items = fuzzyFilter(pageItems(mode, data), query, (i) => `${i.label} ${i.detail}`).slice(0, MAX_ITEMS)
  const current = Math.min(index, Math.max(0, items.length - 1))
  const count = Math.max(1, items.length)

  const run = (item: PaletteItem | undefined) => {
    if (item) void actions.runCommand(item.command)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((current + 1) % count)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((current - 1 + count) % count)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(items[current])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      actions.closeOverlay()
    } else if (e.key === 'Backspace' && query === '' && actions.paletteBack()) {
      e.preventDefault()
    }
  }

  return (
    <>
      <input
        className="palette-input"
        autoFocus
        value={query}
        placeholder={pagePlaceholder(mode)}
        onChange={(e) => {
          setQuery(e.target.value)
          setIndex(0)
        }}
        onKeyDown={onKeyDown}
      />
      <div className="palette-list">
        {items.length === 0 && (
          <div className="palette-empty">{projects === null ? 'Загрузка…' : 'Ничего не найдено'}</div>
        )}
        {items.map((item, i) => (
          <div
            key={item.key}
            ref={i === current ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
            className={`palette-item${i === current ? ' current' : ''}`}
            onMouseMove={() => setIndex(i)}
            onClick={() => run(item)}
          >
            <span className="palette-label">{item.label}</span>
            <span className="palette-detail">{item.detail}</span>
            {item.hint && <span className="palette-hint">{item.hint}</span>}
          </div>
        ))}
      </div>
    </>
  )
}

export function Palette({ overlay }: { overlay: Extract<Overlay, { type: 'palette' }> }) {
  const { actions } = useApp()
  const projects = useProjects()

  return (
    <div className="overlay" onMouseDown={() => actions.closeOverlay()}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        {/* key: строка поиска и выбор сбрасываются при смене страницы */}
        <PalettePage key={JSON.stringify(overlay.mode)} mode={overlay.mode} projects={projects} />
      </div>
    </div>
  )
}
