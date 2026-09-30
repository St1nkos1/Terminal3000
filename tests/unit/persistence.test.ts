import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from '../../src/shared/types'
import {
  loadWorkspace,
  parseWorkspace,
  readJson,
  saveWorkspaceSync,
  stamp,
  WorkspaceSaver,
  writeFileAtomic
} from '../../src/main/persistence'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 't3000-persist-'))
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

const ws: Workspace = {
  version: 1,
  tabs: [
    { id: 't_a', title: 'A', cwd: 'C:/a', kind: 'claude', shell: 'powershell', claudeSessionId: 's1', customTitle: false },
    { id: 't_b', title: 'B', cwd: 'C:/b', kind: 'shell', shell: 'cmd', claudeSessionId: null, customTitle: true }
  ],
  layout: {
    type: 'split',
    dir: 'row',
    sizes: [0.6, 0.4],
    children: [
      { type: 'pane', tab: 't_a' },
      { type: 'pane', tab: 't_b' }
    ]
  },
  activeTab: 't_b',
  sidebar: { collapsed: false, collapsedGroups: ['c:/a'] }
}

describe('persistence', () => {
  it('stamp в местном времени', () => {
    expect(stamp(new Date(2026, 8, 28, 7, 5, 3))).toBe('20260928-070503')
  })

  it('readJson понимает BOM', () => {
    const f = join(dir, 'bom.json')
    writeFileSync(f, '\ufeff{"a":1}', 'utf8')
    expect(readJson(f)).toEqual({ a: 1 })
  })

  it('writeFileAtomic создаёт папку, перезаписывает и не оставляет временных файлов', () => {
    const f = join(dir, 'sub', 'x.json')
    writeFileAtomic(f, 'one')
    writeFileAtomic(f, 'two')
    expect(readFileSync(f, 'utf8')).toBe('two')
    expect(readdirSync(join(dir, 'sub'))).toEqual(['x.json'])
  })

  it('сохранение и загрузка без потерь', () => {
    const f = join(dir, 'workspace.json')
    saveWorkspaceSync(f, ws)
    expect(loadWorkspace(f)).toEqual({ workspace: ws, broken: null })
  })

  it('нет файла → пусто, без карантина', () => {
    expect(loadWorkspace(join(dir, 'none.json'))).toEqual({ workspace: null, broken: null })
  })

  it('битый JSON и чужая версия уходят в карантин', () => {
    const now = new Date(2026, 8, 28, 12, 0, 0)
    for (const content of ['{"version":1,', '{"version":2,"tabs":[]}']) {
      const f = join(dir, 'workspace.json')
      writeFileSync(f, content)
      const r = loadWorkspace(f, now)
      expect(r.workspace).toBeNull()
      expect(r.broken).toBe(`${f}.broken-20260928-120000`)
      expect(existsSync(f)).toBe(false)
      expect(readFileSync(r.broken!, 'utf8')).toBe(content)
    }
  })

  it('кривые вкладки отбрасываются по одной, раскладка чинится', () => {
    const f = join(dir, 'workspace.json')
    writeFileSync(
      f,
      JSON.stringify({
        version: 1,
        tabs: [
          { id: 't_a', cwd: 'C:\\work\\Проект', kind: 'claude' },
          { id: 't_a', cwd: 'C:/dup', kind: 'shell' },
          { id: 't_bad', cwd: 'C:/x', kind: 'robot' },
          { cwd: 'C:/noid', kind: 'shell' }
        ],
        layout: { type: 'split', dir: 'row', sizes: [1, 1], children: [{ type: 'pane', tab: 't_gone' }] },
        activeTab: 't_gone',
        sidebar: 'nope'
      })
    )
    expect(loadWorkspace(f).workspace).toEqual({
      version: 1,
      tabs: [
        {
          id: 't_a',
          title: 'Проект',
          cwd: 'C:\\work\\Проект',
          kind: 'claude',
          shell: 'powershell',
          claudeSessionId: null,
          customTitle: false
        }
      ],
      layout: { type: 'pane', tab: 't_a' },
      activeTab: 't_a',
      sidebar: { collapsed: false, collapsedGroups: [] }
    })
  })

  it('WorkspaceSaver пишет не чаще раза в интервал, flush — сразу', () => {
    vi.useFakeTimers()
    const f = join(dir, 'workspace.json')
    const get = vi.fn(() => ws)
    const saver = new WorkspaceSaver(f, get, () => undefined, 500)
    saver.schedule()
    saver.schedule()
    saver.schedule()
    expect(get).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(get).toHaveBeenCalledTimes(1)
    saver.schedule()
    saver.flush()
    expect(get).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(1000)
    expect(get).toHaveBeenCalledTimes(2)
    expect(loadWorkspace(f).workspace).toEqual(ws)
  })

  it('WorkspaceSaver сообщает об ошибке записи, а не бросает', () => {
    const onError = vi.fn()
    const saver = new WorkspaceSaver(join(dir, 'x.json'), () => {
      throw new Error('boom')
    }, onError)
    saver.flush()
    expect(onError).toHaveBeenCalledOnce()
  })
})

describe('loadWorkspace: сбои файловой системы', () => {
  const now = new Date(2026, 8, 30, 12, 0, 0)

  it('файл не читается (не ошибка JSON) — без карантина и без вкладок', () => {
    const f = join(dir, 'workspace.json')
    mkdirSync(f)
    expect(loadWorkspace(f, now)).toEqual({ workspace: null, broken: null })
    expect(statSync(f).isDirectory()).toBe(true)
  })

  it('битый файл, но переименовать не вышло — без исключения', () => {
    const f = join(dir, 'workspace.json')
    writeFileSync(f, '{ oops')
    mkdirSync(`${f}.broken-20260930-120000`)
    expect(loadWorkspace(f, now)).toEqual({ workspace: null, broken: null })
    expect(readFileSync(f, 'utf8')).toBe('{ oops')
  })
})

describe('parseWorkspace: размер терминала', () => {
  it('корректный размер сохраняется, мусор отбрасывается', () => {
    const base = { version: 1, tabs: [], layout: null, activeTab: null, sidebar: {} }
    expect(parseWorkspace({ ...base, termSize: { cols: 100, rows: 40 } })?.termSize).toEqual({ cols: 100, rows: 40 })
    for (const termSize of [{ cols: 'x', rows: 40 }, { cols: 100, rows: -1 }, { cols: 5000, rows: 40 }, { cols: 1.5, rows: 40 }, 'big']) {
      expect(parseWorkspace({ ...base, termSize })?.termSize, JSON.stringify(termSize)).toBeUndefined()
    }
  })
})
