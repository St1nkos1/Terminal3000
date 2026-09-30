import type { HookEvent, TabKind, TabStatus } from '../shared/types'

export interface MachineState {
  kind: TabKind
  status: TabStatus
  since: number
  claudeSessionId: string | null
  // время последнего принятого события; хуки старше отбрасываются
  lastTs: number
}

export type MachineEvent =
  | { type: 'spawned' }
  | { type: 'spawn-failed' }
  | { type: 'hook'; hook: HookEvent; visible: boolean }
  | { type: 'claude-exit'; code: number }
  | { type: 'process-exit'; code: number }
  | { type: 'shown' }
  | { type: 'input' }
  | { type: 'silence' }
  | { type: 'use-console' }

const WAITING = new Set(['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input'])
const RESUMED = new Set(['elicitation_response', 'elicitation_complete'])

export function initialState(kind: TabKind, claudeSessionId: string | null, now: number): MachineState {
  return { kind, status: 'sleeping', since: now, claudeSessionId, lastTs: 0 }
}

function patch(s: MachineState, now: number, next: Partial<MachineState>): MachineState {
  const keys = Object.keys(next) as (keyof MachineState)[]
  if (keys.every((k) => s[k] === next[k])) return s
  const r = { ...s, ...next }
  r.since = r.status === s.status ? s.since : now
  return r
}

export function step(s: MachineState, e: MachineEvent, now: number): MachineState {
  switch (e.type) {
    case 'spawned':
      return patch(s, now, { status: s.kind === 'claude' ? 'starting' : 'shell', lastTs: now })
    case 'spawn-failed':
      return patch(s, now, { status: 'crashed' })
    case 'claude-exit':
      return e.code === 0
        ? patch(s, now, { status: 'shell', kind: 'shell', lastTs: now })
        : patch(s, now, { status: 'crashed', kind: 'claude', lastTs: now })
    case 'process-exit':
      return patch(s, now, { status: s.kind === 'shell' ? 'shell' : 'crashed', lastTs: now })
    case 'shown':
      return s.status === 'done' ? patch(s, now, { status: 'idle' }) : s
    case 'input':
      return s.status === 'waiting' ? patch(s, now, { status: 'working' }) : s
    case 'silence':
      return s.status === 'working' ? patch(s, now, { status: 'idle' }) : s
    case 'use-console':
      return patch(s, now, { status: 'shell', kind: 'shell', lastTs: now })
    case 'hook':
      return onHook(s, e.hook, e.visible, now)
  }
}

function onHook(s: MachineState, h: HookEvent, visible: boolean, now: number): MachineState {
  if (h.ts < s.lastTs) return s
  const next: Partial<MachineState> = { lastTs: h.ts }
  if (!h.isAgent) {
    next.kind = 'claude'
    if (h.sessionId) next.claudeSessionId = h.sessionId
  }
  switch (h.event) {
    case 'SessionStart':
      if (!h.isAgent && h.source !== 'compact') next.status = 'idle'
      break
    case 'UserPromptSubmit':
    case 'PostToolUse':
      next.status = 'working'
      break
    case 'Notification': {
      const t = h.notificationType ?? ''
      if (WAITING.has(t)) next.status = 'waiting'
      else if (RESUMED.has(t)) next.status = 'working'
      else if (t === 'idle_prompt' && s.status === 'working') next.status = 'idle'
      break
    }
    case 'Stop':
      if (!h.isAgent) next.status = visible ? 'idle' : 'done'
      break
    case 'SessionEnd':
      if (!h.isAgent && h.reason !== 'clear') {
        next.status = 'shell'
        next.kind = 'shell'
      }
      break
  }
  return patch(s, now, next)
}

// Ответы терминала на запросы программы: фокус, DA, CPR, DSR, DECRQM, размер окна, OSC-цвета, XTVERSION
// eslint-disable-next-line no-control-regex
const TERMINAL_REPLY = /\x1b\[(?:[IO]|\??[\d;]*[cRn]|>[\d;]*c|\?[\d;]*(?:\$y|u)|[\d;]*t)|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1bP[^\x1b]*\x1b\\/g

export function isUserInput(data: string): boolean {
  return data.replace(TERMINAL_REPLY, '').length > 0
}
