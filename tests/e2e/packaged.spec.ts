import { _electron as electron, expect, test } from '@playwright/test'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { HookServer } from '../../src/main/hook-server'
import type { T3000Api } from '../../src/shared/ipc'
import type { HookEvent } from '../../src/shared/types'
import { makeDirs, ROOT, testEnv, writeTestConfig } from './helpers'

const EXE = join(ROOT, 'release', 'win-unpacked', 'Terminal3000.exe')

// Запускается после npm run dist: npx playwright test tests/e2e/packaged.spec.ts
test.skip(!existsSync(EXE), 'нет release/win-unpacked — сначала npm run dist')

test('собранное приложение: консоль, звук из resources', async () => {
  const dirs = makeDirs()
  writeTestConfig(dirs.data)
  const app = await electron.launch({ executablePath: EXE, args: [dirs.project], env: testEnv(dirs) })
  try {
    const page = await app.firstWindow()
    const screen = page.locator('.pane.active .xterm-screen')
    await expect(screen).toContainText('Проект>', { timeout: 30000 })
    await screen.click()
    await page.keyboard.type("Write-Output ('t3000-' + 'ok')")
    await page.keyboard.press('Enter')
    await expect(screen).toContainText('t3000-ok', { timeout: 30000 })
    // builtin:faceit читается из resources/sounds
    const bytes = await page.evaluate(async () => {
      const data = await (window as unknown as { t3000: T3000Api }).t3000.loadSound('waiting')
      return data?.byteLength ?? 0
    })
    expect(bytes).toBeGreaterThan(100_000)
  } finally {
    await app.close()
  }
})

test('собранное приложение: запасной хук Terminal3000.exe --t3000-hook', async () => {
  const dirs = makeDirs()
  const events: HookEvent[] = []
  const server = new HookServer({ token: 'tok', onEvent: (ev) => events.push(ev) })
  const port = await server.listen()
  try {
    const env = { ...testEnv(dirs), T3000_TAB_ID: 't_9', T3000_PORT: String(port), T3000_TOKEN: 'tok' }
    const code = await new Promise<number | null>((done, fail) => {
      const p = spawn(EXE, ['--t3000-hook'], { env, stdio: ['pipe', 'ignore', 'ignore'] })
      const timer = setTimeout(() => {
        p.kill()
        fail(new Error('хук не завершился за 20 с'))
      }, 20000)
      p.on('exit', (c) => {
        clearTimeout(timer)
        done(c)
      })
      p.stdin.end(JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's9' }))
    })
    expect(code).toBe(0)
    expect(events).toEqual([expect.objectContaining({ tab: 't_9', event: 'UserPromptSubmit', sessionId: 's9' })])
  } finally {
    await server.close()
  }
})
