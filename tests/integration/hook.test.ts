import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HookServer } from '../../src/main/hook-server'

const SCRIPT = fileURLToPath(new URL('../../hooks/t3000-hook.js', import.meta.url))
const TOKEN = 'c'.repeat(64)
const INPUT = JSON.stringify({ hook_event_name: 'Stop', session_id: 's1', last_assistant_message: 'готово' })

// Переменные T3000_* убираются: тесты могут запускаться внутри самого Terminal3000
const BASE_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith('T3000_')))

interface HookRun {
  code: number | null
  ms: number
  stdout: string
}

function runHook(env: Record<string, string>, stdin: { data: string; keepOpen?: boolean }): Promise<HookRun> {
  return new Promise((done, fail) => {
    const t0 = Date.now()
    const child = spawn(process.execPath, [SCRIPT], { env: { ...BASE_ENV, ...env }, stdio: ['pipe', 'pipe', 'ignore'] })
    let stdout = ''
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString()))
    const killer = setTimeout(() => child.kill(), 5000)
    child.on('error', fail)
    child.on('exit', (code) => {
      clearTimeout(killer)
      done({ code, ms: Date.now() - t0, stdout })
    })
    child.stdin.on('error', () => undefined) // процесс мог выйти раньше, чем мы записали
    if (stdin.keepOpen) child.stdin.write(stdin.data)
    else child.stdin.end(stdin.data)
  })
}

describe('t3000-hook.js + HookServer', () => {
  let server: HookServer | null = null
  afterEach(async () => {
    await server?.close()
    server = null
  })

  async function start() {
    const onEvent = vi.fn()
    server = new HookServer({ token: TOKEN, onEvent })
    const port = await server.listen()
    return { port, onEvent, env: { T3000_TAB_ID: 'tab-1', T3000_PORT: String(port), T3000_TOKEN: TOKEN } }
  }

  it('корректное событие доходит до сервера', async () => {
    const { onEvent, env } = await start()
    const r = await runHook(env, { data: INPUT })
    expect(r).toMatchObject({ code: 0, stdout: '' })
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent.mock.calls[0][0]).toMatchObject({
      tab: 'tab-1',
      event: 'Stop',
      sessionId: 's1',
      lastAssistantMessage: 'готово',
      isAgent: false
    })
  })

  it('неверный токен отклоняется', async () => {
    const { onEvent, env } = await start()
    const r = await runHook({ ...env, T3000_TOKEN: 'd'.repeat(64) }, { data: INPUT })
    expect(r).toMatchObject({ code: 0, stdout: '' })
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('без T3000_TAB_ID выходит сразу и ничего не отправляет, даже если stdin не закрыт', async () => {
    const { onEvent, env } = await start()
    const rest: Record<string, string> = { ...env }
    delete rest.T3000_TAB_ID
    const r = await runHook(rest, { data: INPUT, keepOpen: true })
    expect(r).toMatchObject({ code: 0, stdout: '' })
    expect(r.ms).toBeLessThan(900)
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('сервер недоступен → код 0 меньше чем за 1,5 с', async () => {
    const { env } = await start()
    await server!.close()
    server = null
    const r = await runHook(env, { data: INPUT })
    expect(r).toMatchObject({ code: 0, stdout: '' })
    expect(r.ms).toBeLessThan(1500)
  })

  it('stdin не закрыт → через секунду отправляет прочитанное', async () => {
    const { onEvent, env } = await start()
    const r = await runHook(env, { data: INPUT, keepOpen: true })
    expect(r).toMatchObject({ code: 0, stdout: '' })
    expect(r.ms).toBeGreaterThanOrEqual(900)
    expect(r.ms).toBeLessThan(2500)
    expect(onEvent).toHaveBeenCalledTimes(1)
  })
})
