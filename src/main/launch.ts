import { existsSync } from 'node:fs'
import { win32 } from 'node:path'
import type { AppConfig, ClaudeStart, ShellSpec, TabRecord } from '../shared/types'

export type LaunchConfig = Pick<AppConfig, 'defaultShell' | 'shells' | 'claudeCommand'>

export interface LaunchContext {
  port: number
  token: string
  baseEnv: NodeJS.ProcessEnv
}

export interface SpawnSpec {
  file: string
  args: string[]
  cwd: string
  env: Record<string, string>
}

const BUILTIN_POWERSHELL: ShellSpec = { file: 'powershell.exe', args: ['-NoLogo'] }
const SAFE_SESSION_ID = /^[A-Za-z0-9_.-]{1,200}$/

export function psQuote(s: string): string {
  return `'${s.replace(/['\u2018\u2019\u201a\u201b]/g, (q) => q + q)}'`
}

export function claudeScript(claudeCommand: string, start: ClaudeStart, sessionId: string | null): string {
  const parts = [claudeCommand]
  if (start === 'continue') parts.push('--continue')
  if (start === 'resume' && sessionId && SAFE_SESSION_ID.test(sessionId)) parts.push('--resume', psQuote(sessionId))
  return (
    `& { $global:LASTEXITCODE = $null; ${parts.join(' ')}; $ok = $?; $c = $LASTEXITCODE; if ($null -eq $c) { $c = [int](-not $ok) }; ` +
    `[Console]::Write([char]27 + ']7777;t3000;claude-exit;' + $c + [char]7) }`
  )
}

export function buildEnv(tab: TabRecord, ctx: LaunchContext): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(ctx.baseEnv)) {
    if (v === undefined || k.toUpperCase().startsWith('ELECTRON_')) continue
    env[k] = v
  }
  env.T3000_TAB_ID = tab.id
  env.T3000_PORT = String(ctx.port)
  env.T3000_TOKEN = ctx.token
  env.TERM_PROGRAM = 'Terminal3000'
  env.COLORTERM = 'truecolor'
  return env
}

export function buildLaunch(tab: TabRecord, config: LaunchConfig, ctx: LaunchContext, start: ClaudeStart): SpawnSpec {
  const env = buildEnv(tab, ctx)
  if (tab.kind === 'claude') {
    const ps = config.shells.powershell ?? BUILTIN_POWERSHELL
    const script = claudeScript(config.claudeCommand, start, tab.claudeSessionId)
    return { file: ps.file, args: [...ps.args, '-NoExit', '-Command', script], cwd: tab.cwd, env }
  }
  const shell = config.shells[tab.shell] ?? config.shells[config.defaultShell] ?? BUILTIN_POWERSHELL
  return { file: shell.file, args: [...shell.args], cwd: tab.cwd, env }
}

function envValue(env: Record<string, string>, name: string): string {
  const key = Object.keys(env).find((k) => k.toUpperCase() === name)
  return key ? env[key] : ''
}

// Полный путь к исполняемому файлу или null, если его нет
export function resolveExecutable(
  file: string,
  env: Record<string, string>,
  exists: (p: string) => boolean = existsSync
): string | null {
  if (win32.isAbsolute(file) || /[\\/]/.test(file)) {
    const p = win32.normalize(file)
    return exists(p) ? p : null
  }
  const exts = win32.extname(file) ? [''] : ['', ...envValue(env, 'PATHEXT').split(';').filter(Boolean)]
  for (const dir of envValue(env, 'PATH').split(';').filter(Boolean)) {
    for (const ext of exts) {
      const p = win32.join(dir, file + ext)
      if (exists(p)) return p
    }
  }
  return null
}
