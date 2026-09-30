import { expect, test } from '@playwright/test'
import { launchApp, makeDirs, writeTestConfig } from './helpers'

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
