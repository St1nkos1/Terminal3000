import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { HookEvent } from '../shared/types'

export const MAX_BODY = 16 * 1024
const MAX_TEXT = 2000
const OPTIONAL_TEXT = ['sessionId', 'cwd', 'source', 'reason', 'notificationType', 'message', 'lastAssistantMessage'] as const

const shortId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64

export function validateHookEvent(raw: unknown): HookEvent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (!shortId(o.tab) || !shortId(o.event)) return null
  if (typeof o.isAgent !== 'boolean' || typeof o.ts !== 'number' || !Number.isFinite(o.ts)) return null
  const text: Record<string, string | null> = {}
  for (const key of OPTIONAL_TEXT) {
    const v = o[key] ?? null
    if (v === null) {
      text[key] = null
      continue
    }
    if (typeof v !== 'string' || v.length > MAX_TEXT) return null
    text[key] = v
  }
  return {
    tab: o.tab,
    event: o.event,
    sessionId: text.sessionId,
    cwd: text.cwd,
    source: text.source,
    reason: text.reason,
    notificationType: text.notificationType,
    message: text.message,
    lastAssistantMessage: text.lastAssistantMessage,
    isAgent: o.isAgent,
    ts: o.ts
  }
}

export interface HookServerOptions {
  token: string
  onEvent: (ev: HookEvent) => void
  onError?: (err: unknown) => void
}

export class HookServer {
  private server: Server | null = null
  private readonly token: Buffer

  constructor(private readonly opts: HookServerOptions) {
    this.token = Buffer.from(opts.token, 'utf8')
  }

  async listen(): Promise<number> {
    let lastError: unknown = null
    for (let attempt = 0; attempt < 5; attempt++) {
      const server = createServer((req, res) => this.handle(req, res))
      server.requestTimeout = 5000
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject)
          server.listen(0, '127.0.0.1', () => {
            server.off('error', reject)
            resolve()
          })
        })
        this.server = server
        return (server.address() as AddressInfo).port
      } catch (e) {
        lastError = e
      }
    }
    throw lastError
  }

  close(): Promise<void> {
    const server = this.server
    this.server = null
    if (!server) return Promise.resolve()
    return new Promise((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
  }

  private tokenOk(header: string | string[] | undefined): boolean {
    if (typeof header !== 'string') return false
    const got = Buffer.from(header, 'utf8')
    return got.length === this.token.length && timingSafeEqual(got, this.token)
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    let replied = false
    const reply = (code: number) => {
      if (replied) return
      replied = true
      res.writeHead(code, { 'content-length': '0' })
      res.end()
    }
    req.on('error', () => reply(400))
    if (req.method !== 'POST' || req.url !== '/event') {
      req.resume()
      return reply(404)
    }
    if (!this.tokenOk(req.headers['x-t3000-token'])) {
      req.resume()
      return reply(401)
    }
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      if (replied) return // лишнее тело просто дочитывается и выбрасывается
      size += chunk.length
      if (size > MAX_BODY) return reply(413)
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (replied) return
      let raw: unknown
      try {
        raw = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return reply(400)
      }
      const ev = validateHookEvent(raw)
      if (!ev) return reply(400)
      reply(204)
      try {
        this.opts.onEvent(ev)
      } catch (e) {
        this.opts.onError?.(e)
      }
    })
  }
}
