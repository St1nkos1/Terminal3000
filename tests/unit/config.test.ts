import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_KEYBINDINGS } from '../../src/shared/types'
import { DEFAULT_CONFIG, loadConfig, reloadConfig, validateConfig, watchConfig } from '../../src/main/config'

let dir: string
let stop: (() => void) | null = null
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 't3000-config-'))
})
afterEach(() => {
  stop?.()
  stop = null
  rmSync(dir, { recursive: true, force: true })
})

describe('DEFAULT_CONFIG', () => {
  it('совпадает со спекой', () => {
    expect(DEFAULT_CONFIG.defaultShell).toBe('powershell')
    expect(DEFAULT_CONFIG.shells.powershell).toEqual({ file: 'powershell.exe', args: ['-NoLogo'] })
    expect(DEFAULT_CONFIG.shells.gitbash.file).toBe('C:/Program Files/Git/bin/bash.exe')
    expect(DEFAULT_CONFIG.restore).toBe('lazy')
    expect(DEFAULT_CONFIG.webgl).toBe(true)
    expect(DEFAULT_CONFIG.consoleUnderClaude).toBe(true)
    expect(DEFAULT_CONFIG.status.silenceMs).toBe(4000)
    expect(DEFAULT_CONFIG.sounds).toEqual({
      volume: 0.8,
      waiting: 'builtin:faceit',
      done: 'builtin:faceit',
      crashed: 'builtin:low'
    })
    expect(DEFAULT_CONFIG.keybindings).toEqual(DEFAULT_KEYBINDINGS)
  })
})

describe('validateConfig', () => {
  it('пустой объект → умолчания без ошибок', () => {
    expect(validateConfig({})).toEqual({ config: DEFAULT_CONFIG, errors: [] })
  })

  it('частичный конфиг дополняется умолчаниями', () => {
    const { config, errors } = validateConfig({ font: { size: 16 }, notifications: { toast: false } })
    expect(errors).toEqual([])
    expect(config.font).toEqual({ family: DEFAULT_CONFIG.font.family, size: 16 })
    expect(config.notifications).toEqual({ ...DEFAULT_CONFIG.notifications, toast: false })
  })

  it('неверные поля → умолчание и по ошибке на поле', () => {
    const { config, errors } = validateConfig({ restore: 'sometimes', font: { size: 'big' }, sounds: { volume: 3 } })
    expect(config.restore).toBe('lazy')
    expect(config.font.size).toBe(14)
    expect(config.sounds.volume).toBe(0.8)
    expect(errors).toHaveLength(3)
    expect(errors[0]).toMatch(/^restore: /)
  })

  it('consoleUnderClaude: false выключает консоль под Claude, не булево — ошибка', () => {
    expect(validateConfig({ consoleUnderClaude: false })).toEqual({
      config: { ...DEFAULT_CONFIG, consoleUnderClaude: false },
      errors: []
    })
    const { config, errors } = validateConfig({ consoleUnderClaude: 'yes' })
    expect(config.consoleUnderClaude).toBe(true)
    expect(errors).toEqual([expect.stringMatching(/^consoleUnderClaude: /)])
  })

  it('свои оболочки добавляются к встроенным', () => {
    const { config, errors } = validateConfig({
      shells: { pwsh: { file: 'pwsh.exe', args: ['-NoLogo'] }, bad: { file: 5 } },
      defaultShell: 'pwsh'
    })
    expect(Object.keys(config.shells).sort()).toEqual(['cmd', 'gitbash', 'powershell', 'pwsh'])
    expect(config.defaultShell).toBe('pwsh')
    expect(errors).toEqual([expect.stringMatching(/^shells\.bad: /)])
  })

  it('defaultShell без такой оболочки → powershell', () => {
    const { config, errors } = validateConfig({ defaultShell: 'fish' })
    expect(config.defaultShell).toBe('powershell')
    expect(errors).toEqual([expect.stringMatching(/^defaultShell: /)])
  })

  it('keybindings: частичные, отключение пустой строкой, неизвестное действие', () => {
    const { config, errors } = validateConfig({ keybindings: { palette: 'Ctrl+K', newTab: '', fly: 'Ctrl+F', rename: 1 } })
    expect(config.keybindings.palette).toBe('Ctrl+K')
    expect(config.keybindings.newTab).toBe('')
    expect(config.keybindings.rename).toBe('F2')
    expect(config.keybindings.closeTab).toBe('Ctrl+Shift+W')
    expect(errors).toHaveLength(2)
  })

  it('неизвестные ключи — предупреждение, $schema — молча', () => {
    const { errors } = validateConfig({ $schema: 'x', fontSize: 12 })
    expect(errors).toEqual([expect.stringMatching(/^fontSize: /)])
  })

  it('не объект → умолчания и ошибка', () => {
    const { config, errors } = validateConfig([1, 2])
    expect(config).toEqual(DEFAULT_CONFIG)
    expect(errors).toHaveLength(1)
  })

  it('результат не связан с DEFAULT_CONFIG', () => {
    const { config } = validateConfig({})
    config.shells.powershell.args.push('-X')
    expect(DEFAULT_CONFIG.shells.powershell.args).toEqual(['-NoLogo'])
  })
})

describe('loadConfig', () => {
  it('нет файла → создаёт его со значениями по умолчанию', () => {
    const f = join(dir, 'config.json')
    expect(loadConfig(f)).toEqual({ config: DEFAULT_CONFIG, errors: [], broken: null })
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual(DEFAULT_CONFIG)
  })

  it('BOM от Блокнота — не ошибка', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, '\ufeff{"scrollback": 5000}', 'utf8')
    const r = loadConfig(f)
    expect(r.broken).toBeNull()
    expect(r.errors).toEqual([])
    expect(r.config.scrollback).toBe(5000)
    expect(readdirSync(dir)).toEqual(['config.json'])
  })

  it('битый JSON при запуске → карантин и новый файл', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, '{"font": ')
    const r = loadConfig(f, new Date(2026, 8, 28, 9, 0, 0))
    expect(r.config).toEqual(DEFAULT_CONFIG)
    expect(r.broken).toBe(`${f}.broken-20260928-090000`)
    expect(readFileSync(r.broken!, 'utf8')).toBe('{"font": ')
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual(DEFAULT_CONFIG)
    expect(r.errors).toHaveLength(1)
  })
})

describe('reloadConfig и watchConfig', () => {
  it('reloadConfig: битый JSON или нет файла → прежний конфиг, файл не трогается', () => {
    const f = join(dir, 'config.json')
    const previous = { ...DEFAULT_CONFIG, scrollback: 777 }
    writeFileSync(f, '{"font": ')
    const r = reloadConfig(f, previous)
    expect(r.config).toBe(previous)
    expect(r.errors).toHaveLength(1)
    expect(readdirSync(dir)).toEqual(['config.json'])
    rmSync(f)
    expect(reloadConfig(f, previous).config).toBe(previous)
  })

  it('watch: битый JSON оставляет прежний конфиг, исправленный — применяется', async () => {
    const f = join(dir, 'config.json')
    let current = loadConfig(f).config
    const onChange = vi.fn((r: { config: typeof current; errors: string[] }) => {
      current = r.config
    })
    stop = watchConfig(f, () => current, onChange, 50)

    // Опрос может поймать и промежуточное состояние файла, поэтому смотрим на последний вызов
    writeFileSync(f, '{"scrollback": ')
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 3000 })
    const last = onChange.mock.lastCall![0]
    expect(last.config).toEqual(DEFAULT_CONFIG)
    expect(last.errors[0]).toMatch(/ошибка JSON/)
    expect(readdirSync(dir)).toEqual(['config.json'])
    expect(existsSync(f)).toBe(true)

    writeFileSync(f, '{"scrollback": 500}')
    await vi.waitFor(() => expect(current.scrollback).toBe(500), { timeout: 3000 })
    expect(onChange.mock.lastCall![0].errors).toEqual([])
  })
})

describe('loadConfig: сбои файловой системы', () => {
  const now = new Date(2026, 8, 30, 12, 0, 0)

  it('файл не читается (не ошибка JSON) — без карантина, настройки по умолчанию', () => {
    const file = join(dir, 'config.json')
    // чтение каталога даёт EISDIR — так же ведёт себя файл, занятый антивирусом или без прав
    mkdirSync(file)
    const r = loadConfig(file, now)
    expect(r.config).toEqual(DEFAULT_CONFIG)
    expect(r.broken).toBeNull()
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toContain('не удалось прочитать')
    expect(statSync(file).isDirectory()).toBe(true)
    expect(readdirSync(dir)).toEqual(['config.json'])
  })

  it('битый JSON, но переименовать не вышло — запуск не падает, файл не тронут', () => {
    const file = join(dir, 'config.json')
    writeFileSync(file, '{ oops')
    // каталог с именем карантина: rename в него не пройдёт
    mkdirSync(`${file}.broken-20260930-120000`)
    const r = loadConfig(file, now)
    expect(r.config).toEqual(DEFAULT_CONFIG)
    expect(r.broken).toBeNull()
    expect(r.errors[0]).toContain('повреждён')
    expect(readFileSync(file, 'utf8')).toBe('{ oops')
  })
})
