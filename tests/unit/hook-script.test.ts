import { createRequire } from 'node:module'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { HookEvent } from '../../src/shared/types'

interface HookModule {
  run(env: Record<string, string | undefined>, stdin: NodeJS.ReadableStream & { isTTY?: boolean }): Promise<void>
  pick(input: unknown, tab: string): HookEvent | null
  readStdin(stdin: NodeJS.ReadableStream & { isTTY?: boolean }, timeoutMs: number): Promise<string>
}
const hook = createRequire(import.meta.url)('../../hooks/t3000-hook.js') as HookModule

describe('pick', () => {
  it('оставляет только нужные поля', () => {
    const ev = hook.pick(
      {
        hook_event_name: 'Notification',
        session_id: 's1',
        cwd: 'C:\\Work\\Проект',
        notification_type: 'permission_prompt',
        message: 'Claude needs your permission to use Bash',
        transcript_path: 'C:\\Users\\x\\.claude\\projects\\p\\s1.jsonl',
        tool_input: { command: 'secret' }
      },
      't1'
    )!
    expect(ev).toEqual({
      tab: 't1',
      event: 'Notification',
      sessionId: 's1',
      cwd: 'C:\\Work\\Проект',
      source: null,
      reason: null,
      notificationType: 'permission_prompt',
      message: 'Claude needs your permission to use Bash',
      lastAssistantMessage: null,
      isAgent: false,
      ts: expect.any(Number)
    })
    expect(Math.abs(ev.ts - Date.now())).toBeLessThan(5000)
  })

  it('обрезает last_assistant_message до 200 символов, message — до 2000', () => {
    const ev = hook.pick({ hook_event_name: 'Stop', last_assistant_message: 'я'.repeat(500), message: 'm'.repeat(5000) }, 't1')!
    expect(ev.lastAssistantMessage).toHaveLength(200)
    expect(ev.message).toHaveLength(2000)
  })

  it('isAgent — по непустому agent_id', () => {
    expect(hook.pick({ hook_event_name: 'Stop', agent_id: 'a1' }, 't')!.isAgent).toBe(true)
    expect(hook.pick({ hook_event_name: 'Stop', agent_id: '' }, 't')!.isAgent).toBe(false)
  })

  it('без hook_event_name или не объект → null', () => {
    expect(hook.pick({ session_id: 's' }, 't')).toBeNull()
    expect(hook.pick([1], 't')).toBeNull()
    expect(hook.pick(null, 't')).toBeNull()
  })
})

describe('readStdin', () => {
  it('TTY → пустая строка сразу', async () => {
    const tty = Object.assign(new PassThrough(), { isTTY: true })
    expect(await hook.readStdin(tty, 5000)).toBe('')
  })

  it('незакрытый stdin → через таймаут возвращает прочитанное', async () => {
    const s = new PassThrough()
    s.write('{"hook_event_name":')
    const t0 = Date.now()
    expect(await hook.readStdin(s, 200)).toBe('{"hook_event_name":')
    expect(Date.now() - t0).toBeGreaterThanOrEqual(150)
  })
})

describe('run', () => {
  it('без переменных T3000_* выходит сразу, не читая stdin', async () => {
    const s = new PassThrough()
    const t0 = Date.now()
    await hook.run({}, s)
    expect(Date.now() - t0).toBeLessThan(100)
  })
})
