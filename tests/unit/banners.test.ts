import { describe, expect, it } from 'vitest'
import { buildBanners, type BannerInput } from '../../src/main/banners'

const OK: BannerInput = {
  hooks: { state: 'installed' },
  firstRun: false,
  hooksJustInstalled: false,
  hookServerFailed: false,
  configErrors: [],
  brokenConfig: null,
  brokenWorkspace: null
}

const DIR = 'C:\\Users\\u\\AppData\\Roaming\\Terminal3000'

describe('buildBanners', () => {
  it('всё в порядке — баннеров нет', () => {
    expect(buildBanners(OK)).toEqual([])
  })

  it('хуки не установлены или путь устарел', () => {
    expect(buildBanners({ ...OK, hooks: { state: 'missing' } })).toEqual([
      {
        id: 'hooks',
        level: 'warn',
        text: 'Статусы Claude недоступны: хуки не установлены',
        action: { label: 'Установить хуки', command: 'install-hooks' }
      }
    ])
    expect(buildBanners({ ...OK, hooks: { state: 'outdated' } })).toEqual([
      {
        id: 'hooks',
        level: 'warn',
        text: 'Статусы Claude недоступны: путь к хуку устарел',
        action: { label: 'Обновить хуки', command: 'install-hooks' }
      }
    ])
  })

  it('при первом запуске хуки предлагает приветствие, а не баннер', () => {
    expect(buildBanners({ ...OK, firstRun: true, hooks: { state: 'missing' } })).toEqual([])
  })

  it('битый settings.json: путь и ошибка, без кнопки', () => {
    const hooks = { state: 'broken' as const, path: 'C:\\Users\\u\\.claude\\settings.json', error: 'Unexpected token }' }
    expect(buildBanners({ ...OK, hooks })).toEqual([
      {
        id: 'hooks',
        level: 'error',
        text: 'Не удалось прочитать C:\\Users\\u\\.claude\\settings.json: Unexpected token }. Файл не изменён',
        action: null
      }
    ])
  })

  it('после установки напоминает про перезапуск сессий Claude', () => {
    expect(buildBanners({ ...OK, hooksJustInstalled: true })).toEqual([
      {
        id: 'hooks-installed',
        level: 'info',
        text: 'Хуки установлены. Сессии Claude, запущенные раньше, начнут присылать статусы после перезапуска',
        action: null
      }
    ])
  })

  it('сервер статусов не запустился — баннер хуков не нужен', () => {
    const r = buildBanners({ ...OK, hookServerFailed: true, hooks: { state: 'missing' } })
    expect(r).toEqual([
      {
        id: 'hook-server',
        level: 'error',
        text: 'Сервер статусов не запустился, статусы Claude недоступны. Перезапустите приложение',
        action: null
      }
    ])
  })

  it('ошибки конфига и повреждённые файлы', () => {
    const r = buildBanners({
      ...OK,
      configErrors: ['font.size: ожидается число, взято значение по умолчанию', 'scrollback: ожидается число'],
      brokenConfig: `${DIR}\\config.json.broken-20260928-120000`,
      brokenWorkspace: `${DIR}\\workspace.json.broken-20260928-120000`
    })
    const open = { label: 'Открыть config.json', command: 'open-config' }
    expect(r).toEqual([
      {
        id: 'broken-config',
        level: 'warn',
        text: 'config.json был повреждён и сохранён как config.json.broken-20260928-120000. Взяты настройки по умолчанию',
        action: open
      },
      {
        id: 'config-errors',
        level: 'warn',
        text: 'Ошибки в настройках: font.size: ожидается число, взято значение по умолчанию (и ещё 1)',
        action: open
      },
      {
        id: 'broken-workspace',
        level: 'warn',
        text: 'workspace.json был повреждён и сохранён как workspace.json.broken-20260928-120000. Вкладки не восстановлены',
        action: null
      }
    ])
    expect(buildBanners({ ...OK, configErrors: ['theme: неизвестный параметр, пропущен'] })[0].text).toBe(
      'Ошибки в настройках: theme: неизвестный параметр, пропущен'
    )
  })
})
