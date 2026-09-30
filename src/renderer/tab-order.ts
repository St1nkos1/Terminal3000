import { cwdKey, folderName } from '../shared/text'
import type { TabInfo, TabStatus } from '../shared/types'

export interface TabGroup {
  key: string
  name: string
  cwd: string
  tabs: TabInfo[]
}

// Порядок групп и вкладок — порядок появления, сам не меняется
export function groupTabs(tabs: TabInfo[]): TabGroup[] {
  const groups = new Map<string, TabGroup>()
  for (const t of tabs) {
    const key = cwdKey(t.cwd)
    let g = groups.get(key)
    if (!g) {
      g = { key, name: folderName(t.cwd), cwd: t.cwd, tabs: [] }
      groups.set(key, g)
    }
    g.tabs.push(t)
  }
  return [...groups.values()]
}

export function panelOrder(tabs: TabInfo[]): string[] {
  return groupTabs(tabs).flatMap((g) => g.tabs.map((t) => t.id))
}

export function touchMru(mru: string[], tab: string): string[] {
  return [tab, ...mru.filter((t) => t !== tab)]
}

export const STATUS_LABEL: Record<TabStatus, string> = {
  sleeping: 'спит',
  starting: 'запуск',
  idle: 'свободна',
  working: 'работает',
  waiting: 'ждёт',
  done: 'готово',
  crashed: 'упала',
  shell: 'консоль'
}

export const STATUS_ICON: Record<TabStatus, string> = {
  sleeping: '◌',
  starting: '…',
  idle: '○',
  working: '◐',
  waiting: '●',
  done: '✔',
  crashed: '✕',
  shell: '▪'
}

export function showsDuration(status: TabStatus): boolean {
  return status === 'working' || status === 'waiting'
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}с`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}м`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}ч`
  return `${Math.floor(h / 24)}д`
}

const SHELL_LABEL: Record<string, string> = { powershell: 'pwsh', gitbash: 'bash' }

export function tabLabel(t: TabInfo): string {
  if (t.customTitle) return t.title
  if (t.kind === 'claude') return 'claude'
  return SHELL_LABEL[t.shell] ?? t.shell
}

export function paneTitle(t: TabInfo): string {
  return t.customTitle ? t.title : `${folderName(t.cwd)} · ${tabLabel(t)}`
}
