import { describe, expect, it } from 'vitest'
import type { HookEvent } from '../../src/shared/types'
import { initialState, isUserInput, step, type MachineState } from '../../src/main/status-machine'

function hook(event: string, extra: Partial<HookEvent> = {}): HookEvent {
  return {
    tab: 't1',
    event,
    sessionId: 'sess-1',
    cwd: 'C:/p',
    source: null,
    reason: null,
    notificationType: null,
    message: null,
    lastAssistantMessage: null,
    isAgent: false,
    ts: 100,
    ...extra
  }
}

function claudeAt(status: MachineState['status']): MachineState {
  return { kind: 'claude', status, since: 10, claudeSessionId: 'sess-1', lastTs: 50 }
}

const h = (s: MachineState, ev: HookEvent, visible = false) => step(s, { type: 'hook', hook: ev, visible }, 200)

describe('step: процесс', () => {
  it('начальное состояние — спит', () => {
    expect(initialState('claude', 'x', 5)).toEqual({
      kind: 'claude',
      status: 'sleeping',
      since: 5,
      claudeSessionId: 'x',
      lastTs: 0
    })
  })

  it('spawned: claude → запуск, shell → консоль', () => {
    const c = step(initialState('claude', null, 0), { type: 'spawned' }, 7)
    expect(c).toMatchObject({ status: 'starting', since: 7, lastTs: 7 })
    expect(step(initialState('shell', null, 0), { type: 'spawned' }, 7).status).toBe('shell')
  })

  it('spawn-failed → упала', () => {
    expect(step(initialState('claude', null, 0), { type: 'spawn-failed' }, 7).status).toBe('crashed')
  })

  it('claude-exit 0 превращает вкладку в консоль', () => {
    expect(step(claudeAt('idle'), { type: 'claude-exit', code: 0 }, 300)).toMatchObject({
      status: 'shell',
      kind: 'shell',
      lastTs: 300
    })
  })

  it('claude-exit ≠0 → упала, вид остаётся claude', () => {
    const s = { ...claudeAt('shell'), kind: 'shell' as const }
    expect(step(s, { type: 'claude-exit', code: 3 }, 300)).toMatchObject({ status: 'crashed', kind: 'claude' })
  })

  it('process-exit: консоль остаётся консолью, claude падает', () => {
    const shell: MachineState = { ...claudeAt('shell'), kind: 'shell' }
    expect(step(shell, { type: 'process-exit', code: 0 }, 300).status).toBe('shell')
    expect(step(claudeAt('working'), { type: 'process-exit', code: 1 }, 300).status).toBe('crashed')
  })

  it('shown снимает «готово», input снимает «ждёт», silence снимает «работает»', () => {
    expect(step(claudeAt('done'), { type: 'shown' }, 300).status).toBe('idle')
    expect(step(claudeAt('waiting'), { type: 'input' }, 300).status).toBe('working')
    expect(step(claudeAt('working'), { type: 'silence' }, 300).status).toBe('idle')
  })

  it('без изменений возвращает тот же объект', () => {
    const s = claudeAt('idle')
    expect(step(s, { type: 'shown' }, 300)).toBe(s)
    expect(step(s, { type: 'input' }, 300)).toBe(s)
    expect(step(s, { type: 'silence' }, 300)).toBe(s)
  })

  it('since меняется только при смене статуса', () => {
    const s = step(claudeAt('working'), { type: 'hook', hook: hook('PostToolUse'), visible: false }, 300)
    expect(s.since).toBe(10)
    expect(step(s, { type: 'silence' }, 400).since).toBe(400)
  })

  it('use-console → консоль', () => {
    expect(step(claudeAt('crashed'), { type: 'use-console' }, 300)).toMatchObject({ status: 'shell', kind: 'shell' })
  })
})

describe('step: хуки', () => {
  it('SessionStart → свободна, запоминает id разговора', () => {
    const s = h(claudeAt('starting'), hook('SessionStart', { sessionId: 'new-id', source: 'startup' }))
    expect(s).toMatchObject({ status: 'idle', claudeSessionId: 'new-id', lastTs: 100 })
  })

  it('SessionStart после сжатия не сбрасывает «работает»', () => {
    expect(h(claudeAt('working'), hook('SessionStart', { source: 'compact' })).status).toBe('working')
  })

  it('claude, запущенный вручную в консоли, делает вкладку claude', () => {
    const shell: MachineState = { kind: 'shell', status: 'shell', since: 0, claudeSessionId: null, lastTs: 0 }
    expect(h(shell, hook('SessionStart', { source: 'startup' }))).toMatchObject({ kind: 'claude', status: 'idle' })
  })

  it('UserPromptSubmit и PostToolUse → работает', () => {
    expect(h(claudeAt('idle'), hook('UserPromptSubmit')).status).toBe('working')
    expect(h(claudeAt('waiting'), hook('PostToolUse')).status).toBe('working')
  })

  it('Notification: запросы → ждёт, ответы → работает', () => {
    for (const t of ['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input']) {
      expect(h(claudeAt('working'), hook('Notification', { notificationType: t })).status).toBe('waiting')
    }
    for (const t of ['elicitation_response', 'elicitation_complete']) {
      expect(h(claudeAt('waiting'), hook('Notification', { notificationType: t })).status).toBe('working')
    }
    expect(h(claudeAt('working'), hook('Notification', { notificationType: 'auth_success' })).status).toBe('working')
  })

  it('idle_prompt снимает только «работает»', () => {
    const idle = hook('Notification', { notificationType: 'idle_prompt' })
    expect(h(claudeAt('working'), idle).status).toBe('idle')
    expect(h(claudeAt('waiting'), idle).status).toBe('waiting')
    expect(h(claudeAt('done'), idle).status).toBe('done')
  })

  it('Stop: видимая → свободна, скрытая → готово', () => {
    expect(h(claudeAt('working'), hook('Stop'), true).status).toBe('idle')
    expect(h(claudeAt('working'), hook('Stop'), false).status).toBe('done')
  })

  it('SessionEnd: /clear не трогает, выход делает консолью', () => {
    expect(h(claudeAt('idle'), hook('SessionEnd', { reason: 'clear' }))).toMatchObject({ status: 'idle', kind: 'claude' })
    expect(h(claudeAt('idle'), hook('SessionEnd', { reason: 'prompt_input_exit' }))).toMatchObject({
      status: 'shell',
      kind: 'shell'
    })
  })

  it('старые события отбрасываются', () => {
    const s = claudeAt('idle')
    expect(h(s, hook('UserPromptSubmit', { ts: 49 }))).toBe(s)
    const restarted = step(s, { type: 'spawned' }, 1000)
    expect(h(restarted, hook('Stop', { ts: 999 }))).toBe(restarted)
  })

  it('событие после выхода claude не воскрешает вкладку', () => {
    const exited = step(claudeAt('idle'), { type: 'claude-exit', code: 0 }, 1000)
    expect(h(exited, hook('Stop', { ts: 990 }))).toBe(exited)
  })

  it('события агентов: не трогают id и вид, разрешение всё равно ждёт', () => {
    const s = claudeAt('working')
    expect(h(s, hook('PostToolUse', { isAgent: true, sessionId: 'agent-sess' })).claudeSessionId).toBe('sess-1')
    expect(h(s, hook('Stop', { isAgent: true })).status).toBe('working')
    expect(h(s, hook('Notification', { isAgent: true, notificationType: 'permission_prompt' })).status).toBe(
      'waiting'
    )
  })
})

describe('isUserInput', () => {
  it('автоответы терминала — не ввод', () => {
    for (const reply of [
      '\x1b[I',
      '\x1b[O',
      '\x1b[?1;2c',
      '\x1b[>0;276;0c',
      '\x1b[12;1R',
      '\x1b[0n',
      '\x1b[?2026;2$y',
      '\x1b[8;30;120t',
      '\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\',
      '\x1b]10;rgb:ffff/ffff/ffff\x07',
      '\x1bP>|xterm.js(6.0.0)\x1b\\',
      '\x1b[I\x1b[?1;2c'
    ]) {
      expect(isUserInput(reply), JSON.stringify(reply)).toBe(false)
    }
  })

  it('клавиши и текст — ввод', () => {
    for (const key of ['a', '\r', '\x1b', '\x1b[A', '\x1b[1;5C', '\x1b[3~', '\x1b[I\r', 'привет']) {
      expect(isUserInput(key), JSON.stringify(key)).toBe(true)
    }
  })
})
