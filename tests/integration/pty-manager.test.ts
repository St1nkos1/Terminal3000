import { describe, expect, it } from 'vitest'
import { claudeScript, type SpawnSpec } from '../../src/main/launch'
import { PtyManager } from '../../src/main/pty-manager'

function env(): Record<string, string> {
  const e: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) e[k] = v
  return e
}

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`процесс не завершился за ${ms} мс`)), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

async function run(file: string, args: string[]) {
  let out = ''
  const claudeExits: number[] = []
  let done: (code: number) => void = () => undefined
  const exited = new Promise<number>((resolve) => {
    done = resolve
  })
  const mgr = new PtyManager({
    onData: (_tab, _seq, data) => {
      out += data
    },
    onExit: (_tab, code) => done(code),
    onClaudeExit: (_tab, code) => {
      claudeExits.push(code)
    }
  })
  const spec: SpawnSpec = { file, args, cwd: process.cwd(), env: env() }
  try {
    mgr.spawn('t', spec)
    const code = await within(exited, 15000)
    // последний чанк на Windows может прийти после onExit
    await new Promise((r) => setTimeout(r, 300))
    return { code, out, claudeExits }
  } finally {
    // без явного kill зависший процесс не даёт воркеру vitest завершиться
    mgr.killAll()
  }
}

describe.runIf(process.platform === 'win32')('PtyManager + node-pty', () => {
  it('вывод и код выхода настоящего процесса', async () => {
    const r = await run('cmd.exe', ['/c', 'echo pty-manager-ok'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('pty-manager-ok')
  }, 20000)

  it('обёртка claude сообщает код выхода через ConPTY', async () => {
    const script = claudeScript('cmd /c exit 3', 'new', null)
    const r = await run('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', script])
    expect(r.claudeExits).toEqual([3])
  }, 20000)

  it('claude не найден → код 1, даже если до этого $LASTEXITCODE был 0', async () => {
    // cmd /c exit 0 изображает профиль, который запускал внешние программы
    const script = `cmd /c exit 0; ${claudeScript('t3000-no-such-command', 'new', null)}`
    const r = await run('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', script])
    expect(r.claudeExits).toEqual([1])
  }, 20000)
})
