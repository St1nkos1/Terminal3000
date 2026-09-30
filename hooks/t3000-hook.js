'use strict'
// Хук Claude Code для Terminal3000. Только Node, без зависимостей.
// Ничего не пишет в stdout и всегда завершается с кодом 0, чтобы не мешать Claude.
const http = require('node:http')

const STDIN_TIMEOUT_MS = 1000
const STDIN_MAX_BYTES = 8 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 1000

function str(v, max) {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null
}

function pick(input, tab) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const event = str(input.hook_event_name, 64)
  if (!event) return null
  return {
    tab,
    event,
    sessionId: str(input.session_id, 200),
    cwd: str(input.cwd, 2000),
    source: str(input.source, 64),
    reason: str(input.reason, 64),
    notificationType: str(input.notification_type, 64),
    message: str(input.message, 2000),
    lastAssistantMessage: str(input.last_assistant_message, 200),
    isAgent: typeof input.agent_id === 'string' && input.agent_id.length > 0,
    ts: Date.now()
  }
}

function readStdin(stdin, timeoutMs) {
  return new Promise((resolve) => {
    if (!stdin || stdin.isTTY) return resolve('')
    const chunks = []
    let size = 0
    const finish = () => {
      clearTimeout(timer)
      stdin.removeListener('data', onData)
      stdin.removeListener('end', finish)
      stdin.removeListener('error', finish)
      if (typeof stdin.pause === 'function') stdin.pause()
      resolve(Buffer.concat(chunks).toString('utf8'))
    }
    const onData = (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8')
      size += buf.length
      if (size > STDIN_MAX_BYTES) return finish()
      chunks.push(buf)
    }
    const timer = setTimeout(finish, timeoutMs)
    stdin.on('data', onData)
    stdin.once('end', finish)
    stdin.once('error', finish)
  })
}

function send(port, token, body, timeoutMs) {
  return new Promise((resolve) => {
    const data = Buffer.from(JSON.stringify(body), 'utf8')
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/event',
      method: 'POST',
      agent: false,
      headers: { 'content-type': 'application/json', 'content-length': data.length, 'x-t3000-token': token }
    })
    const timer = setTimeout(() => req.destroy(), timeoutMs)
    req.on('response', (res) => res.resume())
    req.on('error', () => undefined) // отказ в соединении, таймаут: итог всё равно в 'close'
    req.on('close', () => {
      clearTimeout(timer)
      resolve()
    })
    req.end(data)
  })
}

async function run(env = process.env, stdin = process.stdin) {
  try {
    const tab = env.T3000_TAB_ID
    const token = env.T3000_TOKEN
    const port = Number(env.T3000_PORT)
    // Claude запущен вне Terminal3000
    if (!tab || !token || !Number.isInteger(port) || port <= 0 || port > 65535) return
    const text = await readStdin(stdin, STDIN_TIMEOUT_MS)
    let input = null
    try {
      input = JSON.parse(text)
    } catch {
      // пустой или обрезанный ввод: отправлять нечего
    }
    const body = pick(input, tab.slice(0, 64))
    if (body) await send(port, token, body, REQUEST_TIMEOUT_MS)
  } catch {
    // любая ошибка проглатывается
  }
}

module.exports = { run, pick, readStdin }

if (require.main === module) run().finally(() => process.exit(0))
