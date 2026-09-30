import { useState } from 'react'
import { useApp } from '../context'
import { useStore, type Overlay } from '../store'
import { paneTitle, tabLabel } from '../tab-order'

export function RenameDialog({ tab }: { tab: string }) {
  const { store, actions } = useApp()
  const info = useStore(store, (s) => s.app.tabs.find((t) => t.id === tab))
  const [value, setValue] = useState(() => (info?.customTitle ? info.title : ''))
  if (!info) return null
  return (
    <div className="overlay" onMouseDown={() => actions.closeOverlay()}>
      <form
        className="dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          actions.renameTab(tab, value)
        }}
      >
        <div className="dialog-title">Переименовать вкладку</div>
        <input
          autoFocus
          value={value}
          placeholder={`${tabLabel({ ...info, customTitle: false })} — пустое имя вернёт название по папке`}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              actions.closeOverlay()
            }
          }}
        />
        <div className="dialog-buttons">
          <button type="submit" className="btn primary">
            Сохранить
          </button>
          <button type="button" className="btn" onClick={() => actions.closeOverlay()}>
            Отмена
          </button>
        </div>
      </form>
    </div>
  )
}

export function ConfirmClose({ tab }: { tab: string }) {
  const { store, actions } = useApp()
  const info = useStore(store, (s) => s.app.tabs.find((t) => t.id === tab))
  if (!info) return null
  return (
    <div className="overlay" onMouseDown={() => actions.closeOverlay()}>
      <div
        className="dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            actions.closeOverlay()
          }
        }}
      >
        <div className="dialog-title">Закрыть вкладку?</div>
        <p>Claude ещё работает в «{paneTitle(info)}». Если закрыть вкладку, текущее действие прервётся.</p>
        <div className="dialog-buttons">
          <button autoFocus className="btn danger" onClick={() => actions.confirmClose(tab)}>
            Закрыть
          </button>
          <button className="btn" onClick={() => actions.closeOverlay()}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}

export function ConfirmResume({ overlay }: { overlay: Extract<Overlay, { type: 'confirm-resume' }> }) {
  const { store, actions } = useApp()
  const info = useStore(store, (s) => s.app.tabs.find((t) => t.id === overlay.tab))
  if (!info) return null
  return (
    <div className="overlay" onMouseDown={() => actions.closeOverlay()}>
      <div
        className="dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            actions.closeOverlay()
          }
        }}
      >
        <div className="dialog-title">Открыть другой разговор?</div>
        <p>
          Claude ещё работает в «{paneTitle(info)}». Если открыть в этой вкладке «{overlay.conversation.title}», текущее
          действие прервётся. Сам разговор сохранится в списке.
        </p>
        <div className="dialog-buttons">
          <button autoFocus className="btn danger" onClick={() => actions.confirmResume()}>
            Открыть
          </button>
          <button className="btn" onClick={() => actions.closeOverlay()}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}
