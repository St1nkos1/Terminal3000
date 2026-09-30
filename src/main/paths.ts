import { join } from 'node:path'

export interface PathInputs {
  isPackaged: boolean
  appPath: string
  resourcesPath: string
  appData: string
  home: string
  env: NodeJS.ProcessEnv
}

export interface AppPaths {
  userData: string
  configFile: string
  workspaceFile: string
  logDir: string
  claudeDir: string
  claudeSettings: string
  hookScript: string
  soundsDir: string
}

// T3000_USER_DATA и T3000_CLAUDE_DIR нужны тестам: настоящие папки пользователя они не трогают
export function resolvePaths(i: PathInputs): AppPaths {
  const userData = i.env.T3000_USER_DATA || join(i.appData, 'Terminal3000')
  const claudeDir = i.env.T3000_CLAUDE_DIR || join(i.home, '.claude')
  // в сборке hooks/ и sounds/ лежат в resources без asar
  const hooksRoot = i.isPackaged ? i.resourcesPath : i.appPath
  return {
    userData,
    configFile: join(userData, 'config.json'),
    workspaceFile: join(userData, 'workspace.json'),
    logDir: join(userData, 'logs'),
    claudeDir,
    claudeSettings: join(claudeDir, 'settings.json'),
    hookScript: join(hooksRoot, 'hooks', 't3000-hook.js'),
    soundsDir: i.isPackaged ? join(i.resourcesPath, 'sounds') : join(i.appPath, 'assets', 'sounds')
  }
}
