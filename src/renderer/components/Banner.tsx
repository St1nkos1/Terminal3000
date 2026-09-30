import { useApp } from '../context'
import { useStore } from '../store'

export function Banners() {
  const { store, actions } = useApp()
  const banners = useStore(store, (s) => s.app.banners)
  const keymapErrors = useStore(store, (s) => s.keymapErrors)
  return (
    <div className="banners">
      {banners.map((b) => {
        const action = b.action
        return (
          <div key={b.id} className={`banner banner-${b.level}`}>
            <span className="banner-text">{b.text}</span>
            {action && (
              <button className="btn" onClick={() => void actions.bannerCommand(action.command)}>
                {action.label}
              </button>
            )}
          </div>
        )
      })}
      {keymapErrors.length > 0 && (
        <div className="banner banner-warn">
          <span className="banner-text">
            Ошибки в клавишах: {keymapErrors[0]}
            {keymapErrors.length > 1 ? ` (и ещё ${keymapErrors.length - 1})` : ''}
          </span>
          <button className="btn" onClick={() => void actions.bannerCommand('open-config')}>
            Открыть config.json
          </button>
        </div>
      )}
    </div>
  )
}
