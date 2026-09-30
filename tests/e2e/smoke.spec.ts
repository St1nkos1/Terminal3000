import { expect, test } from '@playwright/test'
import { homedir } from 'node:os'
import type { T3000Api } from '../../src/shared/ipc'
import { launchApp, makeDirs, writeTestConfig } from './helpers'

test('консоль в домашней папке и закрытие вкладок крестиком', async () => {
  const dirs = makeDirs()
  writeTestConfig(dirs.data)
  const app = await launchApp(dirs, [dirs.project])
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.tab-row')).toHaveCount(1)
    await page.locator('.pane.active .xterm-screen').click()
    // Ctrl+Shift+T → первый пункт «Консоль» → Enter
    await page.keyboard.press('Control+Shift+T')
    await expect(page.locator('.palette-item').first()).toContainText('Консоль')
    await page.keyboard.press('Enter')
    await expect(page.locator('.tab-row')).toHaveCount(2)
    const cwd = await page.evaluate(
      async () => (await (window as unknown as { t3000: T3000Api }).t3000.getInit()).state.tabs[1].cwd
    )
    expect(cwd).toBe(homedir())
    // крестик на строке вкладки: консоль закрывается без вопроса
    const row = page.locator('.tab-row').nth(1)
    await row.hover()
    await row.locator('.tab-close').click()
    await expect(page.locator('.tab-row')).toHaveCount(1)
    // крестик в заголовке панели
    await page.locator('.pane.active .pane-close').click()
    await expect(page.locator('.tab-row')).toHaveCount(0)
    await expect(page.locator('.empty')).toBeVisible()
  } finally {
    await app.close()
  }
})

// Спека §13: консоль открывается, вывод виден, после перезапуска вкладка на месте
test('smoke: консоль, вывод и восстановление после перезапуска', async () => {
  const dirs = makeDirs()
  writeTestConfig(dirs.data)

  let app = await launchApp(dirs, [dirs.project])
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.tab-row')).toHaveCount(1)
    await expect(page.locator('.pane.active .pane-title')).toHaveText('Проект · pwsh')
    const screen = page.locator('.pane.active .xterm-screen')
    await expect(screen).toContainText('PS ', { timeout: 30000 })
    await screen.click()
    // в самой команде нет строки t3000-ok, она появится только в выводе
    await page.keyboard.type("Write-Output ('t3000-' + 'ok')")
    await page.keyboard.press('Enter')
    await expect(screen).toContainText('t3000-ok', { timeout: 30000 })
  } finally {
    await app.close()
  }

  app = await launchApp(dirs)
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.tab-row')).toHaveCount(1)
    await expect(page.locator('.tab-row .label')).toHaveText('pwsh')
    // вывод на диск не пишется: после перезапуска это новая консоль в той же папке
    const screen = page.locator('.pane.active .xterm-screen')
    await expect(screen).toContainText('Проект>', { timeout: 30000 })
    await expect(screen).not.toContainText('t3000-ok')
  } finally {
    await app.close()
  }
})
