import { cwdKey, folderName, truncate } from '../shared/text'
import type { AlertKind, HookEvent, TabInfo, TabNote, TabRecord, TabStatus } from '../shared/types'
import { initialState, isUserInput, step, type MachineEvent, type MachineState } from './status-machine'

export type InputRoute = 'write' | 'drop' | 'restart' | 'new-conversation'

export interface Alert {
  tab: string
  kind: AlertKind
  title: string
  body: string
}

export interface SessionStoreDeps {
  now(): number
  // вкладка видна в активном окне
  isVisible(tab: string): boolean
  // notifications.messagePreview из конфига
  preview(): boolean
  // persist: изменились данные для workspace.json
  onChange(persist: boolean): void
  onAlert(alert: Alert): void
  log(msg: string): void
}

// kind и claudeSessionId живут в машине статусов
type Base = Omit<TabRecord, 'kind' | 'claudeSessionId'>

interface Entry {
  base: Base
  m: MachineState
  alive: boolean
  note: TabNote | null
}

const TITLE_MAX = 60
const BODY_MAX = 200
// eslint-disable-next-line no-control-regex
const SPACES = /[\s\x00-\x1f\x7f]+/g

function oneLine(s: string): string {
  return s.replace(SPACES, ' ').trim()
}

function alertKind(s: TabStatus): AlertKind | null {
  return s === 'waiting' || s === 'done' || s === 'crashed' ? s : null
}

function crashText(e: MachineEvent): string {
  if (e.type === 'claude-exit') return `Claude завершился с кодом ${e.code}`
  if (e.type === 'process-exit') return `Процесс завершён (код ${e.code})`
  return 'Не удалось запустить вкладку'
}

function record(t: Entry): TabRecord {
  return { ...t.base, kind: t.m.kind, claudeSessionId: t.m.claudeSessionId }
}

function info(t: Entry): TabInfo {
  return { ...record(t), status: t.m.status, statusSince: t.m.since, alive: t.alive, note: t.note }
}

export class SessionStore {
  private readonly tabs = new Map<string, Entry>()

  constructor(private readonly deps: SessionStoreDeps) {}

  add(rec: TabRecord): void {
    const { kind, claudeSessionId, ...base } = rec
    this.tabs.set(rec.id, { base, m: initialState(kind, claudeSessionId, this.deps.now()), alive: false, note: null })
    this.deps.onChange(true)
  }

  remove(tab: string): boolean {
    if (!this.tabs.delete(tab)) return false
    this.deps.onChange(true)
    return true
  }

  get(tab: string): TabInfo | null {
    const t = this.tabs.get(tab)
    return t ? info(t) : null
  }

  list(): TabInfo[] {
    return [...this.tabs.values()].map(info)
  }

  records(): TabRecord[] {
    return [...this.tabs.values()].map(record)
  }

  rename(tab: string, title: string): void {
    const t = this.tabs.get(tab)
    if (!t) return
    const clean = oneLine(title)
    t.base.customTitle = clean !== ''
    t.base.title = clean ? truncate(clean, TITLE_MAX) : folderName(t.base.cwd)
    this.deps.onChange(true)
  }

  setCwd(tab: string, cwd: string): void {
    const t = this.tabs.get(tab)
    if (!t) return
    t.base.cwd = cwd
    if (!t.base.customTitle) t.base.title = folderName(cwd)
    this.deps.onChange(true)
  }

  setShell(tab: string, shell: string): void {
    const t = this.tabs.get(tab)
    if (!t) return
    t.base.shell = shell
    this.deps.onChange(true)
  }

  setAlive(tab: string, alive: boolean): void {
    const t = this.tabs.get(tab)
    if (!t || t.alive === alive) return
    t.alive = alive
    this.deps.onChange(false)
  }

  setNote(tab: string, note: TabNote | null): void {
    const t = this.tabs.get(tab)
    if (!t) return
    t.note = note
    this.deps.onChange(false)
  }

  // События процесса от Controller
  apply(tab: string, e: MachineEvent): void {
    const t = this.tabs.get(tab)
    if (t) this.advance(t, e)
  }

  hook(ev: HookEvent): boolean {
    const t = this.tabs.get(ev.tab)
    if (!t) return false
    // по папке запуска claude потом работает --resume
    const fresh = ev.event === 'SessionStart' && !ev.isAgent && ev.ts >= t.m.lastTs
    if (fresh && ev.cwd && cwdKey(ev.cwd) !== cwdKey(t.base.cwd)) this.setCwd(ev.tab, ev.cwd)
    this.advance(t, { type: 'hook', hook: ev, visible: this.deps.isVisible(ev.tab) })
    return true
  }

  input(tab: string, data: string): InputRoute {
    const t = this.tabs.get(tab)
    if (!t) return 'drop'
    if (!t.alive) return data === '\r' ? 'restart' : 'drop'
    const user = isUserInput(data)
    if (t.m.status === 'crashed' && t.m.kind === 'claude') {
      // ответы терминала уходят в оболочку, но не превращают вкладку в консоль
      if (!user) return 'write'
      if (data === '\r') return 'new-conversation'
      this.advance(t, { type: 'use-console' })
      return 'write'
    }
    if (user) this.advance(t, { type: 'input' })
    return 'write'
  }

  shown(tab: string): void {
    const t = this.tabs.get(tab)
    if (t) this.advance(t, { type: 'shown' })
  }

  // Запасное правило: в working нет вывода silenceMs → idle
  checkSilence(lastOutputAt: (tab: string) => number | null, silenceMs: number): void {
    const now = this.deps.now()
    for (const t of this.tabs.values()) {
      if (t.m.status !== 'working') continue
      const last = lastOutputAt(t.base.id)
      if (last !== null && now - Math.max(last, t.m.since) >= silenceMs) this.advance(t, { type: 'silence' })
    }
  }

  private advance(t: Entry, e: MachineEvent): void {
    const prev = t.m
    const next = step(prev, e, this.deps.now())
    t.m = next
    const noteCleared = (e.type === 'spawned' || e.type === 'use-console') && t.note !== null
    if (noteCleared) t.note = null
    const persist = next.kind !== prev.kind || next.claudeSessionId !== prev.claudeSessionId
    const statusChanged = next.status !== prev.status
    if (statusChanged) {
      this.deps.log(`вкладка ${t.base.id}: ${prev.status} → ${next.status}`)
      const kind = alertKind(next.status)
      if (kind && !this.deps.isVisible(t.base.id)) this.deps.onAlert(this.alertFor(t, kind, e))
    }
    if (persist || statusChanged || noteCleared) this.deps.onChange(persist)
  }

  private alertFor(t: Entry, kind: AlertKind, e: MachineEvent): Alert {
    const h = e.type === 'hook' ? e.hook : null
    const preview = this.deps.preview()
    let label = kind === 'waiting' ? 'ждёт ответа' : kind === 'done' ? 'готово' : 'упала'
    if (kind === 'waiting' && h?.notificationType === 'permission_prompt') label = 'ждёт разрешения'
    let body: string
    if (kind === 'crashed') body = crashText(e)
    else if (kind === 'waiting') body = (preview && h?.message) || 'Claude ждёт вас'
    else body = (preview && h?.lastAssistantMessage) || 'Claude закончил работу'
    return { tab: t.base.id, kind, title: `${t.base.title} · ${label}`, body: truncate(oneLine(body), BODY_MAX) }
  }
}
