import { describe, expect, it } from 'vitest'
import { SessionStore, type Alert } from '../../src/main/session-store'
import type { HookEvent, TabRecord } from '../../src/shared/types'

const REC: TabRecord = {
  id: 't1',
  title: 'MyWebShop',
  cwd: 'C:\\work\\MyWebShop',
  kind: 'claude',
  shell: 'powershell',
  claudeSessionId: 'sess-1',
  customTitle: false
}

function setup(rec: TabRecord = REC) {
  let now = 1000
  let preview = true
  const visible = new Set<string>()
  const alerts: Alert[] = []
  const changes: boolean[] = []
  const logs: string[] = []
  const store = new SessionStore({
    now: () => now,
    isVisible: (tab) => visible.has(tab),
    preview: () => preview,
    onChange: (persist) => changes.push(persist),
    onAlert: (a) => alerts.push(a),
    log: (msg) => logs.push(msg)
  })
  store.add(rec)
  // событие хука с текущим временем
  const hook = (p: Partial<HookEvent>): HookEvent => ({
    tab: rec.id,
    event: 'Stop',
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
  // процесс вкладки запущен
  const start = () => {
    store.apply(rec.id, { type: 'spawned' })
    store.setAlive(rec.id, true)
  }
  const status = () => store.get(rec.id)?.status
  const tick = (ms: number) => {
    now += ms
  }
  const setPreview = (v: boolean) => {
    preview = v
  }
  return { store, alerts, changes, logs, visible, hook, start, status, tick, setPreview }
}

describe('SessionStore', () => {
  it('новая вкладка спит; kind и claudeSessionId берутся из машины статусов', () => {
    const { store, changes, hook, start, status } = setup()
    expect(store.get('t1')).toEqual({ ...REC, status: 'sleeping', statusSince: 1000, alive: false, note: null })
    expect(changes).toEqual([true])
    start()
    expect(status()).toBe('starting')
    store.hook(hook({ event: 'SessionStart', source: 'startup', sessionId: 'sess-2' }))
    expect(status()).toBe('idle')
    expect(store.records()).toEqual([{ ...REC, claudeSessionId: 'sess-2' }])
  })

  it('уведомление при переходе и только для невидимой вкладки', () => {
    const { store, alerts, visible, hook, start, status, tick } = setup()
    start()
    store.hook(
      hook({ event: 'Notification', notificationType: 'permission_prompt', message: 'Claude needs your permission to use Bash' })
    )
    expect(alerts).toEqual([
      { tab: 't1', kind: 'waiting', title: 'MyWebShop · ждёт разрешения', body: 'Claude needs your permission to use Bash' }
    ])
    // тот же статус ещё раз — без уведомления
    tick(10)
    store.hook(hook({ event: 'Notification', notificationType: 'permission_prompt', message: 'ещё раз' }))
    expect(alerts).toHaveLength(1)
    store.input('t1', 'y')
    expect(status()).toBe('working')
    // вкладка на экране: статус меняется, уведомления нет
    visible.add('t1')
    tick(10)
    store.hook(hook({ event: 'Notification', notificationType: 'permission_prompt' }))
    expect(status()).toBe('waiting')
    store.apply('t1', { type: 'claude-exit', code: 1 })
    expect(status()).toBe('crashed')
    expect(alerts).toHaveLength(1)
  })

  it('готово и ждёт ответа: текст Claude в одну строку, без messagePreview общий текст', () => {
    const { store, alerts, hook, start, tick, setPreview } = setup()
    start()
    store.hook(hook({ event: 'Stop', lastAssistantMessage: 'Готово.\n\nТесты   проходят' }))
    expect(alerts[0]).toEqual({ tab: 't1', kind: 'done', title: 'MyWebShop · готово', body: 'Готово. Тесты проходят' })
    setPreview(false)
    tick(10)
    store.hook(hook({ event: 'Notification', notificationType: 'elicitation_dialog', message: 'Какой вариант?' }))
    expect(alerts[1]).toEqual({ tab: 't1', kind: 'waiting', title: 'MyWebShop · ждёт ответа', body: 'Claude ждёт вас' })
    tick(10)
    store.hook(hook({ event: 'UserPromptSubmit' }))
    tick(10)
    store.hook(hook({ event: 'Stop', lastAssistantMessage: 'личный текст' }))
    expect(alerts[2].body).toBe('Claude закончил работу')
    setPreview(true)
    tick(10)
    store.hook(hook({ event: 'UserPromptSubmit' }))
    tick(10)
    store.hook(hook({ event: 'Stop', lastAssistantMessage: 'x'.repeat(300) }))
    expect(alerts[3].body).toHaveLength(200)
    expect(alerts[3].body.endsWith('…')).toBe(true)
  })

  it('упала: текст зависит от причины', () => {
    const { store, alerts, start } = setup()
    start()
    store.apply('t1', { type: 'claude-exit', code: 1 })
    expect(alerts[0]).toEqual({ tab: 't1', kind: 'crashed', title: 'MyWebShop · упала', body: 'Claude завершился с кодом 1' })
    start()
    store.apply('t1', { type: 'process-exit', code: 5 })
    expect(alerts[1].body).toBe('Процесс завершён (код 5)')

    const shell = setup({ ...REC, kind: 'shell', claudeSessionId: null })
    shell.store.apply('t1', { type: 'spawn-failed' })
    expect(shell.alerts).toEqual([
      { tab: 't1', kind: 'crashed', title: 'MyWebShop · упала', body: 'Не удалось запустить вкладку' }
    ])
  })

  it('открытие вкладки снимает «готово»', () => {
    const { store, hook, start, status } = setup()
    start()
    store.hook(hook({ event: 'Stop' }))
    expect(status()).toBe('done')
    store.shown('t1')
    expect(status()).toBe('idle')
  })

  it('автоответ терминала не считается вводом', () => {
    const { store, hook, start, status } = setup()
    start()
    store.hook(hook({ event: 'Notification', notificationType: 'permission_prompt' }))
    // focus reporting, DA1, CPR
    for (const reply of ['\x1b[I', '\x1b[O', '\x1b[?1;2c', '\x1b[12;1R']) {
      expect(store.input('t1', reply)).toBe('write')
    }
    expect(status()).toBe('waiting')
    expect(store.input('t1', '1')).toBe('write')
    expect(status()).toBe('working')
    // claude упал, PowerShell жив: ответы уходят в оболочку, вкладка не становится консолью
    store.apply('t1', { type: 'claude-exit', code: 1 })
    for (const reply of ['\x1b[I', '\x1b[?1;2c']) expect(store.input('t1', reply)).toBe('write')
    expect(store.get('t1')).toMatchObject({ status: 'crashed', kind: 'claude' })
  })

  it('упавший claude: Enter — новый разговор, другая клавиша — консоль', () => {
    const { store, start, status } = setup()
    start()
    store.apply('t1', { type: 'claude-exit', code: 1 })
    store.setNote('t1', { text: 'Claude завершился с кодом 1. Enter — новый разговор, другая клавиша — консоль', actions: [] })
    expect(store.input('t1', '\r')).toBe('new-conversation')
    expect(status()).toBe('crashed')
    expect(store.input('t1', 'd')).toBe('write')
    expect(store.get('t1')).toMatchObject({ status: 'shell', kind: 'shell', note: null })
    expect(store.records()[0].kind).toBe('shell')
  })

  it('процесс завершён: Enter — перезапуск, остальное отбрасывается', () => {
    const { store, start } = setup({ ...REC, kind: 'shell', claudeSessionId: null })
    start()
    store.apply('t1', { type: 'process-exit', code: 0 })
    store.setAlive('t1', false)
    store.setNote('t1', { text: 'Процесс завершён (код 0). Enter — перезапустить', actions: [] })
    expect(store.input('t1', 'dir')).toBe('drop')
    expect(store.input('t1', '\x1b[I')).toBe('drop')
    expect(store.input('t1', '\r')).toBe('restart')
    expect(store.input('nope', '\r')).toBe('drop')
    start()
    expect(store.get('t1')).toMatchObject({ status: 'shell', alive: true, note: null })
  })

  it('тишина: working → idle без уведомления', () => {
    const { store, alerts, hook, start, status, tick } = setup()
    start()
    store.hook(hook({ event: 'UserPromptSubmit' }))
    store.checkSilence(() => null, 0)
    expect(status()).toBe('working')
    // вывод был до начала работы: отсчёт идёт от перехода в working
    let last = 500
    const lastOutputAt = () => last
    tick(3600)
    store.checkSilence(lastOutputAt, 4000)
    expect(status()).toBe('working')
    last = 4500
    tick(3899)
    store.checkSilence(lastOutputAt, 4000)
    expect(status()).toBe('working')
    tick(1)
    store.checkSilence(lastOutputAt, 4000)
    expect(status()).toBe('idle')
    expect(alerts).toEqual([])
  })

  it('rename, setCwd, setShell', () => {
    const { store } = setup()
    store.rename('t1', '  Мой \t проект\u0007 ')
    expect(store.get('t1')).toMatchObject({ title: 'Мой проект', customTitle: true })
    store.setCwd('t1', 'C:\\work\\Other')
    expect(store.get('t1')).toMatchObject({ title: 'Мой проект', cwd: 'C:\\work\\Other' })
    store.rename('t1', '   ')
    expect(store.get('t1')).toMatchObject({ title: 'Other', customTitle: false })
    store.setCwd('t1', 'D:\\proj\\Третий')
    expect(store.get('t1')?.title).toBe('Третий')
    store.rename('t1', 'x'.repeat(100))
    expect(store.get('t1')?.title).toHaveLength(60)
    store.setShell('t1', 'pwsh')
    expect(store.records()[0].shell).toBe('pwsh')
  })

  it('вложенный claude в живой вкладке: ни папки, ни уведомления, ни смены разговора', () => {
    const { store, alerts, hook, start, status } = setup()
    start()
    store.hook(hook({ event: 'SessionStart', source: 'startup', sessionId: 'sess-1' }))
    store.hook(hook({ event: 'UserPromptSubmit', sessionId: 'sess-1' }))
    expect(status()).toBe('working')
    // claude -p из Bash-инструмента или из хука пользователя получает T3000_TAB_ID этой вкладки
    store.hook(hook({ event: 'SessionStart', source: 'startup', sessionId: 'nested', cwd: 'C:\\tmp' }))
    store.hook(hook({ event: 'Stop', sessionId: 'nested', lastAssistantMessage: 'x' }))
    store.hook(hook({ event: 'SessionEnd', sessionId: 'nested', reason: 'other' }))
    expect(status()).toBe('working')
    expect(store.get('t1')?.cwd).toBe('C:\\work\\MyWebShop')
    expect(store.records()[0]).toMatchObject({ kind: 'claude', claudeSessionId: 'sess-1' })
    expect(alerts).toEqual([])
  })

  it('SessionStart главной сессии обновляет папку вкладки', () => {
    const { store, hook, start, tick } = setup()
    start()
    store.hook(hook({ event: 'SessionStart', cwd: 'C:\\work\\Other', sessionId: 's2' }))
    expect(store.get('t1')).toMatchObject({ cwd: 'C:\\work\\Other', title: 'Other' })
    // тот же путь в другом виде — не изменение
    store.hook(hook({ event: 'SessionStart', cwd: 'c:/work/other/' }))
    expect(store.get('t1')?.cwd).toBe('C:\\work\\Other')
    // сабагент, устаревшее событие и прочие хуки папку не меняют
    tick(10)
    store.hook(hook({ event: 'SessionStart', cwd: 'C:\\agent', isAgent: true }))
    store.hook(hook({ event: 'SessionStart', cwd: 'C:\\old', ts: 1 }))
    store.hook(hook({ event: 'PostToolUse', cwd: 'C:\\work\\Other\\src' }))
    expect(store.get('t1')?.cwd).toBe('C:\\work\\Other')
    store.rename('t1', 'Своё имя')
    store.hook(hook({ event: 'SessionStart', cwd: 'C:\\work\\Fourth' }))
    expect(store.get('t1')).toMatchObject({ cwd: 'C:\\work\\Fourth', title: 'Своё имя' })
  })

  it('хук неизвестной вкладки отклоняется', () => {
    const { store, hook } = setup()
    expect(store.hook(hook({ tab: 'nope' }))).toBe(false)
    expect(store.hook(hook({ event: 'SessionStart' }))).toBe(true)
  })

  it('onChange: persist только при изменении сохраняемых данных', () => {
    const { store, changes, hook, start, tick } = setup()
    changes.length = 0
    start()
    expect(changes).toEqual([false, false])
    store.hook(hook({ event: 'UserPromptSubmit', sessionId: 'sess-1' }))
    expect(changes).toEqual([false, false, false])
    // статус не изменился — renderer не нужно ничего слать
    tick(10)
    store.hook(hook({ event: 'PostToolUse' }))
    expect(changes).toHaveLength(3)
    store.hook(hook({ event: 'SessionStart', source: 'clear', sessionId: 'sess-9' }))
    expect(changes.at(-1)).toBe(true)
    store.rename('t1', 'Имя')
    expect(changes.at(-1)).toBe(true)
    expect(store.remove('t1')).toBe(true)
    expect(changes.at(-1)).toBe(true)
    expect(store.remove('t1')).toBe(false)
    expect(store.list()).toEqual([])
  })

  it('лог переходов без текста Claude', () => {
    const { store, logs, hook, start } = setup()
    start()
    store.hook(hook({ event: 'Notification', notificationType: 'permission_prompt', message: 'секретный текст' }))
    store.hook(hook({ event: 'Stop', lastAssistantMessage: 'секретный ответ' }))
    expect(logs).toEqual([
      'вкладка t1: sleeping → starting',
      'вкладка t1: starting → waiting',
      'вкладка t1: waiting → done'
    ])
  })
})
