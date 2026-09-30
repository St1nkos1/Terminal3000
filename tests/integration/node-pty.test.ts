import { describe, expect, it } from 'vitest'
import * as pty from 'node-pty'

describe('node-pty', () => {
  it.runIf(process.platform === 'win32')('запускает cmd.exe через ConPTY и отдаёт вывод', async () => {
    const p = pty.spawn('cmd.exe', ['/c', 'echo pty-ok'], {
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      useConptyDll: true
    })
    let out = ''
    p.onData((d) => {
      out += d
    })
    const code = await new Promise<number>((resolve) => p.onExit((e) => resolve(e.exitCode)))
    // последний чанк вывода на Windows может прийти чуть позже onExit
    await new Promise((r) => setTimeout(r, 200))
    try {
      p.kill()
    } catch {
      // процесс уже завершён
    }
    expect(out).toContain('pty-ok')
    expect(code).toBe(0)
  })
})
