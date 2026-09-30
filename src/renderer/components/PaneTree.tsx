import { Fragment, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { layoutTabs } from '../../shared/layout'
import type { LayoutNode } from '../../shared/types'
import { useApp } from '../context'
import { TerminalPane } from './TerminalPane'

type SplitNode = Extract<LayoutNode, { type: 'split' }>

// меньше 5% панель сжать нельзя
const MIN_SIZE = 0.05

function childKey(node: LayoutNode): string {
  return (node.type === 'pane' ? 'p:' : 's:') + layoutTabs(node)[0]
}

function Split({ node, path }: { node: SplitNode; path: number[] }) {
  const { actions } = useApp()
  const box = useRef<HTMLDivElement>(null)

  const startDrag = (i: number, e: ReactPointerEvent) => {
    const el = box.current
    if (!el) return
    e.preventDefault()
    const rect = el.getBoundingClientRect()
    const row = node.dir === 'row'
    const total = row ? rect.width : rect.height
    const start = row ? e.clientX : e.clientY
    const sizes = [...node.sizes]
    const pair = sizes[i] + sizes[i + 1]
    const move = (ev: PointerEvent) => {
      const delta = ((row ? ev.clientX : ev.clientY) - start) / total
      const a = Math.min(pair - MIN_SIZE, Math.max(MIN_SIZE, sizes[i] + delta))
      const next = [...sizes]
      next[i] = a
      next[i + 1] = pair - a
      actions.resizeSplit(path, next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div ref={box} className={`split split-${node.dir}`}>
      {node.children.map((child, i) => (
        <Fragment key={childKey(child)}>
          {i > 0 && <div className="divider" onPointerDown={(e) => startDrag(i - 1, e)} />}
          <div className="split-cell" style={{ flexGrow: node.sizes[i], flexBasis: 0 }}>
            <PaneTree node={child} path={[...path, i]} />
          </div>
        </Fragment>
      ))}
    </div>
  )
}

export function PaneTree({ node, path }: { node: LayoutNode; path: number[] }) {
  if (node.type === 'pane') return <TerminalPane tab={node.tab} />
  return <Split node={node} path={path} />
}
