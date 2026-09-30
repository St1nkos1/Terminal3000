import { spawn as ptySpawn } from 'node-pty'
import type { SpawnSpec } from './launch'
import { OscScanner } from './osc'
import { RingBuffer } from './ring-buffer'

export const BUFFER_CHARS = 200 * 1024
export const DEFAULT_SIZE = { cols: 120, rows: 30 }

export interface PtyCallbacks {
  onData(tab: string, seq: number, data: string): void
  onExit(tab: string, code: number): void
  onClaudeExit(tab: string, code: number): void
}

export interface PtyOptions {
  name: string
  cols: number
  rows: number
  cwd: string
  env: Record<string, string>
  useConptyDll: boolean
}

// Часть IPty из node-pty, которой пользуется менеджер; в unit-тестах подменяется
export interface PtyProcess {
  onData(cb: (data: string) => void): { dispose(): void }
  onExit(cb: (e: { exitCode: number }) => void): { dispose(): void }
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

export type SpawnFn = (file: string, args: string[], opts: PtyOptions) => PtyProcess

interface Entry {
  proc: PtyProcess
  osc: OscScanner
  alive: boolean
  lastOutputAt: number
}

export class PtyManager {
  // текущий процесс вкладки; остаётся здесь и после выхода, чтобы не потерять последний чанк
  private readonly procs = new Map<string, Entry>()
  private readonly buffers = new Map<string, RingBuffer>()
  private readonly sizes = new Map<string, { cols: number; rows: number }>()
  // общий счётчик чанков: после перезапуска вкладки нумерация не начинается заново
  private seq = 0

  constructor(
    private readonly cb: PtyCallbacks,
    private readonly spawnFn: SpawnFn = ptySpawn,
    private readonly now: () => number = Date.now
  ) {}

  // Бросает исключение, если процесс не запустился (нет файла или папки)
  spawn(tab: string, spec: SpawnSpec): void {
    this.kill(tab)
    const size = this.sizes.get(tab) ?? DEFAULT_SIZE
    const proc = this.spawnFn(spec.file, spec.args, {
      name: 'xterm-256color',
      cols: size.cols,
      rows: size.rows,
      cwd: spec.cwd,
      env: spec.env,
      useConptyDll: true
    })
    const entry: Entry = { proc, osc: new OscScanner(), alive: true, lastOutputAt: this.now() }
    this.procs.set(tab, entry)
    const buffer = this.bufferFor(tab)
    proc.onData((data) => {
      // вывод процесса, убитого при перезапуске или закрытии вкладки, не нужен
      if (this.procs.get(tab) !== entry) return
      entry.lastOutputAt = this.now()
      buffer.push(data)
      this.cb.onData(tab, ++this.seq, data)
      for (const code of entry.osc.feed(data)) this.cb.onClaudeExit(tab, code)
    })
    proc.onExit((e) => {
      if (this.procs.get(tab) !== entry || !entry.alive) return
      entry.alive = false
      this.cb.onExit(tab, e.exitCode)
    })
  }

  write(tab: string, data: string): void {
    const e = this.procs.get(tab)
    if (e?.alive) e.proc.write(data)
  }

  resize(tab: string, cols: number, rows: number): void {
    if (!Number.isInteger(cols) || !Number.isInteger(rows)) return
    if (cols < 2 || rows < 1 || cols > 1000 || rows > 500) return
    this.sizes.set(tab, { cols, rows })
    const e = this.procs.get(tab)
    if (!e?.alive) return
    try {
      e.proc.resize(cols, rows)
    } catch {
      // процесс уже завершился, а onExit ещё не пришёл
    }
  }

  // Сначала отвязывает процесс от вкладки: его поздний onExit уже ни на что не влияет
  kill(tab: string): void {
    const e = this.procs.get(tab)
    if (!e) return
    this.procs.delete(tab)
    if (!e.alive) return
    e.alive = false
    try {
      e.proc.kill()
    } catch {
      // процесс уже завершился
    }
  }

  // Закрытие вкладки: процесс, буфер вывода и размер
  forget(tab: string): void {
    this.kill(tab)
    this.buffers.delete(tab)
    this.sizes.delete(tab)
  }

  isAlive(tab: string): boolean {
    return this.procs.get(tab)?.alive === true
  }

  // Для переподключения renderer: чанки с номером ≤ seq уже есть в data
  snapshot(tab: string): { data: string; seq: number } {
    return { data: this.buffers.get(tab)?.text() ?? '', seq: this.seq }
  }

  lastOutputAt(tab: string): number | null {
    const e = this.procs.get(tab)
    return e?.alive ? e.lastOutputAt : null
  }

  killAll(): void {
    for (const tab of [...this.procs.keys()]) this.kill(tab)
  }

  private bufferFor(tab: string): RingBuffer {
    let b = this.buffers.get(tab)
    if (!b) {
      b = new RingBuffer(BUFFER_CHARS)
      this.buffers.set(tab, b)
    }
    return b
  }
}
