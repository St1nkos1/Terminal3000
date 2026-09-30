import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const ROOT = resolve(__dirname, '..', '..')
// из Node пакет electron отдаёт путь к electron.exe
const electronPath = createRequire(__filename)('electron') as string

export interface TestDirs {
  data: string
  claude: string
  project: string
}

// Временные папки: настоящие %APPDATA%\Terminal3000 и ~/.claude тесты не трогают
export function makeDirs(): TestDirs {
  const base = mkdtempSync(join(tmpdir(), 't3000-e2e-'))
  const dirs = { data: join(base, 'data'), claude: join(base, 'claude'), project: join(base, 'Проект') }
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true })
  return dirs
}

// PowerShell без профиля пользователя и DOM-рендерер вместо WebGL, чтобы текст терминала был в DOM
export function writeTestConfig(dataDir: string, extra: Record<string, unknown> = {}): void {
  const config = {
    shells: { powershell: { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile'] } },
    webgl: false,
    ...extra
  }
  writeFileSync(join(dataDir, 'config.json'), JSON.stringify(config, null, 2) + '\n')
}

export function testEnv(dirs: TestDirs): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith('ELECTRON_') && !k.startsWith('T3000_')) env[k] = v
  }
  env.T3000_USER_DATA = dirs.data
  env.T3000_CLAUDE_DIR = dirs.claude
  return env
}

export function launchApp(dirs: TestDirs, args: string[] = []): Promise<ElectronApplication> {
  return electron.launch({ args: ['.', ...args], cwd: ROOT, env: testEnv(dirs) })
}

// Terminal3000 в режиме --t3000-hook: stdin как у хука Claude Code
export function runHookMode(env: Record<string, string>, stdin: string): Promise<{ code: number | null; stdout: string }> {
  return new Promise((done, fail) => {
    const p = spawn(electronPath, ['.', '--t3000-hook'], { cwd: ROOT, env, stdio: ['pipe', 'pipe', 'ignore'] })
    let stdout = ''
    const timer = setTimeout(() => {
      p.kill()
      fail(new Error('режим хука не завершился за 20 с'))
    }, 20000)
    p.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    p.on('exit', (code) => {
      clearTimeout(timer)
      done({ code, stdout })
    })
    p.stdin.end(stdin)
  })
}
