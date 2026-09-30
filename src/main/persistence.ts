import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { layoutTabs, normalizeLayout, pane } from '../shared/layout'
import { folderName } from '../shared/text'
import type { SidebarState, TabRecord, Workspace } from '../shared/types'

export function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

export function readJson(file: string): unknown {
  return JSON.parse(stripBom(readFileSync(file, 'utf8')))
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

// Антивирус или индексатор Windows может ненадолго держать файл, поэтому rename повторяется
export function writeFileAtomic(file: string, data: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, data, 'utf8')
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, file)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (attempt >= 3 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
        rmSync(tmp, { force: true })
        throw e
      }
      sleepSync(50)
    }
  }
}

export function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function quarantine(file: string, now: Date): string {
  const target = `${file}.broken-${stamp(now)}`
  renameSync(file, target)
  return target
}

function parseTab(raw: unknown): TabRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || o.id.length === 0 || o.id.length > 64) return null
  if (typeof o.cwd !== 'string' || o.cwd.length === 0) return null
  if (o.kind !== 'shell' && o.kind !== 'claude') return null
  return {
    id: o.id,
    title: typeof o.title === 'string' && o.title ? o.title : folderName(o.cwd),
    cwd: o.cwd,
    kind: o.kind,
    shell: typeof o.shell === 'string' && o.shell ? o.shell : 'powershell',
    claudeSessionId: typeof o.claudeSessionId === 'string' && o.claudeSessionId ? o.claudeSessionId : null,
    customTitle: o.customTitle === true
  }
}

function parseSidebar(raw: unknown): SidebarState {
  if (!raw || typeof raw !== 'object') return { collapsed: false, collapsedGroups: [] }
  const o = raw as Record<string, unknown>
  return {
    collapsed: o.collapsed === true,
    collapsedGroups: Array.isArray(o.collapsedGroups)
      ? o.collapsedGroups.filter((g): g is string => typeof g === 'string')
      : []
  }
}

export function parseWorkspace(raw: unknown): Workspace | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.version !== 1 || !Array.isArray(o.tabs)) return null
  const tabs: TabRecord[] = []
  const ids = new Set<string>()
  for (const t of o.tabs) {
    const tab = parseTab(t)
    if (tab && !ids.has(tab.id)) {
      ids.add(tab.id)
      tabs.push(tab)
    }
  }
  let layout = normalizeLayout(o.layout, ids)
  const activeTab =
    typeof o.activeTab === 'string' && ids.has(o.activeTab)
      ? o.activeTab
      : (layoutTabs(layout)[0] ?? tabs[0]?.id ?? null)
  if (!layout && activeTab) layout = pane(activeTab)
  return { version: 1, tabs, layout, activeTab, sidebar: parseSidebar(o.sidebar) }
}

export function loadWorkspace(
  file: string,
  now: Date = new Date()
): { workspace: Workspace | null; broken: string | null } {
  if (!existsSync(file)) return { workspace: null, broken: null }
  let workspace: Workspace | null
  try {
    workspace = parseWorkspace(readJson(file))
  } catch (e) {
    // файл занят или недоступен — это не повреждение, его не трогаем
    if (!(e instanceof SyntaxError)) return { workspace: null, broken: null }
    workspace = null
  }
  if (workspace) return { workspace, broken: null }
  try {
    return { workspace: null, broken: quarantine(file, now) }
  } catch {
    // переименовать не вышло: запуск важнее, файл перезапишется при сохранении
    return { workspace: null, broken: null }
  }
}

export function saveWorkspaceSync(file: string, ws: Workspace): void {
  writeFileAtomic(file, JSON.stringify(ws, null, 2) + '\n')
}

export class WorkspaceSaver {
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly file: string,
    private readonly get: () => Workspace,
    private readonly onError: (e: unknown) => void,
    private readonly intervalMs = 500
  ) {}

  schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), this.intervalMs)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    try {
      saveWorkspaceSync(this.file, this.get())
    } catch (e) {
      this.onError(e)
    }
  }
}
