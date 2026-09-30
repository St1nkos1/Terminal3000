import { useEffect, useState } from 'react'
import { useApp } from '../context'

export function SearchBar({ tab }: { tab: string }) {
  const { views, actions } = useApp()
  const [query, setQuery] = useState('')
  const [miss, setMiss] = useState(false)

  // строку закрыли — подсветка совпадений уходит
  useEffect(() => () => views.get(tab)?.clearSearch(), [tab, views])

  const find = (q: string, dir: 'next' | 'prev') => {
    const found = views.get(tab)?.find(q, dir) ?? false
    setMiss(q !== '' && !found)
  }

  return (
    // mousedown не должен уходить в панель: она заберёт фокус в терминал
    <div className="search-bar" onMouseDown={(e) => e.stopPropagation()}>
      <input
        autoFocus
        className={miss ? 'miss' : ''}
        value={query}
        placeholder="Поиск в выводе"
        onChange={(e) => {
          setQuery(e.target.value)
          find(e.target.value, 'next')
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            find(query, e.shiftKey ? 'prev' : 'next')
          } else if (e.key === 'Escape') {
            e.preventDefault()
            actions.closeSearch()
          }
        }}
      />
      <button className="btn" title="Предыдущее (Shift+Enter)" onClick={() => find(query, 'prev')}>
        ↑
      </button>
      <button className="btn" title="Следующее (Enter)" onClick={() => find(query, 'next')}>
        ↓
      </button>
      <button className="btn" title="Закрыть (Esc)" onClick={() => actions.closeSearch()}>
        ✕
      </button>
    </div>
  )
}
