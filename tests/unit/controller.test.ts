import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../src/main/config'
import { Controller } from '../../src/main/controller'
import type { SpawnSpec } from '../../src/main/launch'
import type { PtyCallbacks } from '../../src/main/pty-manager'
import type { Alert } from '../../src/main/session-store'
import { pane } from '../../src/shared/layout'
import {
  EMPTY_SIDEBAR,
  type AppConfig,
  type HookEvent,
  type LayoutNode,
  type TabRecord,
  type ViewState,
  type Workspace
} from '../../src/shared/types'

const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
const CMD = 'C:\\Windows\\System32\\cmd.exe'
const ENV = { PATH: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0;C:\\Windows\\System32', PATHEXT: '.COM;.EXE' }
const DIRS = new Set(['C:\\work\\A', 'C:\\work\\B'])
const TOKEN = 'secret-token-42'

// Подмена PtyManager: запоминает вызовы, процесс «жив» до exit или kill
class FakePty {
  spawns: { tab: string; spec: SpawnSpec }[] = []
  writes: [string, string][] = []
  resizes: [string, number, number][] = []
  forgotten: string[] = []
  alive = new Set<string>()
  last = new Map<string, number>()
  failNext: string | null = null

  constructor(readonly cb: PtyCallbacks) {}

  spawn(tab: string, spec: SpawnSpec): void {
    this.alive.delete(tab)
    if (this.failNext) {
      const msg = this.failNext
      this.failNext = null
      throw new Error(msg)
    }
    this.spawns.push({ tab, spec })
    this.alive.add(tab)
  }

  write(tab: string, data: string): void {
    if (this.alive.has(tab)) this.writes.push([tab, data])
  }

  resize(tab: string, cols: number, rows: number): void {
    this.resizes.push([tab, cols, rows])
  }

  kill(tab: string): void {
    this.alive.delete(tab)
  }

  forget(tab: string): void {
    this.kill(tab)
    this.forgotten.push(tab)
  }

  isAlive(tab: string): boolean {
    return this.alive.has(tab)
  }

  snapshot(tab: string): { data: string; seq: number } {
    return { data: `вывод ${tab}`, seq: 7 }
  }

  lastOutputAt(tab: string): number | null {
    return this.alive.has(tab) ? (this.last.get(tab) ?? null) : null
  }

  killAll(): void {
    this.alive.clear()
  }

  // процесс вкладки завершился сам
  exit(tab: string, code: number): void {
    this.alive.delete(tab)
    this.cb.onExit(tab, code)
  }
}

function rec(id: string, over: Partial<TabRecord> = {}): TabRecord {
  return {
    id,
    title: 'A',
    cwd: 'C:\\work\\A',
    kind: 'shell',
    shell: 'powershell',
    claudeSessionId: null,
    customTitle: false,
    ...over
  }
}

function ws(tabs: TabRecord[], activeTab: string): Workspace {
  return { version: 1, tabs, layout: pane(activeTab), activeTab, sidebar: EMPTY_SIDEBAR }
}

function view(layout: LayoutNode | null, activeTab: string | null, visibleTabs: string[]): ViewState {
  return { layout, activeTab, sidebar: EMPTY_SIDEBAR, visibleTabs }
}

function split(...tabs: string[]): LayoutNode {
  return { type: 'split', dir: 'row', sizes: tabs.map(() => 1 / tabs.length), children: tabs.map((t) => pane(t)) }
}

function setup(over: Partial<AppConfig> = {}) {
  let now = 1000
  let ids = 0
  const config: AppConfig = { ...DEFAULT_CONFIG, ...over }
  const ptys: FakePty[] = []
  const alerts: Alert[] = []
  const data: [string, number, string][] = []
  const logs: string[] = []
  const counts = { state: 0, persist: 0 }
  const ctl = new Controller({
    getConfig: () => config,
    launch: { port: 4000, token: TOKEN, baseEnv: ENV },
    makePty: (cb) => {
      const p = new FakePty(cb)
      ptys.push(p)
      return p
    },
    isDir: (p) => DIRS.has(p),
    fileExists: (p) => p === PS || p === CMD,
    now: () => now,
    newId: () => `t${++ids}`,
    log: {
      info: (m) => logs.push(m),
      warn: (m) => logs.push(m),
      error: (m) => logs.push(m)
    },
    onState: () => {
      counts.state++
    },
    onPersist: () => {
      counts.persist++
    },
    onData: (tab, seq, d) => data.push([tab, seq, d]),
    onAlert: (a) => alerts.push(a)
  })
  const pty = ptys[0]
  const tab = (id: string) => ctl.tabs().find((t) => t.id === id)
  const status = (id: string) => tab(id)?.status
  const lastSpec = () => pty.spawns[pty.spawns.length - 1].spec
  // скрипт PowerShell вкладки Claude — последний аргумент
  const lastScript = () => {
    const args = lastSpec().args
    return args[args.length - 1]
  }
  // событие хука с текущим временем
  const hook = (id: string, event: string, p: Partial<HookEvent> = {}): HookEvent => ({
    tab: id,
    event,
    sessionId: null,
    cwd: null,
    source: null,
    reason: null,
    notificationType: null,
    message: null,
    lastAssistantMessage: null,
    isAgent: false,
    ts: now,
    ...p
  })
  const tick = (ms: number) => {
    now += ms
  }
  const time = () => now
  return { ctl, pty, alerts, data, logs, counts, tab, status, lastSpec, lastScript, hook, tick, time }
}

describe('Controller: восстановление', () => {
  it('lazy: сразу стартует только активная вкладка, остальные — когда их покажут', () => {
    const { ctl, pty, status, lastSpec, lastScript } = setup()
    ctl.restore(ws([rec('a'), rec('b', { cwd: 'C:\\work\\B', kind: 'claude', claudeSessionId: 'sess-1' })], 'b'))
    expect(pty.spawns.map((s) => s.tab)).toEqual(['b'])
    expect(status('a')).toBe('sleeping')
    expect(status('b')).toBe('starting')
    expect(lastSpec().file).toBe(PS)
    expect(lastSpec().cwd).toBe('C:\\work\\B')
    expect(lastSpec().env.T3000_TAB_ID).toBe('b')
    expect(lastScript()).toContain("claude --resume 'sess-1';")
    ctl.updateView(view(split('b', 'a'), 'b', ['b', 'a']))
    expect(pty.spawns.map((s) => s.tab)).toEqual(['b', 'a'])
    expect(status('a')).toBe('shell')
    expect(lastSpec().args).toEqual(['-NoLogo'])
  })

  it('eager: стартуют все вкладки, shutdown их убивает', () => {
    const { ctl, pty } = setup({ restore: 'eager' })
    ctl.restore(ws([rec('a'), rec('b', { cwd: 'C:\\work\\B' })], 'a'))
    expect(pty.spawns.map((s) => s.tab)).toEqual(['a', 'b'])
    ctl.shutdown()
    expect(pty.alive.size).toBe(0)
  })

  it('без workspace.json вкладок нет', () => {
    const { ctl, pty } = setup()
    ctl.restore(null)
    expect(ctl.tabs()).toEqual([])
    expect(ctl.view()).toEqual(view(null, null, []))
    expect(pty.spawns).toEqual([])
  })
})

describe('Controller: ошибки запуска', () => {
  it('папки нет: вкладка упала, можно выбрать другую папку', () => {
    const { ctl, pty, tab } = setup()
    ctl.restore(ws([rec('a', { cwd: 'C:\\gone\\A' })], 'a'))
    expect(pty.spawns).toEqual([])
    expect(tab('a')).toMatchObject({
      status: 'crashed',
      alive: false,
      note: { text: 'Папка не найдена: C:\\gone\\A', actions: ['pick-folder', 'close'] }
    })
    // несуществующая папка не принимается
    ctl.setTabCwd('a', 'C:\\gone\\B')
    expect(pty.spawns).toEqual([])
    ctl.setTabCwd('a', 'C:\\work\\B')
    expect(pty.spawns.map((s) => s.spec.cwd)).toEqual(['C:\\work\\B'])
    expect(tab('a')).toMatchObject({ status: 'shell', alive: true, note: null, cwd: 'C:\\work\\B', title: 'B' })
  })

  it('оболочки нет: можно выбрать другую', () => {
    const { ctl, pty, tab, lastSpec } = setup()
    expect(ctl.createTab({ cwd: 'C:\\work\\A', kind: 'shell', shell: 'gitbash' })).toBe('t1')
    expect(pty.spawns).toEqual([])
    expect(tab('t1')).toMatchObject({
      shell: 'gitbash',
      status: 'crashed',
      note: { text: 'Оболочка не найдена: C:/Program Files/Git/bin/bash.exe', actions: ['pick-shell', 'close'] }
    })
    // неизвестная оболочка: вызов игнорируется целиком
    ctl.startTab('t1', 'нет-такой')
    expect(pty.spawns).toEqual([])
    expect(tab('t1')?.shell).toBe('gitbash')
    ctl.startTab('t1', 'cmd')
    expect(lastSpec()).toMatchObject({ file: CMD, args: [] })
    expect(tab('t1')).toMatchObject({ shell: 'cmd', status: 'shell', alive: true, note: null })
  })

  it('ошибка spawn попадает в подсказку и в лог', () => {
    const { ctl, pty, tab, logs } = setup()
    pty.failNext = 'Cannot create process, error code: 267'
    ctl.createTab({ cwd: 'C:\\work\\A', kind: 'shell' })
    expect(tab('t1')).toMatchObject({
      status: 'crashed',
      alive: false,
      note: {
        text: 'Не удалось запустить powershell.exe: Cannot create process, error code: 267',
        actions: ['pick-shell', 'close']
      }
    })
    expect(logs).toContain('вкладка t1: Не удалось запустить powershell.exe: Cannot create process, error code: 267')
  })
})

describe('Controller: новые вкладки', () => {
  it('папки нет — вкладка не создаётся', () => {
    const { ctl, pty } = setup()
    expect(ctl.createTab({ cwd: 'C:\\gone', kind: 'shell' })).toBeNull()
    expect(ctl.tabs()).toEqual([])
    expect(pty.spawns).toEqual([])
  })

  it('первая вкладка становится активной, следующие layout не трогают', () => {
    const { ctl } = setup()
    ctl.createTab({ cwd: 'C:\\work\\A', kind: 'shell' })
    ctl.createTab({ cwd: 'C:\\work\\B', kind: 'shell' })
    expect(ctl.view()).toMatchObject({ layout: pane('t1'), activeTab: 't1' })
    expect(ctl.tabs().map((t) => [t.id, t.title, t.status])).toEqual([
      ['t1', 'A', 'shell'],
      ['t2', 'B', 'shell']
    ])
  })

  it('режимы запуска Claude', () => {
    const { ctl, tab, lastScript } = setup()
    ctl.createTab({ cwd: 'C:\\work\\A', kind: 'claude' })
    expect(lastScript()).toContain('$global:LASTEXITCODE = $null; claude; $ok')
    ctl.createTab({ cwd: 'C:\\work\\A', kind: 'claude', claude: 'continue' })
    expect(lastScript()).toContain('claude --continue;')
    ctl.createTab({ cwd: 'C:\\work\\A', kind: 'claude', claude: 'resume', sessionId: 'sess-9', shell: 'cmd' })
    expect(lastScript()).toContain("claude --resume 'sess-9';")
    // вкладка Claude всегда на PowerShell: после выхода claude в ней остаётся консоль
    expect(tab('t3')).toMatchObject({ kind: 'claude', shell: 'powershell', claudeSessionId: 'sess-9', status: 'starting' })
  })

  it('своё имя, неизвестная оболочка и занятый id', () => {
    const { ctl, tab } = setup()
    ctl.restore(ws([rec('t1')], 't1'))
    // первый newId() вернёт занятый t1
    expect(ctl.createTab({ cwd: 'C:\\work\\B', kind: 'shell', shell: 'нет-такой', title: '  Сборка  ' })).toBe('t2')
    expect(tab('t2')).toMatchObject({ title: 'Сборка', customTitle: true, shell: 'powershell' })
  })
})

describe('Controller: ввод и процессы', () => {
  it('ввод идёт в pty; после выхода процесса Enter перезапускает вкладку', () => {
    const { ctl, pty, tab } = setup()
    ctl.createTab({ cwd: 'C:\\work\\A', kind: 'shell' })
    ctl.input('t1', 'dir\r')
    expect(pty.writes).toEqual([['t1', 'dir\r']])
    pty.exit('t1', 0)
    expect(tab('t1')).toMatchObject({
      status: 'shell',
      alive: false,
      note: { text: 'Процесс завершён (код 0). Enter — перезапустить', actions: ['close'] }
    })
    ctl.input('t1', 'x')
    expect(pty.spawns).toHaveLength(1)
    ctl.input('t1', '\r')
    expect(pty.spawns).toHaveLength(2)
    expect(tab('t1')).toMatchObject({ status: 'shell', alive: true, note: null })
    expect(pty.writes).toEqual([['t1', 'dir\r']])
  })

  it('упавший claude: Enter — новый разговор, другая клавиша — консоль', () => {
    const { ctl, pty, tab, lastScript } = setup()
    ctl.restore(ws([rec('a', { kind: 'claude', claudeSessionId: 'sess-1' })], 'a'))
    pty.cb.onClaudeExit('a', 1)
    expect(tab('a')).toMatchObject({
      status: 'crashed',
      kind: 'claude',
      alive: true,
      note: { text: 'Claude завершился с кодом 1. Enter — новый разговор, другая клавиша — консоль', actions: ['close'] }
    })
    // автоответ терминала уходит в pty и ничего не решает
    ctl.input('a', '\x1b[I')
    expect(tab('a')?.status).toBe('crashed')
    ctl.input('a', '\r')
    expect(pty.spawns).toHaveLength(2)
    expect(lastScript()).not.toContain('--resume')
    expect(tab('a')).toMatchObject({ status: 'starting', note: null })
    pty.cb.onClaudeExit('a', 1)
    ctl.input('a', 'l')
    expect(pty.spawns).toHaveLength(2)
    expect(tab('a')).toMatchObject({ status: 'shell', kind: 'shell', note: null })
    expect(pty.writes).toEqual([
      ['a', '\x1b[I'],
      ['a', 'l']
    ])
  })

  it('claude вышел с кодом 0: вкладка стала консолью и так же перезапускается', () => {
    const { ctl, pty, tab, lastSpec } = setup()
    ctl.restore(ws([rec('a', { kind: 'claude', claudeSessionId: 'sess-1' })], 'a'))
    pty.cb.onClaudeExit('a', 0)
    expect(tab('a')).toMatchObject({ status: 'shell', kind: 'shell', note: null })
    expect(ctl.workspace().tabs[0].kind).toBe('shell')
    pty.exit('a', 0)
    ctl.input('a', '\r')
    expect(lastSpec()).toMatchObject({ file: PS, args: ['-NoLogo'] })
  })

  it('размер, снимок буфера и вывод проходят насквозь', () => {
    const { ctl, pty, data } = setup()
    ctl.createTab({ cwd: 'C:\\work\\A', kind: 'shell' })
    ctl.resize('t1', 100, 40)
    expect(pty.resizes).toEqual([['t1', 100, 40]])
    expect(ctl.attach('t1')).toEqual({ data: 'вывод t1', seq: 7 })
    pty.cb.onData('t1', 8, 'hi')
    expect(data).toEqual([['t1', 8, 'hi']])
  })

  it('тишина в working переводит вкладку в idle', () => {
    const { ctl, pty, status, hook, tick, time } = setup()
    ctl.restore(ws([rec('a', { kind: 'claude' })], 'a'))
    tick(10)
    ctl.hook(hook('a', 'UserPromptSubmit'))
    pty.last.set('a', time())
    tick(3999)
    ctl.checkSilence()
    expect(status('a')).toBe('working')
    tick(1)
    ctl.checkSilence()
    expect(status('a')).toBe('idle')
  })

  it('лог: хук неизвестной вкладки; вывода, текста Claude и токена нет', () => {
    const { ctl, pty, logs, hook } = setup()
    ctl.createTab({ cwd: 'C:\\work\\A', kind: 'claude' })
    pty.cb.onData('t1', 1, 'секретный вывод')
    ctl.hook(hook('t1', 'Stop', { lastAssistantMessage: 'секретный ответ' }))
    ctl.hook(hook('ghost', 'Stop'))
    expect(logs).toContain('хук Stop от неизвестной вкладки')
    expect(logs).toContain(`вкладка t1: запущен ${PS}`)
    const all = logs.join('\n')
    expect(all).not.toContain('секрет')
    expect(all).not.toContain(TOKEN)
  })
})

describe('Controller: вид и уведомления', () => {
  it('closeTab убивает процесс и чинит layout', () => {
    const { ctl, pty } = setup()
    ctl.createTab({ cwd: 'C:\\work\\A', kind: 'shell' })
    ctl.createTab({ cwd: 'C:\\work\\B', kind: 'shell' })
    ctl.updateView(view(split('t1', 't2'), 't1', ['t1', 't2']))
    ctl.closeTab('t1')
    expect(pty.forgotten).toEqual(['t1'])
    expect(ctl.tabs().map((t) => t.id)).toEqual(['t2'])
    expect(ctl.view()).toEqual(view(pane('t2'), 't2', ['t2']))
    expect(ctl.workspace().tabs.map((t) => t.id)).toEqual(['t2'])
    // повторное закрытие ничего не делает
    ctl.closeTab('t1')
    expect(pty.forgotten).toEqual(['t1'])
  })

  it('закрыли единственную показанную вкладку — показывается следующая', () => {
    const { ctl } = setup()
    ctl.createTab({ cwd: 'C:\\work\\A', kind: 'shell' })
    ctl.createTab({ cwd: 'C:\\work\\B', kind: 'shell' })
    ctl.closeTab('t1')
    expect(ctl.view()).toMatchObject({ layout: pane('t2'), activeTab: 't2' })
  })

  it('updateView отбрасывает неизвестные вкладки', () => {
    const { ctl } = setup()
    ctl.createTab({ cwd: 'C:\\work\\A', kind: 'shell' })
    ctl.updateView(view(split('t1', 'ghost'), 'ghost', ['t1', 'ghost']))
    expect(ctl.view()).toEqual(view(pane('t1'), 't1', ['t1']))
  })

  it('workspace() и запросы на сохранение', () => {
    const { ctl, counts } = setup()
    ctl.createTab({ cwd: 'C:\\work\\A', kind: 'shell' })
    const before = counts.persist
    const sidebar = { collapsed: true, collapsedGroups: ['c:/work'] }
    ctl.updateView({ ...view(pane('t1'), 't1', ['t1']), sidebar })
    expect(counts.persist).toBe(before + 1)
    ctl.renameTab('t1', 'Сервер')
    expect(counts.persist).toBe(before + 2)
    expect(ctl.workspace()).toEqual({
      version: 1,
      tabs: [
        {
          id: 't1',
          title: 'Сервер',
          cwd: 'C:\\work\\A',
          kind: 'shell',
          shell: 'powershell',
          claudeSessionId: null,
          customTitle: true
        }
      ],
      layout: pane('t1'),
      activeTab: 't1',
      sidebar
    })
  })

  it('уведомления только для вкладок, которых не видно в активном окне', () => {
    const { ctl, alerts, status, hook, tick } = setup()
    ctl.restore(ws([rec('a', { kind: 'claude' }), rec('b')], 'a'))
    ctl.updateView(view(pane('a'), 'a', ['a']))
    tick(10)
    // окно ещё не в фокусе: вкладку никто не видит
    ctl.hook(hook('a', 'Stop'))
    expect(status('a')).toBe('done')
    expect(alerts.map((a) => a.title)).toEqual(['A · готово'])
    ctl.setWindowFocused(true)
    expect(status('a')).toBe('idle')
    tick(10)
    ctl.hook(hook('a', 'UserPromptSubmit'))
    tick(10)
    ctl.hook(hook('a', 'Stop'))
    expect(status('a')).toBe('idle')
    expect(alerts).toHaveLength(1)
    // переключились на другую вкладку
    ctl.updateView(view(pane('b'), 'b', ['b']))
    tick(10)
    ctl.hook(hook('a', 'UserPromptSubmit'))
    tick(10)
    ctl.hook(hook('a', 'Stop', { lastAssistantMessage: 'Тесты\nпрошли' }))
    expect(alerts[1]).toEqual({ tab: 'a', kind: 'done', title: 'A · готово', body: 'Тесты прошли' })
    // вернулись: «готово» снимается
    ctl.updateView(view(pane('a'), 'a', ['a']))
    expect(status('a')).toBe('idle')
  })

  it('без messagePreview текст Claude в уведомление не попадает', () => {
    const { ctl, alerts, hook, tick } = setup({
      notifications: { ...DEFAULT_CONFIG.notifications, messagePreview: false }
    })
    ctl.restore(ws([rec('a', { kind: 'claude' })], 'a'))
    tick(10)
    ctl.hook(hook('a', 'Stop', { lastAssistantMessage: 'секрет' }))
    expect(alerts.map((a) => a.body)).toEqual(['Claude закончил работу'])
  })
})
