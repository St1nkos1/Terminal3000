import { expect, test } from '@playwright/test'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, makeDirs, writeTestConfig } from './helpers'

test('первый запуск: приветствие ставит хуки, палитра их удаляет, чужое на месте', async () => {
  const dirs = makeDirs()
  const settingsFile = join(dirs.claude, 'settings.json')
  const foreign = { type: 'command', command: 'echo foreign' }
  writeFileSync(settingsFile, JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [foreign] }] } }, null, 2))

  const app = await launchApp(dirs)
  try {
    const page = await app.firstWindow()
    const welcome = page.locator('.welcome')
    await expect(welcome).toBeVisible()
    await welcome.getByRole('button', { name: 'Установить хуки' }).click()
    await expect(welcome).toBeHidden()
    await expect(page.locator('.banner', { hasText: 'Хуки установлены' })).toBeVisible()

    const s = JSON.parse(readFileSync(settingsFile, 'utf8'))
    expect(s.model).toBe('opus')
    expect(Object.keys(s.hooks).sort()).toEqual([
      'Notification',
      'PostToolUse',
      'SessionEnd',
      'SessionStart',
      'Stop',
      'UserPromptSubmit'
    ])
    const ours = s.hooks.SessionStart[0]
    expect(ours.matcher).toBeUndefined()
    expect(ours.hooks[0]).toMatchObject({ type: 'command', command: 'node', async: true, timeout: 5 })
    expect(ours.hooks[0].args[0]).toMatch(/hooks\/t3000-hook\.js$/)
    expect(JSON.stringify(s.hooks.Stop)).toContain('echo foreign')
    expect(readdirSync(dirs.claude).some((f) => f.startsWith('settings.json.bak-'))).toBe(true)

    await page.keyboard.press('Control+Shift+P')
    await page.keyboard.type('удалить хуки')
    await page.keyboard.press('Enter')
    await expect(page.locator('.banner', { hasText: 'хуки не установлены' })).toBeVisible()
    const after = JSON.parse(readFileSync(settingsFile, 'utf8'))
    expect(JSON.stringify(after)).not.toContain('t3000-hook')
    expect(JSON.stringify(after.hooks.Stop)).toContain('echo foreign')
  } finally {
    await app.close()
  }
})

test('повреждённый settings.json: файл не тронут, баннер с путём', async () => {
  const dirs = makeDirs()
  writeTestConfig(dirs.data)
  const settingsFile = join(dirs.claude, 'settings.json')
  writeFileSync(settingsFile, '{ "hooks": ')

  const app = await launchApp(dirs)
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.banner-error')).toContainText(settingsFile)
    await expect(page.locator('.welcome')).toHaveCount(0)
    expect(readFileSync(settingsFile, 'utf8')).toBe('{ "hooks": ')
  } finally {
    await app.close()
  }
})
