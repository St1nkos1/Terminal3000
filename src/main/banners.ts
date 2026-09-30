import { folderName } from '../shared/text'
import type { Banner, HooksState } from '../shared/types'

export interface BannerInput {
  hooks: HooksState
  firstRun: boolean
  // хуки только что установили из приложения
  hooksJustInstalled: boolean
  hookServerFailed: boolean
  configErrors: string[]
  // путь к битому файлу после карантина
  brokenConfig: string | null
  brokenWorkspace: string | null
}

const OPEN_CONFIG: NonNullable<Banner['action']> = { label: 'Открыть config.json', command: 'open-config' }

function hooksBanner(i: BannerInput): Banner | null {
  const h = i.hooks
  if (h.state === 'broken') {
    return { id: 'hooks', level: 'error', text: `Не удалось прочитать ${h.path}: ${h.error}. Файл не изменён`, action: null }
  }
  if (h.state === 'outdated') {
    return {
      id: 'hooks',
      level: 'warn',
      text: 'Статусы Claude недоступны: путь к хуку устарел',
      action: { label: 'Обновить хуки', command: 'install-hooks' }
    }
  }
  // при первом запуске хуки предлагает приветствие
  if (h.state === 'missing' && !i.firstRun) {
    return {
      id: 'hooks',
      level: 'warn',
      text: 'Статусы Claude недоступны: хуки не установлены',
      action: { label: 'Установить хуки', command: 'install-hooks' }
    }
  }
  if (h.state === 'installed' && i.hooksJustInstalled) {
    return {
      id: 'hooks-installed',
      level: 'info',
      text: 'Хуки установлены. Сессии Claude, запущенные раньше, начнут присылать статусы после перезапуска',
      action: null
    }
  }
  return null
}

export function buildBanners(i: BannerInput): Banner[] {
  const out: Banner[] = []
  if (i.hookServerFailed) {
    // без сервера хуки ничего не дают
    out.push({
      id: 'hook-server',
      level: 'error',
      text: 'Сервер статусов не запустился, статусы Claude недоступны. Перезапустите приложение',
      action: null
    })
  } else {
    const hooks = hooksBanner(i)
    if (hooks) out.push(hooks)
  }
  if (i.brokenConfig) {
    out.push({
      id: 'broken-config',
      level: 'warn',
      text: `config.json был повреждён и сохранён как ${folderName(i.brokenConfig)}. Взяты настройки по умолчанию`,
      action: OPEN_CONFIG
    })
  }
  if (i.configErrors.length > 0) {
    const more = i.configErrors.length > 1 ? ` (и ещё ${i.configErrors.length - 1})` : ''
    out.push({
      id: 'config-errors',
      level: 'warn',
      text: `Ошибки в настройках: ${i.configErrors[0]}${more}`,
      action: OPEN_CONFIG
    })
  }
  if (i.brokenWorkspace) {
    out.push({
      id: 'broken-workspace',
      level: 'warn',
      text: `workspace.json был повреждён и сохранён как ${folderName(i.brokenWorkspace)}. Вкладки не восстановлены`,
      action: null
    })
  }
  return out
}
