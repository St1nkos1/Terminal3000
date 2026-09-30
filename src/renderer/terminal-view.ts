import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal, type ITheme } from '@xterm/xterm'
import type { T3000Api } from '../shared/ipc'
import type { AppConfig } from '../shared/types'
import { clipboardInput, osc8LinkHandler, quotePaths, terminalKeyAction } from './input'
import type { ViewsControl } from './actions'

const THEME: ITheme = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  selectionBackground: '#264f78',
  black: '#1e1e1e',
  red: '#f14c4c',
  green: '#23d18b',
  yellow: '#f5f543',
  blue: '#3b8eea',
  magenta: '#d670d6',
  cyan: '#29b8db',
  white: '#cccccc',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5'
}

const SEARCH_DECORATIONS = {
  matchOverviewRuler: '#e5c07b',
  activeMatchColorOverviewRuler: '#ff9632',
  matchBackground: '#614d1f',
  activeMatchBackground: '#9e6a03'
}

// Один экземпляр xterm на вкладку, вне цикла рендеринга React
export class TerminalView {
  readonly el: HTMLDivElement
  private readonly term: Terminal
  private readonly fit = new FitAddon()
  private readonly search = new SearchAddon()
  private webgl: WebglAddon | null = null
  private opened = false
  // пока не пришёл снимок буфера, чанки копятся здесь
  private pending: { seq: number; data: string }[] | null = []
  private lastSeq = 0
  private readonly observer: ResizeObserver
  private fitFrame = 0

  constructor(
    readonly tab: string,
    private readonly api: T3000Api,
    private config: AppConfig,
    osBuild: number
  ) {
    this.el = document.createElement('div')
    this.el.className = 'term'
    this.term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily: config.font.family,
      fontSize: config.font.size,
      scrollback: config.scrollback,
      theme: THEME,
      windowsPty: { backend: 'conpty', buildNumber: osBuild },
      linkHandler: osc8LinkHandler((uri) => api.openExternal(uri))
    })
    this.term.loadAddon(this.fit)
    this.term.loadAddon(this.search)
    this.term.loadAddon(new Unicode11Addon())
    this.term.unicode.activeVersion = '11'
    this.term.loadAddon(
      new WebLinksAddon((event, uri) => {
        event.preventDefault()
        api.openExternal(uri)
      })
    )
    // OSC 7777 (код выхода claude) разбирает main, на экран он не попадает
    this.term.parser.registerOscHandler(7777, () => true)
    this.term.attachCustomKeyEventHandler((e) => this.onKey(e))
    this.term.onData((data) => api.input(tab, data))
    this.term.onBinary((data) => api.input(tab, data))
    this.term.onResize(({ cols, rows }) => api.resize(tab, cols, rows))
    this.el.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      void this.paste()
    })
    this.el.addEventListener('dragover', (e) => e.preventDefault())
    this.el.addEventListener('drop', (e) => this.onDrop(e))
    this.observer = new ResizeObserver(() => this.scheduleFit())
    this.observer.observe(this.el)
  }

  // xterm открывается при первом показе: на элементе вне DOM он не может измерить шрифт
  mount(host: HTMLElement): void {
    if (this.el.parentElement !== host) host.appendChild(this.el)
    if (!this.opened) {
      this.term.open(this.el)
      this.opened = true
      if (this.config.webgl) this.enableWebgl()
      void this.attach()
    }
    this.fitNow()
    this.term.refresh(0, this.term.rows - 1)
    // размер pty мог остаться от запуска (120×30), сообщаем настоящий
    this.api.resize(this.tab, this.term.cols, this.term.rows)
  }

  unmount(host: HTMLElement): void {
    if (this.el.parentElement === host) host.removeChild(this.el)
  }

  write(seq: number, data: string): void {
    if (this.pending) {
      this.pending.push({ seq, data })
      return
    }
    if (seq <= this.lastSeq) return
    this.lastSeq = seq
    this.term.write(data)
  }

  focus(): void {
    this.term.focus()
  }

  async paste(): Promise<void> {
    const r = clipboardInput(await this.api.readClipboard())
    if (r?.type === 'text') this.term.paste(r.text)
    else if (r?.type === 'raw') this.api.input(this.tab, r.data)
  }

  find(query: string, dir: 'next' | 'prev'): boolean {
    if (!query) return false
    const opts = { decorations: SEARCH_DECORATIONS }
    return dir === 'next' ? this.search.findNext(query, opts) : this.search.findPrevious(query, opts)
  }

  clearSearch(): void {
    this.search.clearDecorations()
    this.term.clearSelection()
  }

  applyConfig(config: AppConfig): void {
    this.config = config
    this.term.options.fontFamily = config.font.family
    this.term.options.fontSize = config.font.size
    this.term.options.scrollback = config.scrollback
    if (config.webgl && !this.webgl && this.opened) this.enableWebgl()
    if (!config.webgl && this.webgl) {
      this.webgl.dispose()
      this.webgl = null
    }
    this.scheduleFit()
  }

  dispose(): void {
    this.observer.disconnect()
    cancelAnimationFrame(this.fitFrame)
    this.term.dispose()
    this.el.remove()
  }

  private async attach(): Promise<void> {
    try {
      const snap = await this.api.attach(this.tab)
      this.term.write(snap.data)
      this.lastSeq = snap.seq
    } catch {
      this.lastSeq = 0
    }
    const queued = this.pending ?? []
    this.pending = null
    for (const c of queued) this.write(c.seq, c.data)
  }

  private onKey(e: KeyboardEvent): boolean {
    const action = terminalKeyAction(e, this.term.hasSelection())
    if (!action) return true
    // иначе браузер ещё и вставит текст сам через событие paste
    e.preventDefault()
    if (e.type === 'keydown') {
      if (action === 'copy') {
        this.api.writeClipboard(this.term.getSelection())
        this.term.clearSelection()
      } else if (action === 'paste') {
        void this.paste()
      } else {
        this.api.input(this.tab, '\x1b\r')
      }
    }
    return false
  }

  private onDrop(e: DragEvent): void {
    e.preventDefault()
    const files = Array.from(e.dataTransfer?.files ?? [])
    const text = quotePaths(files.map((f) => this.api.pathForFile(f)))
    if (!text) return
    this.api.input(this.tab, text)
    this.term.focus()
  }

  private enableWebgl(): void {
    try {
      const addon = new WebglAddon()
      addon.onContextLoss(() => {
        addon.dispose()
        if (this.webgl === addon) this.webgl = null
      })
      this.term.loadAddon(addon)
      this.webgl = addon
    } catch {
      // WebGL недоступен — остаётся DOM-рендерер
      this.webgl = null
    }
  }

  private scheduleFit(): void {
    if (this.fitFrame) return
    this.fitFrame = requestAnimationFrame(() => {
      this.fitFrame = 0
      this.fitNow()
    })
  }

  private fitNow(): void {
    if (!this.opened || !this.el.isConnected || this.el.clientWidth === 0 || this.el.clientHeight === 0) return
    this.fit.fit()
  }
}

export class TerminalViews implements ViewsControl {
  private readonly views = new Map<string, TerminalView>()

  constructor(
    private readonly api: T3000Api,
    private readonly options: () => { config: AppConfig; osBuild: number }
  ) {}

  show(tab: string, host: HTMLElement): TerminalView {
    let v = this.views.get(tab)
    if (!v) {
      const o = this.options()
      v = new TerminalView(tab, this.api, o.config, o.osBuild)
      this.views.set(tab, v)
    }
    v.mount(host)
    return v
  }

  hide(tab: string, host: HTMLElement): void {
    this.views.get(tab)?.unmount(host)
  }

  get(tab: string): TerminalView | undefined {
    return this.views.get(tab)
  }

  focus(tab: string): void {
    this.views.get(tab)?.focus()
  }

  // Вкладку ещё ни разу не показывали — данные не нужны, при показе придёт снимок буфера
  onData(tab: string, seq: number, data: string): void {
    this.views.get(tab)?.write(seq, data)
  }

  prune(known: ReadonlySet<string>): void {
    for (const [tab, v] of this.views) {
      if (!known.has(tab)) {
        v.dispose()
        this.views.delete(tab)
      }
    }
  }

  applyConfig(config: AppConfig): void {
    for (const v of this.views.values()) v.applyConfig(config)
  }
}
