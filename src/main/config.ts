import { existsSync, unwatchFile, watchFile, type Stats } from 'node:fs'
import { ACTION_IDS, DEFAULT_KEYBINDINGS, type ActionId, type AppConfig, type ShellSpec } from '../shared/types'
import { quarantine, readJson, writeFileAtomic } from './persistence'

export const DEFAULT_CONFIG: AppConfig = {
  defaultShell: 'powershell',
  shells: {
    powershell: { file: 'powershell.exe', args: ['-NoLogo'] },
    cmd: { file: 'cmd.exe', args: [] },
    gitbash: { file: 'C:/Program Files/Git/bin/bash.exe', args: ['--login', '-i'] }
  },
  claudeCommand: 'claude',
  projectRoots: [],
  restore: 'lazy',
  font: { family: 'Cascadia Mono, Consolas, monospace', size: 14 },
  scrollback: 10000,
  webgl: true,
  status: { silenceMs: 4000 },
  notifications: { toast: true, flashFrame: true, badge: true, messagePreview: true, doNotDisturb: false },
  sounds: { volume: 0.8, waiting: 'builtin:faceit', done: 'builtin:faceit', crashed: 'builtin:low' },
  keybindings: { ...DEFAULT_KEYBINDINGS }
}

type Check = (v: unknown) => boolean
type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const str: Check = (v) => typeof v === 'string' && v.length > 0
const bool: Check = (v) => typeof v === 'boolean'
const strArr: Check = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string')
const num =
  (min: number, max: number): Check =>
  (v) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const oneOf =
  (...values: string[]): Check =>
  (v) =>
    typeof v === 'string' && values.includes(v)

class Reader {
  readonly errors: string[] = []

  section(obj: Obj, key: string, path: string): Obj {
    const v = obj[key]
    if (v === undefined) return {}
    if (isObj(v)) return v
    this.errors.push(`${path}: ожидается объект { … }, взяты значения по умолчанию`)
    return {}
  }

  field<T>(obj: Obj, key: string, path: string, fallback: T, check: Check, expected: string): T {
    const v = obj[key]
    if (v === undefined) return fallback
    if (check(v)) return structuredClone(v) as T
    this.errors.push(`${path}: ожидается ${expected}, взято значение по умолчанию`)
    return fallback
  }
}

export function validateConfig(raw: unknown): { config: AppConfig; errors: string[] } {
  const d = structuredClone(DEFAULT_CONFIG)
  if (!isObj(raw)) return { config: d, errors: ['config.json: ожидается объект { … }, взяты настройки по умолчанию'] }
  const r = new Reader()

  for (const key of Object.keys(raw)) {
    if (!(key in d) && !key.startsWith('$')) r.errors.push(`${key}: неизвестный параметр, пропущен`)
  }

  const shells: Record<string, ShellSpec> = d.shells
  for (const [name, spec] of Object.entries(r.section(raw, 'shells', 'shells'))) {
    if (isObj(spec) && str(spec.file) && (spec.args === undefined || strArr(spec.args))) {
      shells[name] = { file: spec.file as string, args: spec.args ? [...(spec.args as string[])] : [] }
    } else {
      r.errors.push(`shells.${name}: ожидается { "file": "…", "args": [ … ] }, оболочка пропущена`)
    }
  }
  let defaultShell = r.field(raw, 'defaultShell', 'defaultShell', d.defaultShell, str, 'имя оболочки')
  if (!shells[defaultShell]) {
    r.errors.push(`defaultShell: оболочки «${defaultShell}» нет в shells, взята powershell`)
    defaultShell = d.defaultShell
  }

  const font = r.section(raw, 'font', 'font')
  const status = r.section(raw, 'status', 'status')
  const n = r.section(raw, 'notifications', 'notifications')
  const sounds = r.section(raw, 'sounds', 'sounds')
  const flag = (key: keyof AppConfig['notifications']) =>
    r.field(n, key, `notifications.${key}`, d.notifications[key], bool, 'true или false')

  const keybindings = d.keybindings
  for (const [key, value] of Object.entries(r.section(raw, 'keybindings', 'keybindings'))) {
    if (!(ACTION_IDS as readonly string[]).includes(key)) {
      r.errors.push(`keybindings.${key}: неизвестное действие, пропущено`)
    } else if (typeof value !== 'string') {
      r.errors.push(`keybindings.${key}: ожидается строка вида "Ctrl+Shift+P", взято значение по умолчанию`)
    } else {
      keybindings[key as ActionId] = value
    }
  }

  const config: AppConfig = {
    defaultShell,
    shells,
    claudeCommand: r.field(raw, 'claudeCommand', 'claudeCommand', d.claudeCommand, str, 'непустая строка'),
    projectRoots: r.field(raw, 'projectRoots', 'projectRoots', d.projectRoots, strArr, 'список путей'),
    restore: r.field(raw, 'restore', 'restore', d.restore, oneOf('lazy', 'eager'), '"lazy" или "eager"'),
    font: {
      family: r.field(font, 'family', 'font.family', d.font.family, str, 'непустая строка'),
      size: r.field(font, 'size', 'font.size', d.font.size, num(6, 48), 'число от 6 до 48')
    },
    scrollback: r.field(raw, 'scrollback', 'scrollback', d.scrollback, num(100, 200000), 'число от 100 до 200000'),
    webgl: r.field(raw, 'webgl', 'webgl', d.webgl, bool, 'true или false'),
    status: {
      silenceMs: r.field(status, 'silenceMs', 'status.silenceMs', d.status.silenceMs, num(500, 600000), 'число от 500 до 600000')
    },
    notifications: {
      toast: flag('toast'),
      flashFrame: flag('flashFrame'),
      badge: flag('badge'),
      messagePreview: flag('messagePreview'),
      doNotDisturb: flag('doNotDisturb')
    },
    sounds: {
      volume: r.field(sounds, 'volume', 'sounds.volume', d.sounds.volume, num(0, 1), 'число от 0 до 1'),
      waiting: r.field(sounds, 'waiting', 'sounds.waiting', d.sounds.waiting, str, 'builtin:… или путь к файлу'),
      done: r.field(sounds, 'done', 'sounds.done', d.sounds.done, str, 'builtin:… или путь к файлу'),
      crashed: r.field(sounds, 'crashed', 'sounds.crashed', d.sounds.crashed, str, 'builtin:… или путь к файлу')
    },
    keybindings
  }
  return { config, errors: r.errors }
}

function writeDefaults(file: string): void {
  writeFileAtomic(file, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n')
}

// Для запуска приложения
export function loadConfig(
  file: string,
  now: Date = new Date()
): { config: AppConfig; errors: string[]; broken: string | null } {
  if (!existsSync(file)) {
    const errors: string[] = []
    try {
      writeDefaults(file)
    } catch (e) {
      errors.push(`config.json: не удалось создать файл (${(e as Error).message})`)
    }
    return { config: structuredClone(DEFAULT_CONFIG), errors, broken: null }
  }
  let raw: unknown
  try {
    raw = readJson(file)
  } catch (e) {
    const broken = quarantine(file, now)
    writeDefaults(file)
    return {
      config: structuredClone(DEFAULT_CONFIG),
      errors: [`config.json был повреждён (${(e as Error).message}), сохранён как ${broken}, созданы настройки по умолчанию`],
      broken
    }
  }
  return { ...validateConfig(raw), broken: null }
}

// Для горячей перезагрузки: файл посреди правки не трогаем
export function reloadConfig(file: string, previous: AppConfig): { config: AppConfig; errors: string[] } {
  let raw: unknown
  try {
    raw = readJson(file)
  } catch (e) {
    const reason = (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'файл не найден' : `ошибка JSON: ${(e as Error).message}`
    return { config: previous, errors: [`config.json: ${reason}. Действуют прежние настройки`] }
  }
  return validateConfig(raw)
}

export function watchConfig(
  file: string,
  getCurrent: () => AppConfig,
  onChange: (r: { config: AppConfig; errors: string[] }) => void,
  intervalMs = 1000
): () => void {
  const listener = (curr: Stats, prev: Stats) => {
    if (curr.mtimeMs === prev.mtimeMs && curr.size === prev.size) return
    onChange(reloadConfig(file, getCurrent()))
  }
  watchFile(file, { interval: intervalMs }, listener)
  return () => unwatchFile(file, listener)
}
