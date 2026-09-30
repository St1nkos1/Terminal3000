import { layoutTabs, normalizeLayout, pane, removeTab } from '../shared/layout'
import { folderName } from '../shared/text'
import {
  EMPTY_SIDEBAR,
  type AppConfig,
  type ClaudeStart,
  type HookEvent,
  type LayoutNode,
  type NewTabRequest,
  type NoteAction,
  type SidebarState,
  type TabInfo,
  type ViewState,
  type TermSize,
  type Workspace
} from '../shared/types'
import { buildLaunch, resolveExecutable, type LaunchContext } from './launch'
import type { Logger } from './log'
// только типы: unit-тесты не должны загружать node-pty
import type { PtyCallbacks, PtyManager } from './pty-manager'
import { SessionStore, type Alert } from './session-store'

export type PtyControl = Pick<
  PtyManager,
  'spawn' | 'write' | 'resize' | 'kill' | 'forget' | 'isAlive' | 'snapshot' | 'lastOutputAt' | 'killAll'
>

export interface ControllerDeps {
  getConfig(): AppConfig
  launch: LaunchContext
  makePty(cb: PtyCallbacks): PtyControl
  isDir(p: string): boolean
  fileExists(p: string): boolean
  now(): number
  newId(): string
  log: Logger
  // изменилось то, что видит renderer
  onState(): void
  // изменились данные workspace.json
  onPersist(): void
  onData(tab: string, seq: number, data: string): void
  onAlert(alert: Alert): void
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export class Controller {
  private readonly store: SessionStore
  private readonly pty: PtyControl
  private layout: LayoutNode | null = null
  private activeTab: string | null = null
  private sidebar: SidebarState = EMPTY_SIDEBAR
  private visible = new Set<string>()
  private focused = false
  // последний размер терминала от renderer и вкладки, которым он уже сообщил свой
  private termSize: TermSize | null = null
  private readonly sized = new Set<string>()

  constructor(private readonly deps: ControllerDeps) {
    this.store = new SessionStore({
      now: () => deps.now(),
      isVisible: (tab) => this.focused && this.visible.has(tab),
      preview: () => deps.getConfig().notifications.messagePreview,
      onChange: (persist) => {
        deps.onState()
        if (persist) deps.onPersist()
      },
      onAlert: (alert) => deps.onAlert(alert),
      log: (msg) => deps.log.info(msg)
    })
    this.pty = deps.makePty({
      onData: (tab, seq, data) => deps.onData(tab, seq, data),
      onExit: (tab, code) => this.onExit(tab, code),
      onClaudeExit: (tab, code) => this.onClaudeExit(tab, code)
    })
  }

  // Вкладки из workspace.json, один раз при запуске
  restore(ws: Workspace | null): void {
    if (ws) {
      for (const rec of ws.tabs) this.store.add(rec)
      this.layout = ws.layout
      this.activeTab = ws.activeTab
      this.sidebar = ws.sidebar
      this.termSize = ws.termSize ?? null
    }
    const eager = this.deps.getConfig().restore === 'eager'
    for (const t of this.store.list()) {
      if (eager || t.id === this.activeTab) this.start(t.id)
    }
  }

  createTab(req: NewTabRequest): string | null {
    if (!this.deps.isDir(req.cwd)) return null
    const config = this.deps.getConfig()
    const claude = req.kind === 'claude'
    // после выхода claude во вкладке остаётся консоль PowerShell
    const shell = claude ? 'powershell' : req.shell && config.shells[req.shell] ? req.shell : config.defaultShell
    const id = this.freshId()
    this.store.add({
      id,
      title: folderName(req.cwd),
      cwd: req.cwd,
      kind: req.kind,
      shell,
      claudeSessionId: claude && req.claude === 'resume' ? (req.sessionId ?? null) : null,
      customTitle: false
    })
    if (req.title) this.store.rename(id, req.title)
    if (!this.layout) {
      this.layout = pane(id)
      this.activeTab = id
      this.deps.onPersist()
    }
    this.start(id, claude ? (req.claude ?? 'new') : 'new')
    return id
  }

  closeTab(tab: string): void {
    if (!this.store.get(tab)) return
    this.pty.forget(tab)
    this.sized.delete(tab)
    this.store.remove(tab)
    this.layout = removeTab(this.layout, tab)
    this.fixView()
  }

  renameTab(tab: string, title: string): void {
    this.store.rename(tab, title)
  }

  // «Выбрать папку» из подсказки упавшей вкладки
  setTabCwd(tab: string, cwd: string): void {
    if (!this.store.get(tab) || !this.deps.isDir(cwd)) return
    this.store.setCwd(tab, cwd)
    if (!this.pty.isAlive(tab)) this.start(tab)
  }

  // Перезапуск вкладки, при необходимости с другой оболочкой
  startTab(tab: string, shell?: string): void {
    if (!this.store.get(tab)) return
    if (shell !== undefined) {
      if (!this.deps.getConfig().shells[shell]) return
      this.store.setShell(tab, shell)
    }
    this.start(tab)
  }

  input(tab: string, data: string): void {
    const route = this.store.input(tab, data)
    if (route === 'write') this.pty.write(tab, data)
    else if (route === 'restart') this.start(tab)
    else if (route === 'new-conversation') this.start(tab, 'new')
  }

  resize(tab: string, cols: number, rows: number): void {
    this.pty.resize(tab, cols, rows)
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) return
    this.sized.add(tab)
    if (this.termSize?.cols === cols && this.termSize.rows === rows) return
    this.termSize = { cols, rows }
    this.deps.onPersist()
  }

  attach(tab: string): { data: string; seq: number } {
    return this.pty.snapshot(tab)
  }

  updateView(view: ViewState): void {
    this.layout = view.layout
    this.activeTab = view.activeTab
    this.sidebar = view.sidebar
    this.visible = new Set(view.visibleTabs)
    this.fixView()
    this.deps.onPersist()
    for (const tab of this.visible) {
      if (this.store.get(tab)?.status === 'sleeping') this.start(tab)
    }
    if (this.focused) this.markShown()
  }

  setWindowFocused(focused: boolean): void {
    this.focused = focused
    if (focused) this.markShown()
  }

  hook(ev: HookEvent): void {
    if (!this.store.hook(ev)) this.deps.log.info(`хук ${ev.event} от неизвестной вкладки`)
  }

  checkSilence(): void {
    this.store.checkSilence((tab) => this.pty.lastOutputAt(tab), this.deps.getConfig().status.silenceMs)
  }

  tabs(): TabInfo[] {
    return this.store.list()
  }

  view(): ViewState {
    return { layout: this.layout, activeTab: this.activeTab, sidebar: this.sidebar, visibleTabs: [...this.visible] }
  }

  workspace(): Workspace {
    return {
      version: 1,
      tabs: this.store.records(),
      layout: this.layout,
      activeTab: this.activeTab,
      sidebar: this.sidebar,
      ...(this.termSize ? { termSize: this.termSize } : {})
    }
  }

  shutdown(): void {
    this.pty.killAll()
  }

  private freshId(): string {
    let id = this.deps.newId()
    while (this.store.get(id)) id = this.deps.newId()
    return id
  }

  // То же правило, что у parseWorkspace
  private fixView(): void {
    const tabs = this.store.list()
    const known = new Set(tabs.map((t) => t.id))
    this.layout = normalizeLayout(this.layout, known)
    if (!this.activeTab || !known.has(this.activeTab)) {
      this.activeTab = layoutTabs(this.layout)[0] ?? tabs[0]?.id ?? null
    }
    if (!this.layout && this.activeTab) this.layout = pane(this.activeTab)
    this.visible = new Set([...this.visible].filter((t) => known.has(t)))
  }

  private markShown(): void {
    for (const tab of this.visible) this.store.shown(tab)
  }

  private start(tab: string, mode?: ClaudeStart): void {
    const rec = this.store.get(tab)
    if (!rec) return
    if (!this.deps.isDir(rec.cwd)) {
      this.fail(tab, `Папка не найдена: ${rec.cwd}`, ['pick-folder', 'close'])
      return
    }
    const start = mode ?? (rec.claudeSessionId ? 'resume' : 'new')
    const spec = buildLaunch(rec, this.deps.getConfig(), this.deps.launch, start)
    // вкладка Claude всегда на PowerShell, другая оболочка ей не поможет
    const actions: NoteAction[] = rec.kind === 'shell' ? ['pick-shell', 'close'] : ['close']
    const file = resolveExecutable(spec.file, spec.env, (p) => this.deps.fileExists(p))
    if (!file) {
      this.fail(tab, `Оболочка не найдена: ${spec.file}`, actions)
      return
    }
    // вкладку ещё не показывали: пусть стартует в размере последнего терминала, а не 120×30
    if (!this.sized.has(tab) && this.termSize) this.pty.resize(tab, this.termSize.cols, this.termSize.rows)
    try {
      this.pty.spawn(tab, { ...spec, file })
    } catch (err) {
      this.fail(tab, `Не удалось запустить ${spec.file}: ${errorText(err)}`, actions)
      return
    }
    this.store.setAlive(tab, true)
    this.store.apply(tab, { type: 'spawned' })
    this.deps.log.info(`вкладка ${tab}: запущен ${file}`)
  }

  private fail(tab: string, text: string, actions: NoteAction[]): void {
    this.pty.kill(tab)
    this.store.setAlive(tab, false)
    this.store.apply(tab, { type: 'spawn-failed' })
    this.store.setNote(tab, { text, actions })
    this.deps.log.warn(`вкладка ${tab}: ${text}`)
  }

  private onExit(tab: string, code: number): void {
    if (!this.store.get(tab)) return
    this.store.setAlive(tab, false)
    this.store.apply(tab, { type: 'process-exit', code })
    this.store.setNote(tab, { text: `Процесс завершён (код ${code}). Enter — перезапустить`, actions: ['close'] })
    this.deps.log.info(`вкладка ${tab}: процесс завершён, код ${code}`)
  }

  private onClaudeExit(tab: string, code: number): void {
    if (!this.store.get(tab)) return
    this.store.apply(tab, { type: 'claude-exit', code })
    if (code !== 0) {
      this.store.setNote(tab, {
        text: `Claude завершился с кодом ${code}. Enter — новый разговор, другая клавиша — консоль`,
        actions: ['close']
      })
    }
    this.deps.log.info(`вкладка ${tab}: claude завершился, код ${code}`)
  }
}
