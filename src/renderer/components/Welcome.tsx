import { useState } from 'react'
import type { ActionId } from '../../shared/types'
import { useApp } from '../context'
import { useStore } from '../store'

const KEYS: { id: ActionId; text: string }[] = [
  { id: 'palette', text: 'палитра: вкладки, проекты, прошлые разговоры, команды' },
  { id: 'newTab', text: 'новая вкладка: проект, затем Claude или консоль' },
  { id: 'nextAttention', text: 'к следующей вкладке, которая ждёт или готова' },
  { id: 'toggleConsole', text: 'консоль проекта под текущей вкладкой' },
  { id: 'splitVertical', text: 'разделить панель' },
  { id: 'doNotDisturb', text: '«Не беспокоить»' }
]

export function Welcome() {
  const { store, actions } = useApp()
  const hooks = useStore(store, (s) => s.app.hooks)
  const keybindings = useStore(store, (s) => s.config.keybindings)
  const [busy, setBusy] = useState(false)
  const installed = hooks.state === 'installed'
  const canInstall = hooks.state === 'missing' || hooks.state === 'outdated'

  return (
    <div className="overlay">
      <div className="dialog welcome">
        <div className="dialog-title">Добро пожаловать в Terminal3000</div>
        {installed ? (
          <p>Хуки Claude Code уже установлены: статусы сессий будут видны в панели слева.</p>
        ) : (
          <>
            <p>
              Статусы Claude (работает, ждёт, готово) приходят через хуки Claude Code. Terminal3000 добавит свои записи в
              раздел <code>hooks</code> файла <code>~/.claude/settings.json</code>. Чужие хуки и остальные настройки не
              меняются, рядом сохраняется резервная копия.
            </p>
            <p>
              Хуки срабатывают только для Claude, запущенного в Terminal3000: в других терминалах они сразу завершаются.
              Удалить их можно в палитре командой «Удалить хуки Claude Code».
            </p>
            {hooks.state === 'broken' && (
              <p className="welcome-error">
                Не удалось прочитать {hooks.path}: {hooks.error}. Файл не изменён.
              </p>
            )}
          </>
        )}
        <ul className="welcome-keys">
          {KEYS.filter((k) => keybindings[k.id]).map((k) => (
            <li key={k.id}>
              <kbd>{keybindings[k.id]}</kbd> {k.text}
            </li>
          ))}
        </ul>
        <div className="dialog-buttons">
          {canInstall && (
            <button
              className="btn primary"
              autoFocus
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void actions.welcomeInstall()
              }}
            >
              Установить хуки
            </button>
          )}
          <button className="btn" autoFocus={!canInstall} onClick={() => actions.dismissWelcome()}>
            {installed ? 'Начать' : 'Позже'}
          </button>
        </div>
      </div>
    </div>
  )
}
