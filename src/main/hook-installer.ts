import { spawnSync } from 'node:child_process'
import { constants, copyFileSync, existsSync, readFileSync, realpathSync } from 'node:fs'
import type { HooksState } from '../shared/types'
import { stamp, stripBom, writeFileAtomic } from './persistence'

export const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Notification', 'Stop', 'SessionEnd'] as const
const MARKER = 't3000-hook'

export interface HookCommand {
  command: string
  args: string[]
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

export function resolveHookCommand(o: { nodeAvailable: boolean; scriptPath: string; exePath: string }): HookCommand {
  return o.nodeAvailable
    ? { command: 'node', args: [o.scriptPath.replace(/\\/g, '/')] }
    : { command: o.exePath, args: ['--t3000-hook'] }
}

export function isNodeOnPath(): boolean {
  const r = spawnSync('where', ['node'], { stdio: 'ignore', windowsHide: true, timeout: 3000 })
  return r.status === 0
}

export function isOurHook(h: unknown): boolean {
  if (!isObj(h)) return false
  if (typeof h.command === 'string' && h.command.includes(MARKER)) return true
  return Array.isArray(h.args) && h.args.some((a) => typeof a === 'string' && a.includes(MARKER))
}

function entry(cmd: HookCommand): Obj {
  return { type: 'command', command: cmd.command, args: [...cmd.args], async: true, timeout: 5 }
}

// Убирает наши хуки; группа, в которой были только они, исчезает
function withoutOurs(groups: unknown[]): unknown[] {
  const out: unknown[] = []
  for (const g of groups) {
    if (!isObj(g) || !Array.isArray(g.hooks)) {
      out.push(g)
      continue
    }
    const rest = g.hooks.filter((h) => !isOurHook(h))
    if (rest.length === g.hooks.length) out.push(g)
    else if (rest.length > 0) out.push({ ...g, hooks: rest })
  }
  return out
}

// Опустевшее событие удаляется, кроме тех, куда хук сразу поставят снова: так ключи не меняют порядок
function stripOurs(hooks: Obj, keep: readonly string[]): void {
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue
    const cleaned = withoutOurs(groups)
    if (cleaned.length === 0 && groups.length > 0 && !keep.includes(event)) delete hooks[event]
    else hooks[event] = cleaned
  }
}

export function applyInstall(settings: Obj, cmd: HookCommand): Obj {
  const next = structuredClone(settings)
  const hooks: Obj = isObj(next.hooks) ? next.hooks : {}
  stripOurs(hooks, HOOK_EVENTS)
  for (const event of HOOK_EVENTS) {
    const groups = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : []
    hooks[event] = [...groups, { hooks: [entry(cmd)] }]
  }
  next.hooks = hooks
  return next
}

export function applyUninstall(settings: Obj): Obj {
  const next = structuredClone(settings)
  if (!isObj(next.hooks)) return next
  const hadAny = Object.keys(next.hooks).length > 0
  stripOurs(next.hooks, [])
  if (hadAny && Object.keys(next.hooks).length === 0) delete next.hooks
  return next
}

function sameEntry(h: Obj, cmd: HookCommand): boolean {
  return (
    h.type === 'command' &&
    h.command === cmd.command &&
    Array.isArray(h.args) &&
    h.args.length === cmd.args.length &&
    h.args.every((a, i) => a === cmd.args[i]) &&
    h.async === true &&
    h.timeout === 5
  )
}

// Путь, который запускает хук: скрипт для node или сам exe в запасном варианте
function hookTarget(h: Obj): string | null {
  if (typeof h.command !== 'string' || !Array.isArray(h.args)) return null
  if (h.command === 'node') return typeof h.args[0] === 'string' ? h.args[0] : null
  return h.args.includes('--t3000-hook') ? h.command : null
}

// Хук этой копии или другой копии Terminal3000 (из исходников или установленной), чей файл на месте:
// порт и токен хук берёт из окружения вкладки, так что работает любой
function workingEntry(h: Obj, cmd: HookCommand, exists: (p: string) => boolean): boolean {
  if (sameEntry(h, cmd)) return true
  const target = hookTarget(h)
  return target !== null && sameEntry(h, { command: h.command as string, args: h.args as string[] }) && exists(target)
}

export function inspect(
  settings: Obj,
  cmd: HookCommand,
  exists: (p: string) => boolean = existsSync
): 'installed' | 'missing' | 'outdated' {
  const hooks = isObj(settings.hooks) ? settings.hooks : {}
  let ours = 0
  let good = 0
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue
    for (const g of groups) {
      if (!isObj(g) || !Array.isArray(g.hooks)) continue
      for (const h of g.hooks) {
        if (!isOurHook(h)) continue
        ours++
        const plainGroup = g.matcher === undefined || g.matcher === ''
        if (plainGroup && (HOOK_EVENTS as readonly string[]).includes(event) && workingEntry(h as Obj, cmd, exists)) good++
      }
    }
  }
  if (ours === 0) return 'missing'
  const everyEventOnce = HOOK_EVENTS.every((ev) => {
    const groups = hooks[ev]
    return Array.isArray(groups) && groups.filter((g) => isObj(g) && Array.isArray(g.hooks) && g.hooks.some(isOurHook)).length === 1
  })
  return ours === HOOK_EVENTS.length && good === ours && everyEventOnce ? 'installed' : 'outdated'
}

function structureProblem(raw: unknown): string | null {
  if (!isObj(raw)) return 'ожидается объект { … } в корне файла'
  if (raw.hooks === undefined) return null
  if (!isObj(raw.hooks)) return '"hooks" должен быть объектом'
  for (const [event, groups] of Object.entries(raw.hooks)) {
    if (!Array.isArray(groups)) return `"hooks.${event}" должен быть массивом`
  }
  return null
}

type ReadResult = { settings: Obj; text: string | null } | { error: string }

function resolveLink(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

export class HookInstaller {
  constructor(
    private readonly settingsPath: string,
    private readonly cmd: HookCommand,
    private readonly now: () => Date = () => new Date(),
    // settings.json может быть ссылкой (dotfiles): пишем в файл, на который она указывает
    private readonly resolve: (p: string) => string = resolveLink
  ) {}

  status(): HooksState {
    const r = this.read()
    if ('error' in r) return this.broken(r.error)
    return { state: inspect(r.settings, this.cmd) }
  }

  install(): HooksState {
    return this.change((s) => applyInstall(s, this.cmd))
  }

  uninstall(): HooksState {
    return this.change(applyUninstall)
  }

  private broken(error: string): HooksState {
    return { state: 'broken', path: this.settingsPath, error }
  }

  private read(): ReadResult {
    if (!existsSync(this.settingsPath)) return { settings: {}, text: null }
    let text: string
    try {
      text = readFileSync(this.resolve(this.settingsPath), 'utf8')
    } catch (e) {
      return { error: (e as Error).message }
    }
    const body = stripBom(text)
    if (body.trim() === '') return { settings: {}, text }
    let raw: unknown
    try {
      raw = JSON.parse(body)
    } catch (e) {
      return { error: `ошибка JSON: ${(e as Error).message}` }
    }
    const problem = structureProblem(raw)
    return problem ? { error: problem } : { settings: raw as Obj, text }
  }

  private change(fn: (s: Obj) => Obj): HooksState {
    const r = this.read()
    if ('error' in r) return this.broken(r.error)
    const next = fn(r.settings)
    const out = JSON.stringify(next, null, 2) + '\n'
    const state: HooksState = { state: inspect(next, this.cmd) }
    if (r.text === null && Object.keys(next).length === 0) return state
    if (r.text !== null && r.text === out) return state
    try {
      const target = this.resolve(this.settingsPath)
      if (r.text !== null) copyFileSync(target, this.backupPath(), constants.COPYFILE_EXCL)
      // rename поверх ссылки заменил бы её обычным файлом
      writeFileAtomic(target, out)
    } catch (e) {
      return this.broken(`не удалось записать файл: ${(e as Error).message}`)
    }
    return state
  }

  private backupPath(): string {
    const base = `${this.settingsPath}.bak-${stamp(this.now())}`
    let path = base
    for (let i = 1; existsSync(path); i++) path = `${base}-${i}`
    return path
  }
}
