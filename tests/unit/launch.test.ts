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

  it('запуск через npm start: окружение npm-скрипта во вкладки не попадает', () => {
    const env = buildEnv(tab(), {
      ...ctx,
      baseEnv: {
        Path: [
          'C:\\src\\Terminal3000\\node_modules\\.bin',
          'C:\\src\\node_modules\\.bin',
          'C:\\node_modules\\.bin',
          'C:\\Program Files\\nodejs\\node_modules\\npm\\node_modules\\@npmcli\\run-script\\lib\\node-gyp-bin',
          'C:\\Windows\\System32',
          'C:\\Users\\u\\tools\\node_modules\\.bin'
        ].join(';'),
        npm_lifecycle_event: 'start',
        npm_config_prefix: 'C:\\Users\\u\\AppData\\Roaming\\npm',
        npm_config_local_prefix: 'C:\\src\\Terminal3000',
        npm_package_name: 'terminal3000',
        npm_node_execpath: 'C:\\Program Files\\nodejs\\node.exe',
        INIT_CWD: 'C:\\src\\Terminal3000',
        NODE: 'C:\\Program Files\\nodejs\\node.exe',
        USERPROFILE: 'C:\\Users\\u'
      }
    })
    // записи, которые npm добавил в начало, убраны; свои записи пользователя остались
    expect(env.Path).toBe('C:\\Windows\\System32;C:\\Users\\u\\tools\\node_modules\\.bin')
    expect(Object.keys(env).filter((k) => /^(npm_|INIT_CWD$|NODE$)/i.test(k))).toEqual([])
    expect(env.USERPROFILE).toBe('C:\\Users\\u')
  })

  it('без npm PATH и NODE не трогаются', () => {
    const baseEnv = { PATH: 'C:\\tools\\node_modules\\.bin;C:\\Windows', NODE: 'x' }
    expect(buildEnv(tab(), { ...ctx, baseEnv })).toMatchObject(baseEnv)
  })

  it('переменные терминала, из которого запустили приложение, не наследуются', () => {
    const env = buildEnv(tab(), {
      ...ctx,
      baseEnv: {
        WT_SESSION: 'guid',
        WT_PROFILE_ID: '{guid}',
        TERM_PROGRAM: 'vscode',
        TERM_PROGRAM_VERSION: '1.105.0',
        VSCODE_GIT_IPC_HANDLE: '\\\\.\\pipe\\vscode-git',
        VSCODE_GIT_ASKPASS_MAIN: 'C:\\VSCode\\askpass-main.js',
        GIT_ASKPASS: 'C:\\VSCode\\askpass.sh',
        HOME: 'C:\\Users\\u'
      }
    })
    expect(env).toEqual({
      HOME: 'C:\\Users\\u',
      T3000_TAB_ID: 't_1',
      T3000_PORT: '4567',
      T3000_TOKEN: 'tok',
      TERM_PROGRAM: 'Terminal3000',
      COLORTERM: 'truecolor'
    })
    // свой GIT_ASKPASS пользователя, не от VS Code, остаётся
    expect(buildEnv(tab(), { ...ctx, baseEnv: { GIT_ASKPASS: 'C:\\my\\askpass.exe' } }).GIT_ASKPASS).toBe(
      'C:\\my\\askpass.exe'
    )
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
