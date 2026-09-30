import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePaths, type PathInputs } from '../../src/main/paths'

const base: PathInputs = {
  isPackaged: false,
  appPath: join('C:', 'src', 'Terminal3000'),
  resourcesPath: join('C:', 'electron', 'resources'),
  appData: join('C:', 'Users', 'u', 'AppData', 'Roaming'),
  home: join('C:', 'Users', 'u'),
  env: {}
}

describe('resolvePaths', () => {
  it('режим разработки: данные в %APPDATA%\\Terminal3000, хук и звуки из папки проекта', () => {
    const p = resolvePaths(base)
    const data = join(base.appData, 'Terminal3000')
    expect(p.userData).toBe(data)
    expect(p.configFile).toBe(join(data, 'config.json'))
    expect(p.workspaceFile).toBe(join(data, 'workspace.json'))
    expect(p.logDir).toBe(join(data, 'logs'))
    expect(p.claudeDir).toBe(join(base.home, '.claude'))
    expect(p.claudeSettings).toBe(join(base.home, '.claude', 'settings.json'))
    expect(p.hookScript).toBe(join(base.appPath, 'hooks', 't3000-hook.js'))
    expect(p.soundsDir).toBe(join(base.appPath, 'assets', 'sounds'))
  })

  it('собранное приложение: хук и звуки из resources', () => {
    const p = resolvePaths({ ...base, isPackaged: true })
    expect(p.hookScript).toBe(join(base.resourcesPath, 'hooks', 't3000-hook.js'))
    expect(p.soundsDir).toBe(join(base.resourcesPath, 'sounds'))
  })

  it('T3000_USER_DATA и T3000_CLAUDE_DIR подменяют папки (для тестов)', () => {
    const p = resolvePaths({ ...base, env: { T3000_USER_DATA: 'D:\\tmp\\data', T3000_CLAUDE_DIR: 'D:\\tmp\\claude' } })
    expect(p.userData).toBe('D:\\tmp\\data')
    expect(p.configFile).toBe(join('D:\\tmp\\data', 'config.json'))
    expect(p.claudeSettings).toBe(join('D:\\tmp\\claude', 'settings.json'))
  })
})
