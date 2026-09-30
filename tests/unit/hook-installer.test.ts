import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  HOOK_EVENTS,
  HookInstaller,
  applyInstall,
  applyUninstall,
  inspect,
  isOurHook,
  resolveHookCommand,
  type HookCommand
} from '../../src/main/hook-installer'

const NODE_CMD: HookCommand = { command: 'node', args: ['C:/Apps/Terminal3000/hooks/t3000-hook.js'] }
const MOVED_CMD: HookCommand = { command: 'node', args: ['D:/Terminal3000/hooks/t3000-hook.js'] }
const EXE_CMD: HookCommand = { command: 'C:\\Apps\\Terminal3000\\Terminal3000.exe', args: ['--t3000-hook'] }
const entry = (cmd: HookCommand) => ({ type: 'command', command: cmd.command, args: cmd.args, async: true, timeout: 5 })
const foreign = { type: 'command', command: 'powershell -c "[console]::beep()"' }

type Obj = Record<string, unknown>
const hooksOf = (s: Obj) => s.hooks as Record<string, Array<{ matcher?: string; hooks: unknown[] }>>

describe('чистые функции', () => {
  it('resolveHookCommand: node с прямыми слэшами или запасной exe', () => {
    expect(
      resolveHookCommand({ nodeAvailable: true, scriptPath: 'C:\\Apps\\T\\hooks\\t3000-hook.js', exePath: 'C:\\Apps\\T\\T.exe' })
    ).toEqual({ command: 'node', args: ['C:/Apps/T/hooks/t3000-hook.js'] })
    expect(resolveHookCommand({ nodeAvailable: false, scriptPath: 'x', exePath: 'C:\\Apps\\T\\T.exe' })).toEqual({
      command: 'C:\\Apps\\T\\T.exe',
      args: ['--t3000-hook']
    })
  })

  it('isOurHook узнаёт обе формы и не трогает чужие', () => {
    expect(isOurHook(entry(NODE_CMD))).toBe(true)
    expect(isOurHook(entry(EXE_CMD))).toBe(true)
    expect(isOurHook({ type: 'command', command: 'node C:/x/t3000-hook.js' })).toBe(true)
    expect(isOurHook(foreign)).toBe(false)
    expect(isOurHook('t3000-hook')).toBe(false)
  })

  it('установка в пустые настройки: 6 событий, без matcher', () => {
    const s = applyInstall({}, NODE_CMD)
    expect(Object.keys(hooksOf(s))).toEqual([...HOOK_EVENTS])
    for (const ev of HOOK_EVENTS) expect(hooksOf(s)[ev]).toEqual([{ hooks: [entry(NODE_CMD)] }])
  })

  it('чужие хуки, прочие ключи и их порядок сохраняются, вход не меняется', () => {
    const input: Obj = {
      model: 'opus',
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [foreign] }],
        Stop: [{ matcher: '', hooks: [foreign] }]
      },
      permissions: { allow: [] }
    }
    const before = structuredClone(input)
    const s = applyInstall(input, NODE_CMD)
    expect(input).toEqual(before)
    expect(Object.keys(s)).toEqual(['model', 'hooks', 'permissions'])
    expect(hooksOf(s).PreToolUse).toEqual([{ matcher: 'Bash', hooks: [foreign] }])
    expect(hooksOf(s).Stop).toEqual([{ matcher: '', hooks: [foreign] }, { hooks: [entry(NODE_CMD)] }])
  })

  it('повторная установка идемпотентна, смена пути обновляет, а не дублирует', () => {
    const once = applyInstall({}, NODE_CMD)
    expect(applyInstall(once, NODE_CMD)).toEqual(once)
    const moved = applyInstall(once, MOVED_CMD)
    for (const ev of HOOK_EVENTS) expect(hooksOf(moved)[ev]).toEqual([{ hooks: [entry(MOVED_CMD)] }])
  })

  it('удаление убирает только наши записи, смешанная группа остаётся', () => {
    const s = applyInstall({ hooks: { Stop: [{ hooks: [foreign, entry(MOVED_CMD)] }] } }, NODE_CMD)
    const u = applyUninstall(s)
    expect(u).toEqual({ hooks: { Stop: [{ hooks: [foreign] }] } })
    expect(applyUninstall(applyInstall({}, NODE_CMD))).toEqual({})
  })

  it('удаление из старых событий, на которые хук больше не ставится', () => {
    const s = applyInstall({ hooks: { SubagentStop: [{ hooks: [entry(NODE_CMD)] }] } }, NODE_CMD)
    expect(hooksOf(s).SubagentStop).toBeUndefined()
  })

  it('inspect: missing, installed, outdated', () => {
    expect(inspect({}, NODE_CMD)).toBe('missing')
    expect(inspect({ hooks: { Stop: [{ hooks: [foreign] }] } }, NODE_CMD)).toBe('missing')
    const s = applyInstall({}, NODE_CMD)
    expect(inspect(s, NODE_CMD)).toBe('installed')
    expect(inspect(s, MOVED_CMD)).toBe('outdated')
    expect(inspect(s, EXE_CMD)).toBe('outdated')
    const partial = structuredClone(s)
    delete hooksOf(partial).Stop
    expect(inspect(partial, NODE_CMD)).toBe('outdated')
    const withMatcher = structuredClone(s)
    hooksOf(withMatcher).Notification[0].matcher = 'permission_prompt'
    expect(inspect(withMatcher, NODE_CMD)).toBe('outdated')
  })
})

describe('HookInstaller', () => {
  let dir: string
  let file: string
  const now = () => new Date(2026, 8, 28, 9, 0, 0)
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 't3000-hooks-'))
    file = join(dir, 'settings.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const backups = () => readdirSync(dir).filter((f) => f.includes('.bak-')).sort()

  it('нет файла: missing → установка создаёт файл без копии', () => {
    const inst = new HookInstaller(file, NODE_CMD, now)
    expect(inst.status()).toEqual({ state: 'missing' })
    expect(inst.install()).toEqual({ state: 'installed' })
    expect(inspect(JSON.parse(readFileSync(file, 'utf8')), NODE_CMD)).toBe('installed')
    expect(backups()).toEqual([])
  })

  it('BOM и пустой файл считаются пустыми настройками', () => {
    writeFileSync(file, '\ufeff', 'utf8')
    const inst = new HookInstaller(file, NODE_CMD, now)
    expect(inst.status()).toEqual({ state: 'missing' })
    expect(inst.install()).toEqual({ state: 'installed' })
    const text = readFileSync(file, 'utf8')
    expect(text.charCodeAt(0)).not.toBe(0xfeff)
    expect(text.endsWith('\n')).toBe(true)
  })

  it('BOM перед настоящим JSON: чужие настройки сохраняются', () => {
    writeFileSync(file, '\ufeff{"model":"opus"}', 'utf8')
    new HookInstaller(file, NODE_CMD, now).install()
    expect(JSON.parse(readFileSync(file, 'utf8')).model).toBe('opus')
  })

  it('копия перед каждым изменением, без перезаписи прежней копии', () => {
    writeFileSync(file, '{"model":"opus"}')
    const inst = new HookInstaller(file, NODE_CMD, now)
    inst.install()
    inst.uninstall()
    expect(backups()).toEqual(['settings.json.bak-20260928-090000', 'settings.json.bak-20260928-090000-1'])
    expect(readFileSync(join(dir, 'settings.json.bak-20260928-090000'), 'utf8')).toBe('{"model":"opus"}')
  })

  it('без изменений файл не переписывается и копия не создаётся', () => {
    const inst = new HookInstaller(file, NODE_CMD, now)
    inst.install()
    const text = readFileSync(file, 'utf8')
    expect(inst.install()).toEqual({ state: 'installed' })
    expect(readFileSync(file, 'utf8')).toBe(text)
    expect(backups()).toEqual([])
  })

  it('удаление без файла не создаёт файл', () => {
    expect(new HookInstaller(file, NODE_CMD, now).uninstall()).toEqual({ state: 'missing' })
    expect(existsSync(file)).toBe(false)
  })

  it('битый JSON: broken с путём и ошибкой, файл не трогается', () => {
    writeFileSync(file, '{"hooks": {')
    const inst = new HookInstaller(file, NODE_CMD, now)
    const st = inst.status()
    expect(st).toMatchObject({ state: 'broken', path: file })
    expect(st.state === 'broken' && st.error).toMatch(/JSON/)
    expect(inst.install()).toEqual(st)
    expect(readFileSync(file, 'utf8')).toBe('{"hooks": {')
    expect(backups()).toEqual([])
  })

  it('неожиданная структура — тоже broken', () => {
    for (const text of ['[1]', '"x"', '{"hooks": []}', '{"hooks": {"Stop": {}}}']) {
      writeFileSync(file, text)
      const inst = new HookInstaller(file, NODE_CMD, now)
      expect(inst.install().state, text).toBe('broken')
      expect(readFileSync(file, 'utf8')).toBe(text)
    }
  })

  it('запасной вариант без Node проходит полный цикл', () => {
    const inst = new HookInstaller(file, EXE_CMD, now)
    expect(inst.install()).toEqual({ state: 'installed' })
    expect(new HookInstaller(file, NODE_CMD, now).status()).toEqual({ state: 'outdated' })
    expect(inst.uninstall()).toEqual({ state: 'missing' })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({})
  })
})
