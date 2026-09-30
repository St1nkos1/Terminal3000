import { describe, expect, it } from 'vitest'
import type { SpawnSpec } from '../../src/main/launch'
import { BUFFER_CHARS, PtyManager, type PtyOptions, type PtyProcess } from '../../src/main/pty-manager'

class FakePty implements PtyProcess {
  written: string[] = []
  killed = 0
  exited = false
  size: [number, number]
  private dataCbs: ((d: string) => void)[] = []
  private exitCbs: ((e: { exitCode: number }) => void)[] = []

  constructor(
    readonly file: string,
    readonly args: string[],
    readonly opts: PtyOptions
  ) {
    this.size = [opts.cols, opts.rows]
  }

  onData(cb: (d: string) => void) {
    this.dataCbs.push(cb)
    return { dispose: () => undefined }
  }

  onExit(cb: (e: { exitCode: number }) => void) {
    this.exitCbs.push(cb)
    return { dispose: () => undefined }
  }

  write(d: string) {
    this.written.push(d)
  }

  resize(cols: number, rows: number) {
    // как node-pty на Windows
    if (this.exited) throw new Error('Cannot resize a pty that has already exited')
    this.size = [cols, rows]
  }

  kill() {
    this.killed++
  }

  emitData(d: string) {
    for (const cb of this.dataCbs) cb(d)
  }

  emitExit(code: number) {
    this.exited = true
    for (const cb of this.exitCbs) cb({ exitCode: code })
  }
}

const SPEC: SpawnSpec = { file: 'powershell.exe', args: ['-NoLogo'], cwd: 'C:/work', env: { T3000_TAB_ID: 't1' } }

function setup(missingFile?: string) {
  const procs: FakePty[] = []
  const events: string[] = []
  let t = 1000
  const mgr = new PtyManager(
    {
      onData: (tab, seq, data) => events.push(`data ${tab} ${seq} ${data}`),
      onExit: (tab, code) => events.push(`exit ${tab} ${code}`),
      onClaudeExit: (tab, code) => events.push(`claude-exit ${tab} ${code}`)
    },
    (file, args, opts) => {
      if (file === missingFile) throw new Error('File not found: ')
      const p = new FakePty(file, args, opts)
      procs.push(p)
      return p
    },
    () => t
  )
  const tick = (ms: number) => {
    t += ms
  }
  return { mgr, procs, events, tick }
}

describe('PtyManager', () => {
  it('запускает процесс по SpawnSpec через conpty.dll', () => {
    const { mgr, procs } = setup()
    mgr.spawn('t1', SPEC)
    expect(procs).toHaveLength(1)
    expect(procs[0].file).toBe('powershell.exe')
    expect(procs[0].args).toEqual(['-NoLogo'])
    expect(procs[0].opts).toEqual({
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: 'C:/work',
      env: { T3000_TAB_ID: 't1' },
      useConptyDll: true
    })
    expect(mgr.isAlive('t1')).toBe(true)
  })

  it('вывод: номер чанка, буфер, время последнего вывода', () => {
    const { mgr, procs, events, tick } = setup()
    mgr.spawn('t1', SPEC)
    procs[0].emitData('a')
    tick(50)
    procs[0].emitData('b')
    expect(events).toEqual(['data t1 1 a', 'data t1 2 b'])
    expect(mgr.snapshot('t1')).toEqual({ data: 'ab', seq: 2 })
    expect(mgr.lastOutputAt('t1')).toBe(1050)
  })

  it('номера чанков общие для всех вкладок', () => {
    const { mgr, procs, events } = setup()
    mgr.spawn('t1', SPEC)
    mgr.spawn('t2', SPEC)
    procs[1].emitData('x')
    procs[0].emitData('y')
    expect(events).toEqual(['data t2 1 x', 'data t1 2 y'])
    expect(mgr.snapshot('t2')).toEqual({ data: 'x', seq: 2 })
  })

  it('claude-exit из потока pty, в том числе разрезанный на два чанка', () => {
    const { mgr, procs, events } = setup()
    mgr.spawn('t1', SPEC)
    procs[0].emitData('вывод\x1b]7777;t3000;cla')
    procs[0].emitData('ude-exit;2\x07PS C:\\work> ')
    expect(events.filter((e) => !e.startsWith('data'))).toEqual(['claude-exit t1 2'])
    expect(mgr.isAlive('t1')).toBe(true)
  })

  it('выход процесса: onExit, ввод больше не уходит', () => {
    const { mgr, procs, events } = setup()
    mgr.spawn('t1', SPEC)
    procs[0].emitExit(0)
    mgr.write('t1', 'dir\r')
    expect(events).toEqual(['exit t1 0'])
    expect(procs[0].written).toEqual([])
    expect(mgr.isAlive('t1')).toBe(false)
    expect(mgr.lastOutputAt('t1')).toBeNull()
  })

  it('вывод, пришедший сразу после выхода, не теряется', () => {
    const { mgr, procs, events } = setup()
    mgr.spawn('t1', SPEC)
    procs[0].emitExit(1)
    procs[0].emitData('последняя строка')
    expect(events).toEqual(['exit t1 1', 'data t1 1 последняя строка'])
  })

  it('перезапуск: выход и вывод старого процесса игнорируются', () => {
    const { mgr, procs, events } = setup()
    mgr.spawn('t1', SPEC)
    mgr.spawn('t1', SPEC)
    expect(procs[0].killed).toBe(1)
    // node-pty присылает onExit убитого процесса примерно через 1,5 с, когда новый уже работает
    procs[0].emitData('старый')
    procs[0].emitExit(1)
    expect(events).toEqual([])
    expect(mgr.isAlive('t1')).toBe(true)
    procs[1].emitData('новый')
    procs[1].emitExit(0)
    expect(events).toEqual(['data t1 1 новый', 'exit t1 0'])
  })

  it('закрытие: поздний выход не воскрешает вкладку', () => {
    const { mgr, procs, events } = setup()
    mgr.spawn('t1', SPEC)
    procs[0].emitData('текст')
    mgr.forget('t1')
    expect(procs[0].killed).toBe(1)
    procs[0].emitExit(1)
    expect(events).toEqual(['data t1 1 текст'])
    expect(mgr.isAlive('t1')).toBe(false)
    expect(mgr.snapshot('t1').data).toBe('')
  })

  it('буфер переживает перезапуск и ограничен по размеру', () => {
    const { mgr, procs } = setup()
    mgr.spawn('t1', SPEC)
    procs[0].emitData('раз ')
    procs[0].emitExit(0)
    mgr.spawn('t1', SPEC)
    procs[1].emitData('два')
    expect(mgr.snapshot('t1').data).toBe('раз два')
    procs[1].emitData('x'.repeat(BUFFER_CHARS))
    expect(mgr.snapshot('t1').data).toBe('x'.repeat(BUFFER_CHARS))
  })

  it('resize: размер запоминается до запуска, после выхода не бросает', () => {
    const { mgr, procs } = setup()
    mgr.resize('t1', 100, 40)
    mgr.spawn('t1', SPEC)
    expect([procs[0].opts.cols, procs[0].opts.rows]).toEqual([100, 40])
    mgr.resize('t1', 90, 20)
    expect(procs[0].size).toEqual([90, 20])
    // процесс уже вышел, а onExit ещё не пришёл
    procs[0].exited = true
    expect(() => mgr.resize('t1', 80, 24)).not.toThrow()
    mgr.resize('t1', 0, 10)
    mgr.resize('t1', Number.NaN, 10)
    mgr.resize('t1', 80.5, 10)
    mgr.spawn('t1', SPEC)
    expect([procs[1].opts.cols, procs[1].opts.rows]).toEqual([80, 24])
  })

  it('ошибка запуска бросает исключение, вкладка остаётся без процесса', () => {
    const { mgr } = setup('missing.exe')
    expect(() => mgr.spawn('t1', { ...SPEC, file: 'missing.exe' })).toThrow('File not found')
    expect(mgr.isAlive('t1')).toBe(false)
    expect(mgr.snapshot('t1').data).toBe('')
  })

  it('killAll убивает все процессы, их выходы не приходят', () => {
    const { mgr, procs, events } = setup()
    mgr.spawn('t1', SPEC)
    mgr.spawn('t2', SPEC)
    mgr.killAll()
    procs[0].emitExit(1)
    procs[1].emitExit(1)
    expect(procs.map((p) => p.killed)).toEqual([1, 1])
    expect(events).toEqual([])
    expect(mgr.isAlive('t1') || mgr.isAlive('t2')).toBe(false)
  })
})
