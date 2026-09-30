import { describe, expect, it } from 'vitest'
import type { TabRecord } from '../../src/shared/types'
import {
  buildEnv,
  buildLaunch,
  claudeScript,
  psQuote,
  resolveExecutable,
  type LaunchConfig,
  type LaunchContext
} from '../../src/main/launch'

const config: LaunchConfig = {
  defaultShell: 'powershell',
  shells: {
    powershell: { file: 'powershell.exe', args: ['-NoLogo'] },
    cmd: { file: 'cmd.exe', args: [] }
  },
  claudeCommand: 'claude'
}

const ctx: LaunchContext = {
  port: 4567,
  token: 'tok',
  baseEnv: {
    Path: 'C:\\Windows\\System32',
    USERPROFILE: 'C:\\Users\\u',
    ELECTRON_RUN_AS_NODE: '1',
    electron_renderer_url: 'http://localhost:5173',
    EMPTY: undefined
  }
}

function tab(extra: Partial<TabRecord> = {}): TabRecord {
  return {
    id: 't_1',
    title: 'proj',
    cwd: 'C:/work/proj',
    kind: 'shell',
    shell: 'powershell',
    claudeSessionId: null,
    customTitle: false,
    ...extra
  }
}

describe('buildLaunch', () => {
  it('консоль запускается как в конфиге, без -NoProfile', () => {
    const s = buildLaunch(tab(), config, ctx, 'new')
    expect(s).toMatchObject({ file: 'powershell.exe', args: ['-NoLogo'], cwd: 'C:/work/proj' })
    expect(s.args).not.toContain('-NoProfile')
    expect(buildLaunch(tab({ shell: 'cmd' }), config, ctx, 'new')).toMatchObject({ file: 'cmd.exe', args: [] })
  })

  it('неизвестная оболочка → оболочка по умолчанию', () => {
    expect(buildLaunch(tab({ shell: 'nope' }), config, ctx, 'new').file).toBe('powershell.exe')
  })

  it('claude идёт через powershell -NoExit -Command', () => {
    const s = buildLaunch(tab({ kind: 'claude', shell: 'cmd', claudeSessionId: 'abc-123' }), config, ctx, 'resume')
    expect(s.file).toBe('powershell.exe')
    expect(s.args.slice(0, 3)).toEqual(['-NoLogo', '-NoExit', '-Command'])
    expect(s.args[3]).toBe(claudeScript('claude', 'resume', 'abc-123'))
    expect(s.args).not.toContain('-NoProfile')
  })

  it('без записи powershell в конфиге берётся встроенная', () => {
    const s = buildLaunch(tab({ kind: 'claude' }), { ...config, shells: {} }, ctx, 'new')
    expect(s.file).toBe('powershell.exe')
    expect(s.args.slice(0, 2)).toEqual(['-NoLogo', '-NoExit'])
  })
})

describe('claudeScript', () => {
  // сброс кода, который мог оставить профиль PowerShell
  const HEAD = '& { $global:LASTEXITCODE = $null; '

  it('новый разговор, продолжение, возобновление', () => {
    expect(claudeScript('claude', 'new', 'x').startsWith(`${HEAD}claude; $ok = $?;`)).toBe(true)
    expect(claudeScript('claude', 'continue', null).startsWith(`${HEAD}claude --continue;`)).toBe(true)
    expect(claudeScript('claude', 'resume', 'abc-123').startsWith(`${HEAD}claude --resume 'abc-123';`)).toBe(true)
  })

  it('resume без id или с опасным id → новый разговор', () => {
    expect(claudeScript('claude', 'resume', null).startsWith(`${HEAD}claude;`)).toBe(true)
    expect(claudeScript('claude', 'resume', "a'; rm -r C:\\; '").startsWith(`${HEAD}claude;`)).toBe(true)
  })

  it('сообщает код выхода через OSC 7777 и не содержит двойных кавычек', () => {
    const s = claudeScript('claude', 'resume', 'abc')
    expect(s).toContain("[Console]::Write([char]27 + ']7777;t3000;claude-exit;' + $c + [char]7)")
    expect(s).toContain('if ($null -eq $c) { $c = [int](-not $ok) }')
    expect(s).not.toContain('"')
  })

  it('своя команда claude из конфига', () => {
    expect(claudeScript('claude --model opus', 'continue', null).startsWith(`${HEAD}claude --model opus --continue;`)).toBe(
      true
    )
  })
})

describe('psQuote', () => {
  it('удваивает одинарные кавычки, включая типографские', () => {
    expect(psQuote('abc')).toBe("'abc'")
    expect(psQuote("a'b")).toBe("'a''b'")
    expect(psQuote('a\u2019b')).toBe("'a\u2019\u2019b'")
  })
})

describe('buildEnv', () => {
  it('убирает ELECTRON_* в любом регистре и пустые значения, добавляет свои', () => {
    const env = buildEnv(tab(), ctx)
    expect(env).toEqual({
      Path: 'C:\\Windows\\System32',
      USERPROFILE: 'C:\\Users\\u',
      T3000_TAB_ID: 't_1',
      T3000_PORT: '4567',
      T3000_TOKEN: 'tok',
      TERM_PROGRAM: 'Terminal3000',
      COLORTERM: 'truecolor'
    })
  })

  it('buildLaunch кладёт окружение в спецификацию', () => {
    expect(buildLaunch(tab(), config, ctx, 'new').env.T3000_TAB_ID).toBe('t_1')
  })
})

describe('resolveExecutable', () => {
  const env = { Path: 'C:\\bin;C:\\tools', PATHEXT: '.COM;.EXE;.CMD' }
  const files = new Set(['C:\\tools\\claude.CMD', 'C:\\bin\\cmd.exe', 'C:\\Program Files\\Git\\bin\\bash.exe'])
  const exists = (p: string) => files.has(p)

  it('абсолютный путь проверяется как есть', () => {
    expect(resolveExecutable('C:/Program Files/Git/bin/bash.exe', env, exists)).toBe(
      'C:\\Program Files\\Git\\bin\\bash.exe'
    )
    expect(resolveExecutable('C:/nope/bash.exe', env, exists)).toBeNull()
  })

  it('имя ищется по PATH, без расширения — с PATHEXT', () => {
    expect(resolveExecutable('cmd.exe', env, exists)).toBe('C:\\bin\\cmd.exe')
    expect(resolveExecutable('claude', env, exists)).toBe('C:\\tools\\claude.CMD')
    expect(resolveExecutable('missing.exe', env, exists)).toBeNull()
  })
})
