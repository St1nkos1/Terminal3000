import { cwdKey, folderName } from '../shared/text'
import { layoutTabs } from '../shared/layout'
import type { LayoutNode, TabInfo, TabStatus } from '../shared/types'

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

// Ctrl+Tab: пока Ctrl зажат, идём по списку MRU, снятому при первом нажатии
export interface MruCycle {
  list: string[]
  index: number
}

export function mruStep(mru: string[], cycle: MruCycle | null, dir: 1 | -1): { cycle: MruCycle; tab: string } | null {
  const list = cycle?.list ?? mru
  if (list.length < 2) return null
  const index = ((cycle?.index ?? 0) + dir + list.length) % list.length
  return { cycle: { list, index }, tab: list[index] }
}

// Сначала ждущие ответа, потом готовые; по кругу от текущей в порядке панели
export function nextAttention(tabs: TabInfo[], current: string | null): string | null {
  const order = panelOrder(tabs)
  const byId = new Map(tabs.map((t) => [t.id, t]))
  const start = current ? order.indexOf(current) : -1
  const rotated = [...order.slice(start + 1), ...order.slice(0, start + 1)].filter((id) => id !== current)
  for (const status of ['waiting', 'done'] as const) {
    const hit = rotated.find((id) => byId.get(id)?.status === status)
    if (hit) return hit
  }
  return null
}

export type ConsoleStep =
  | { type: 'hide'; tab: string; back: string }
  | { type: 'show'; tab: string }
  | { type: 'create'; cwd: string }
  | null

// Консоль проекта — вкладка-консоль той же папки
export function projectConsole(tabs: TabInfo[], tab: TabInfo): TabInfo | undefined {
  const key = cwdKey(tab.cwd)
  return tabs.find((t) => t.id !== tab.id && t.kind === 'shell' && cwdKey(t.cwd) === key)
}

// Ctrl+`: показать или скрыть консоль проекта активной вкладки
export function consoleStep(tabs: TabInfo[], layout: LayoutNode | null, activeTab: string | null): ConsoleStep {
  const active = tabs.find((t) => t.id === activeTab)
  if (!active) return null
  const key = cwdKey(active.cwd)
  const shown = new Set(layoutTabs(layout))
  const sameProject = tabs.filter((t) => t.id !== active.id && cwdKey(t.cwd) === key)
  if (active.kind === 'shell') {
    // активна сама консоль: скрываем её, если над ней есть вкладка этого проекта
    const above = sameProject.find((t) => shown.has(t.id))
    return above ? { type: 'hide', tab: active.id, back: above.id } : null
  }
  const shellTab = projectConsole(tabs, active)
  if (!shellTab) return { type: 'create', cwd: active.cwd }
  if (shown.has(shellTab.id)) return { type: 'hide', tab: shellTab.id, back: active.id }
  return { type: 'show', tab: shellTab.id }
}

// Сколько ждать первого хука, прежде чем считать, что статусов у вкладки не будет
export const NO_HOOKS_AFTER_MS = 30_000

// Без хуков Claude-вкладка навсегда осталась бы «запуск»: хуки не стоят или сессия запущена до их установки
export function statusText(t: TabInfo, hooksInstalled: boolean, now: number): string {
  if (t.status === 'starting' && (!hooksInstalled || now - t.statusSince > NO_HOOKS_AFTER_MS)) return 'без статусов'
  return STATUS_LABEL[t.status]
}
