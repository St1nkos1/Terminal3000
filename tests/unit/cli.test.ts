import { describe, expect, it } from 'vitest'
import { hasHookFlag, parseFolderArg } from '../../src/main/cli'
import { isSafeExternalUrl } from '../../src/main/security'

describe('parseFolderArg', () => {
  it('собранное приложение: первый аргумент после exe', () => {
    expect(parseFolderArg(['C:\\app\\Terminal3000.exe', 'D:\\proj'], false, 'C:\\')).toBe('D:\\proj')
  })

  it('режим разработки: пропускает electron.exe и путь приложения', () => {
    expect(parseFolderArg(['electron.exe', '.', 'D:\\proj'], true, 'C:\\')).toBe('D:\\proj')
    expect(parseFolderArg(['electron.exe', '.'], true, 'C:\\')).toBeNull()
  })

  it('режим разработки: флаги перед путём приложения (так запускает Playwright)', () => {
    expect(
      parseFolderArg(['electron.exe', '--inspect=0', '--remote-debugging-port=0', '.', 'D:\\proj'], true, 'C:\\')
    ).toBe('D:\\proj')
  })

  it('флаги Chromium пропускаются, относительный путь — от рабочей папки', () => {
    expect(
      parseFolderArg(['T.exe', '--allow-file-access-from-files', '--original-process-start-time=1', 'sub'], false, 'C:\\w')
    ).toBe('C:\\w\\sub')
  })

  it('флаг хука', () => {
    expect(hasHookFlag(['T.exe', '--t3000-hook'])).toBe(true)
    expect(hasHookFlag(['T.exe'])).toBe(false)
  })
})

describe('isSafeExternalUrl', () => {
  it('только http и https', () => {
    expect(isSafeExternalUrl('https://github.com/St1nkos1')).toBe(true)
    expect(isSafeExternalUrl('http://localhost:3000')).toBe(true)
    for (const bad of ['file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'ms-settings:', 'not a url']) {
      expect(isSafeExternalUrl(bad), bad).toBe(false)
    }
  })
})
