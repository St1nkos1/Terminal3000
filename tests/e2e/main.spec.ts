import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { HookServer } from '../../src/main/hook-server'
import type { T3000Api } from '../../src/shared/ipc'
import type { HookEvent } from '../../src/shared/types'
import { launchApp, makeDirs, ROOT, runHookMode, testEnv, writeTestConfig } from './helpers'

const API_KEYS = [
  'attach',
  'closeTab',
  'createTab',
  'dismissWelcome',
  'getInit',
  'input',
  'installHooks',
  'listProjects',
  'loadSound',
  'onConfig',
  'onFocusTab',
  'onPlaySound',
  'onPtyData',
  'onState',
  'openConfig',
  'openExternal',
  'pathForFile',
  'pickFolder',
  'readClipboard',
  'renameTab',
  'resize',
  'setBadge',
  'setTabCwd',
  'startTab',
  'toggleDoNotDisturb',
  'uninstallHooks',
  'updateView',
  'writeClipboard'
]

type Win = { t3000: T3000Api }

async function tabsOf(page: Page) {
  return page.evaluate(async () => {
    const init = await (window as unknown as Win).t3000.getInit()
    return { tabs: init.state.tabs.map((t) => ({ id: t.id, cwd: t.cwd, kind: t.kind, alive: t.alive })), view: init.view }
  })
}

test('окно открывается, наружу только window.t3000, конфиг создан', async () => {
  const dirs = makeDirs()
  const app = await launchApp(dirs)
  try {
    const page = await app.firstWindow()
    await expect(page).toHaveTitle('Terminal3000')
    await expect(page.locator('.app')).toBeVisible()
    const r = await page.evaluate(async () => {
      const w = window as unknown as Record<string, unknown> & Win
      const init = await w.t3000.getInit()
      return {
        require: typeof w.require,
        process: typeof w.process,
        keys: Object.keys(w.t3000).sort(),
        tabs: init.state.tabs.length,
        firstRun: init.state.firstRun,
        shell: init.config.defaultShell
      }
    })
    expect(r).toEqual({ require: 'undefined', process: 'undefined', keys: API_KEYS, tabs: 0, firstRun: true, shell: 'powershell' })
    expect(existsSync(join(dirs.data, 'config.json'))).toBe(true)
    // хуки сами не ставятся: settings.json не создан
    expect(existsSync(join(dirs.claude, 'settings.json'))).toBe(false)
  } finally {
    await app.close()
  }
})

test('консоль через IPC: вывод приходит, после перезапуска вкладка восстановлена', async () => {
  const dirs = makeDirs()
  writeTestConfig(dirs.data)
  let app = await launchApp(dirs)
  let id: string | null
  try {
    const page = await app.firstWindow()
    id = await page.evaluate(async (cwd) => {
      const api = (window as unknown as Win).t3000
      let text = ''
      const got = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('нет вывода за 30 с')), 30000)
        api.onPtyData((_tab, _seq, data) => {
          text += data
          if (text.includes('t3000-ok')) {
            clearTimeout(timer)
            resolve()
          }
        })
      })
      const tab = await api.createTab({ cwd, kind: 'shell' })
      // в самой команде нет строки t3000-ok, она появится только в выводе
      if (tab) api.input(tab, "Write-Output ('t3000-' + 'ok')\r")
      await got
      return tab
    }, dirs.project)
    expect(id).toMatch(/^t_[0-9a-f]{8}$/)
  } finally {
    await app.close()
  }

  const saved = JSON.parse(readFileSync(join(dirs.data, 'workspace.json'), 'utf8'))
  expect(saved.tabs).toEqual([expect.objectContaining({ id, cwd: dirs.project, kind: 'shell', shell: 'powershell' })])
  expect(saved.activeTab).toBe(id)

  app = await launchApp(dirs)
  try {
    const page = await app.firstWindow()
    // активная вкладка при restore: lazy стартует сразу
    const r = await tabsOf(page)
    expect(r.tabs).toEqual([{ id, cwd: dirs.project, kind: 'shell', alive: true }])
    expect(r.view.activeTab).toBe(id)
  } finally {
    await app.close()
  }
})

test('папка из командной строки открывает в ней консоль', async () => {
  const dirs = makeDirs()
  writeTestConfig(dirs.data)
  const app = await launchApp(dirs, [dirs.project])
  try {
    const page = await app.firstWindow()
    const r = await tabsOf(page)
    expect(r.tabs).toEqual([expect.objectContaining({ cwd: dirs.project, kind: 'shell' })])
    expect(r.view.activeTab).toBe(r.tabs[0].id)
    expect(r.view.layout).toEqual({ type: 'pane', tab: r.tabs[0].id })
  } finally {
    await app.close()
  }
})

test('правый клик по группе: меню у курсора, новый сеанс в той же папке', async () => {
  const dirs = makeDirs()
  writeTestConfig(dirs.data)
  const app = await launchApp(dirs, [dirs.project])
  try {
    const page = await app.firstWindow()
    const head = page.locator('.group-head')
    const menu = page.locator('.context-menu')
    await head.click({ button: 'right' })
    await expect(menu).toBeVisible()
    // разговоров в папке нет: продолжение и выбор видны, но недоступны; свои оболочки дополняют стандартные
    await expect(menu.locator('.menu-item')).toHaveText([
      'Claude: новый разговор',
      'Claude: продолжить последний',
      'Claude: выбрать разговор…',
      'Консоль: powershell',
      'Консоль: cmd',
      'Консоль: gitbash'
    ])
    await expect(menu.locator('.menu-item.disabled')).toHaveCount(2)
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)

    await head.click({ button: 'right' })
    await menu.getByText('Консоль: powershell').click()
    await expect(menu).toHaveCount(0)
    await expect.poll(async () => (await tabsOf(page)).tabs.length).toBe(2)
    const r = await tabsOf(page)
    expect(r.tabs.map((t) => [t.cwd, t.kind])).toEqual([
      [dirs.project, 'shell'],
      [dirs.project, 'shell']
    ])
    expect(r.view.activeTab).toBe(r.tabs[1].id)
    await expect(page.locator('.group')).toHaveCount(1)
    await expect(page.locator('.group .tab-row')).toHaveCount(2)

    // с клавиатуры: стрелка вниз перескакивает недоступные пункты
    await head.click({ button: 'right' })
    await page.keyboard.press('ArrowDown')
    await expect(menu.locator('.menu-item.current')).toHaveText('Claude: новый разговор')
    await page.keyboard.press('ArrowDown')
    await expect(menu.locator('.menu-item.current')).toHaveText('Консоль: powershell')
    await page.keyboard.press('Enter')
    await expect(menu).toHaveCount(0)
    await expect.poll(async () => (await tabsOf(page)).tabs.length).toBe(3)
    expect((await tabsOf(page)).tabs[2]).toMatchObject({ cwd: dirs.project, kind: 'shell' })
  } finally {
    await app.close()
  }
})

test('Claude встаёт на экран с консолью своего проекта снизу', async () => {
  const dirs = makeDirs()
  const base = dirname(dirs.project)
  const second = join(base, 'Второй')
  mkdirSync(second)
  // вместо Claude — долгая команда: вкладка остаётся Claude-вкладкой
  writeTestConfig(dirs.data, { claudeCommand: 'Start-Sleep -Seconds 600', projectRoots: [base] })
  const app = await launchApp(dirs, [dirs.project])
  const col = (a: string, b: string) => ({
    type: 'split',
    dir: 'column',
    sizes: [0.5, 0.5],
    children: [
      { type: 'pane', tab: a },
      { type: 'pane', tab: b }
    ]
  })
  try {
    const page = await app.firstWindow()
    const shell1 = (await tabsOf(page)).tabs[0].id

    // консоль у проекта уже есть — встаёт под новым Claude
    await page.locator('.group-head').click({ button: 'right' })
    await page.locator('.context-menu').getByText('Claude: новый разговор').click()
    await expect.poll(async () => (await tabsOf(page)).tabs.length).toBe(2)
    const claude1 = (await tabsOf(page)).tabs[1]
    expect(claude1).toMatchObject({ cwd: dirs.project, kind: 'claude' })
    await expect.poll(async () => (await tabsOf(page)).view.layout).toEqual(col(claude1.id, shell1))

    // в папке без консоли: консоль создаётся и встаёт под Claude вместо чужой
    await page.keyboard.press('Control+Shift+T')
    await page.locator('.palette-input').fill('Второй')
    await expect(page.locator('.palette-item.current')).toContainText('Второй')
    await page.keyboard.press('Enter')
    await expect(page.locator('.palette-item.current')).toContainText('Claude: новый разговор')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await tabsOf(page)).tabs.length).toBe(4)
    const r = await tabsOf(page)
    const claude2 = r.tabs.find((t) => t.cwd === second && t.kind === 'claude')
    const shell2 = r.tabs.find((t) => t.cwd === second && t.kind === 'shell')
    expect(claude2 && shell2).toBeTruthy()
    await expect.poll(async () => (await tabsOf(page)).view.layout).toEqual(col(claude2!.id, shell2!.id))
    expect((await tabsOf(page)).view.activeTab).toBe(claude2!.id)

    // обратно к первому Claude — возвращается его пара
    await page.locator('.tab-row', { hasText: 'claude' }).first().click()
    await expect.poll(async () => (await tabsOf(page)).view.layout).toEqual(col(claude1.id, shell1))
  } finally {
    await app.close()
  }
})

test('режим --t3000-hook отправляет событие и выходит с кодом 0', async () => {
  const dirs = makeDirs()
  const events: HookEvent[] = []
  const server = new HookServer({ token: 'tok', onEvent: (ev) => events.push(ev) })
  const port = await server.listen()
  try {
    const env = { ...testEnv(dirs), T3000_TAB_ID: 't_1', T3000_PORT: String(port), T3000_TOKEN: 'tok' }
    const r = await runHookMode(env, JSON.stringify({ hook_event_name: 'Stop', session_id: 's1' }))
    expect(r.code).toBe(0)
    expect(r.stdout.trim()).toBe('')
    expect(events).toEqual([expect.objectContaining({ tab: 't_1', event: 'Stop', sessionId: 's1' })])

    // вне Terminal3000 (нет T3000_TAB_ID) — выход без отправки
    const r2 = await runHookMode(testEnv(dirs), JSON.stringify({ hook_event_name: 'Stop', session_id: 's2' }))
    expect(r2.code).toBe(0)
    expect(events).toHaveLength(1)
  } finally {
    await server.close()
  }
})

test('выход из Windows: workspace.json записан сразу, поздние изменения его не портят', async () => {
  const dirs = makeDirs()
  writeTestConfig(dirs.data)
  const app = await launchApp(dirs, [dirs.project])
  try {
    const page = await app.firstWindow()
    const { tabs } = await tabsOf(page)
    const id = tabs[0].id
    // при выходе из Windows before-quit не приходит, только session-end у окна
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].emit('session-end', {})
    })
    // пока Windows закрывает процессы, вкладки ещё меняются (поздние SessionEnd от claude и т. п.)
    await page.evaluate((tab) => (window as unknown as Win).t3000.closeTab(tab), id)
    await page.waitForTimeout(1200)
    const saved = JSON.parse(readFileSync(join(dirs.data, 'workspace.json'), 'utf8'))
    expect(saved.tabs.map((t: { id: string }) => t.id)).toEqual([id])
  } finally {
    await app.close()
  }
})

test('закрытие окна, пока Claude работает, — с подтверждением', async () => {
  const dirs = makeDirs()
  writeTestConfig(dirs.data)
  const app = await launchApp(dirs, [dirs.project])
  try {
    const page = await app.firstWindow()
    const { tabs } = await tabsOf(page)
    const id = tabs[0].id
    // консоль шлёт хуки настоящим скриптом: T3000_* уже в её окружении — вкладка становится работающим Claude
    const hook = join(ROOT, 'hooks', 't3000-hook.js')
    await page.evaluate(
      ({ tab, hook }) => {
        const api = (window as unknown as Win).t3000
        api.input(tab, `'{"hook_event_name":"SessionStart","session_id":"s1","source":"startup"}' | node "${hook}"\r`)
        api.input(tab, `'{"hook_event_name":"UserPromptSubmit","session_id":"s1"}' | node "${hook}"\r`)
      },
      { tab: id, hook }
    )
    await expect
      .poll(async () => (await tabsOf(page)).tabs[0], { timeout: 30000 })
      .toMatchObject({ kind: 'claude' })
    await expect
      .poll(async () => page.evaluate(async () => (await (window as unknown as Win).t3000.getInit()).state.tabs[0].status), {
        timeout: 30000
      })
      .toBe('working')

    // «Отмена»: окно остаётся
    await app.evaluate(({ dialog, BrowserWindow }) => {
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox
      BrowserWindow.getAllWindows()[0].close()
    })
    await page.waitForTimeout(500)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)

    // «Закрыть»: окно закрывается
    const closed = app.waitForEvent('close')
    await app.evaluate(({ dialog, BrowserWindow }) => {
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox
      BrowserWindow.getAllWindows()[0].close()
    })
    await closed
  } finally {
    await app.close().catch(() => undefined)
  }
})
