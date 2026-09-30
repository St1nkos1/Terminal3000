import type { Banner as BannerData } from '../../shared/types'
import { bannerKey, visibleBanners } from '../actions'
import { useApp } from '../context'
import { useStore } from '../store'

export function Banners() {
  const { store, actions } = useApp()
  const banners = useStore(store, (s) => s.app.banners)
  const keymapErrors = useStore(store, (s) => s.keymapErrors)
  const dismissed = useStore(store, (s) => s.dismissedBanners)
  const all: BannerData[] = [...banners]
  if (keymapErrors.length > 0) {
    const more = keymapErrors.length > 1 ? ` (и ещё ${keymapErrors.length - 1})` : ''
    all.push({
      id: 'keymap-errors',
      level: 'warn',
      text: `Ошибки в клавишах: ${keymapErrors[0]}${more}`,
      action: { label: 'Открыть config.json', command: 'open-config' }
    })
  }
  return (
    <div className="banners">
      {visibleBanners(all, dismissed).map((b) => {
        const action = b.action
        return (
          <div key={b.id} className={`banner banner-${b.level}`}>
            <span className="banner-text">{b.text}</span>
            {action && (
              <button className="btn" onClick={() => void actions.bannerCommand(action.command)}>
                {action.label}
              </button>
            )}
            <button className="banner-close" title="Скрыть до перезапуска" onClick={() => actions.dismissBanner(bannerKey(b))}>
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
