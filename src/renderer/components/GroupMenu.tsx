import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useApp } from '../context'
import { groupMenuItems, type MenuItem } from '../palette-pages'
import type { Overlay } from '../store'
import { usePaletteData, useProjects } from './Palette'

// Зазор между меню и краем окна
const EDGE = 4

// Следующий доступный пункт по кругу; -1 — доступных нет
function step(items: MenuItem[], from: number, dir: 1 | -1): number {
  const len = items.length
  // без выбора вверх — с последнего пункта
  const start = from < 0 && dir === -1 ? 0 : from
  for (let n = 1; n <= len; n++) {
    const i = (((start + dir * n) % len) + len) % len
    if (items[i].command) return i
  }
  return -1
}

export function GroupMenu({ overlay }: { overlay: Extract<Overlay, { type: 'group-menu' }> }) {
  const { actions } = useApp()
  const projects = useProjects()
  const items = groupMenuItems(usePaletteData(projects), overlay.cwd)
  const [index, setIndex] = useState(-1)
  const [pos, setPos] = useState({ left: overlay.x, top: overlay.y })
  const ref = useRef<HTMLDivElement>(null)

  // у края окна меню сдвигается внутрь; пунктов всегда столько же, хватает замера при открытии
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      left: Math.max(EDGE, Math.min(overlay.x, window.innerWidth - width - EDGE)),
      top: Math.max(EDGE, Math.min(overlay.y, window.innerHeight - height - EDGE))
    })
    el.focus()
  }, [overlay.x, overlay.y])

  // как системное меню: закрывается, когда окно теряет фокус или меняет размер
  useEffect(() => {
    const close = () => actions.closeOverlay()
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [actions])

  const run = (item: MenuItem | undefined) => {
    if (item?.command) void actions.runCommand(item.command)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex(step(items, index, e.key === 'ArrowDown' ? 1 : -1))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      run(items[index])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      actions.closeOverlay()
    }
  }

  return (
    <div
      className="menu-backdrop"
      onMouseDown={() => actions.closeOverlay()}
      onContextMenu={(e) => {
        e.preventDefault()
        actions.closeOverlay()
      }}
    >
      <div
        ref={ref}
        role="menu"
        tabIndex={-1}
        className="context-menu"
        style={pos}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        onMouseLeave={() => setIndex(-1)}
        onKeyDown={onKeyDown}
      >
        {items.map((item, i) => (
          <Fragment key={item.key}>
            {item.separator && <div role="separator" className="menu-separator" />}
            <div
              role="menuitem"
              aria-disabled={!item.command}
              className={`menu-item${item.command ? '' : ' disabled'}${i === index ? ' current' : ''}`}
              title={item.detail || undefined}
              onMouseMove={() => setIndex(item.command ? i : -1)}
              onClick={() => run(item)}
            >
              {item.label}
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  )
}
