import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HookEvent } from '../../src/shared/types'
import { HookServer, MAX_BODY, validateHookEvent } from '../../src/main/hook-server'

const TOKEN = 'a'.repeat(64)
const EVENT: HookEvent = {
  tab: 't1',
  event: 'Stop',
  sessionId: 's1',
  cwd: 'C:\\A',
  source: null,
  reason: null,
  notificationType: null,
  message: null,
  lastAssistantMessage: 'готово',
  isAgent: false,
  ts: 1000
}

describe('validateHookEvent', () => {
  it('нормализует: лишние поля отбрасываются, отсутствующие → null', () => {
    const partial: Record<string, unknown> = { ...EVENT, extra: 'x' }
    delete partial.source
    delete partial.reason
    expect(validateHookEvent(partial)).toEqual(EVENT)
  })

  it('отклоняет неверные события', () => {
    const bad: unknown[] = [
      null,
      [EVENT],
      { ...EVENT, tab: '' },
      { ...EVENT, tab: 'x'.repeat(65) },
      { ...EVENT, event: 5 },
      { ...EVENT, ts: Number.NaN },
      { ...EVENT, ts: '1000' },
      { ...EVENT, isAgent: 'false' },
      { ...EVENT, message: 'm'.repeat(2001) },
      { ...EVENT, cwd: 42 }
    ]
    for (const raw of bad) expect(validateHookEvent(raw), JSON.stringify(raw)).toBeNull()
  })
})

describe('HookServer', () => {
  let server: HookServer | null = null
  afterEach(async () => {
    await server?.close()
    server = null
  })

  async function start() {
    const onEvent = vi.fn()
    server = new HookServer({ token: TOKEN, onEvent })
    const port = await server.listen()
    const post = (body: string, headers: Record<string, string> = { 'x-t3000-token': TOKEN }, path = '/event') =>
      fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body })
    return { port, onEvent, post }
  }

  it('принимает событие: 204 и onEvent', async () => {
    const { onEvent, post } = await start()
    const res = await post(JSON.stringify(EVENT))
    expect(res.status).toBe(204)
    expect(onEvent).toHaveBeenCalledWith(EVENT)
  })

  it('неверный или отсутствующий токен → 401', async () => {
    const { onEvent, post } = await start()
    expect((await post(JSON.stringify(EVENT), { 'x-t3000-token': 'b'.repeat(64) })).status).toBe(401)
    expect((await post(JSON.stringify(EVENT), { 'x-t3000-token': 'short' })).status).toBe(401)
    expect((await post(JSON.stringify(EVENT), {})).status).toBe(401)
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('другой путь или метод → 404', async () => {
    const { port, post } = await start()
    expect((await post(JSON.stringify(EVENT), undefined, '/other')).status).toBe(404)
    expect((await fetch(`http://127.0.0.1:${port}/event`)).status).toBe(404)
  })

  it('слишком большое тело → 413', async () => {
    const { onEvent, post } = await start()
    const res = await post(JSON.stringify({ ...EVENT, message: 'm'.repeat(MAX_BODY) }))
    expect(res.status).toBe(413)
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('битый JSON и неверное событие → 400', async () => {
    const { onEvent, post } = await start()
    expect((await post('{"tab":')).status).toBe(400)
    expect((await post(JSON.stringify({ ...EVENT, ts: 'x' }))).status).toBe(400)
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('исключение в onEvent не роняет сервер', async () => {
    const onError = vi.fn()
    server = new HookServer({ token: TOKEN, onEvent: () => { throw new Error('boom') }, onError })
    const port = await server.listen()
    const res = await fetch(`http://127.0.0.1:${port}/event`, {
      method: 'POST',
      headers: { 'x-t3000-token': TOKEN },
      body: JSON.stringify(EVENT)
    })
    expect(res.status).toBe(204)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }))
  })
})
