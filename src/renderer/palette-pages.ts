import { cwdKey, folderName } from '../shared/text'
import type {
  ActionId,
  AppConfig,
  Conversation,
  HooksState,
  NewTabRequest,
  Project,
  SplitDir,
  TabInfo
} from '../shared/types'
import { panelOrder, paneTitle, STATUS_LABEL } from './tab-order'

export type PaletteMode =
  | { page: 'root' }
  | { page: 'new-tab'; split?: SplitDir }
  | { page: 'project'; cwd: string; split?: SplitDir }
  | { page: 'conversations'; cwd: string; split?: SplitDir }
  | { page: 'split'; dir: SplitDir }
  | { page: 'shell'; tab: string }

export type PaletteCommand =
  | { type: 'show-tab'; tab: string }
  | { type: 'page'; mode: PaletteMode }
  | { type: 'open'; req: NewTabRequest; split?: SplitDir }
  | { type: 'pick-folder'; split?: SplitDir }
  | { type: 'split-with'; tab: string; dir: SplitDir }
  | { type: 'set-shell'; tab: string; shell: string }
  | { type: 'action'; id: ActionId }
  | { type: 'open-config' }
  | { type: 'toggle-sidebar' }

export interface PaletteItem {
  key: string
  label: string
  detail: string
  hint: string
  command: PaletteCommand
}

export interface PaletteData {
  tabs: TabInfo[]
  // null — список ещё загружается
  projects: Project[] | null
  config: AppConfig
  hooks: HooksState
  doNotDisturb: boolean
  sidebarCollapsed: boolean
  activeTab: string | null
  layoutTabs: string[]
  now: number
}

// Сколько прошлых разговоров показывать на главной странице
const ROOT_CONVERSATIONS = 300

const withSplit = (split?: SplitDir) => (split ? { split } : {})

export function formatAgo(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60000)
  if (m < 1) return 'только что'
  if (m < 60) return `${m} мин назад`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ч назад`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} дн назад`
  return `${Math.floor(d / 30)} мес назад`
}

// Проекты из индекса плюс папки открытых вкладок, которых в индексе нет
export function mergeProjects(projects: Project[], tabs: TabInfo[]): Project[] {
  const out = [...projects]
  const seen = new Set(projects.map((p) => cwdKey(p.cwd)))
  for (const t of tabs) {
    const key = cwdKey(t.cwd)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ cwd: t.cwd, name: folderName(t.cwd), lastUsed: 0, conversations: [] })
  }
  return out
}

// Оболочка по умолчанию первой, остальные в порядке конфига
export function shellNames(config: AppConfig): string[] {
  const names = Object.keys(config.shells)
  return names.includes(config.defaultShell)
    ? [config.defaultShell, ...names.filter((n) => n !== config.defaultShell)]
    : names
}

function tabItem(t: TabInfo, command: PaletteCommand): PaletteItem {
  return { key: `tab:${t.id}`, label: paneTitle(t), detail: STATUS_LABEL[t.status], hint: 'вкладка', command }
}

function projectItem(p: Project, split?: SplitDir): PaletteItem {
  return {
    key: `project:${cwdKey(p.cwd)}`,
    label: p.name,
    detail: p.cwd,
    hint: 'проект',
    command: { type: 'page', mode: { page: 'project', cwd: p.cwd, ...withSplit(split) } }
  }
}

function conversationItem(p: Project, c: Conversation, now: number, withProject: boolean, split?: SplitDir): PaletteItem {
  const ago = formatAgo(now - c.mtime)
  return {
    key: `conv:${c.sessionId}`,
    label: c.title,
    detail: withProject ? `${p.name} · ${ago}` : ago,
    hint: 'разговор',
    command: {
      type: 'open',
      req: { cwd: c.cwd, kind: 'claude', claude: 'resume', sessionId: c.sessionId },
      ...withSplit(split)
    }
  }
}

function orderedTabs(d: PaletteData): TabInfo[] {
  const byId = new Map(d.tabs.map((t) => [t.id, t]))
  return panelOrder(d.tabs).flatMap((id) => byId.get(id) ?? [])
}

function commandItems(d: PaletteData): PaletteItem[] {
  const kb = d.config.keybindings
  const item = (key: string, label: string, hint: string, command: PaletteCommand): PaletteItem => ({
    key: `cmd:${key}`,
    label,
    detail: 'команда',
    hint,
    command
  })
  const action = (id: ActionId, label: string) => item(id, label, kb[id], { type: 'action', id })
  const forTab = d.activeTab
    ? [
        item('splitVertical', 'Разделить вертикально…', kb.splitVertical, {
          type: 'page',
          mode: { page: 'split', dir: 'row' }
        }),
        item('splitHorizontal', 'Разделить горизонтально…', kb.splitHorizontal, {
          type: 'page',
          mode: { page: 'split', dir: 'column' }
        }),
        action('toggleConsole', 'Консоль проекта: показать или скрыть'),
        action('search', 'Поиск по выводу'),
        action('rename', 'Переименовать вкладку'),
        action('closeTab', 'Закрыть вкладку')
      ]
    : []
  return [
    item('newTab', 'Новая вкладка…', kb.newTab, { type: 'page', mode: { page: 'new-tab' } }),
    ...forTab,
    action('nextAttention', 'Следующая вкладка, которая ждёт или готова'),
    action('doNotDisturb', d.doNotDisturb ? 'Не беспокоить: выключить' : 'Не беспокоить: включить'),
    item('toggle-sidebar', d.sidebarCollapsed ? 'Развернуть панель' : 'Свернуть панель', '', { type: 'toggle-sidebar' }),
    item('open-config', 'Открыть настройки (config.json)', '', { type: 'open-config' })
  ]
}

function rootItems(d: PaletteData): PaletteItem[] {
  const projects = mergeProjects(d.projects ?? [], d.tabs)
  const conversations = projects
    .flatMap((p) => p.conversations.map((c) => ({ p, c })))
    .sort((a, b) => b.c.mtime - a.c.mtime)
    .slice(0, ROOT_CONVERSATIONS)
  return [
    ...orderedTabs(d).map((t) => tabItem(t, { type: 'show-tab', tab: t.id })),
    ...commandItems(d),
    ...projects.map((p) => projectItem(p)),
    ...conversations.map(({ p, c }) => conversationItem(p, c, d.now, true))
  ]
}

function newTabItems(d: PaletteData, split?: SplitDir): PaletteItem[] {
  const projects = mergeProjects(d.projects ?? [], d.tabs)
  const active = d.tabs.find((t) => t.id === d.activeTab)
  if (active) {
    const key = cwdKey(active.cwd)
    const first = (p: Project) => Number(cwdKey(p.cwd) === key)
    projects.sort((a, b) => first(b) - first(a))
  }
  return [
    {
      key: 'pick-folder',
      label: 'Выбрать папку…',
      detail: 'любая папка на диске',
      hint: '',
      command: { type: 'pick-folder', ...withSplit(split) }
    },
    ...projects.map((p) => projectItem(p, split))
  ]
}

function findProject(d: PaletteData, cwd: string): Project | undefined {
  const key = cwdKey(cwd)
  return mergeProjects(d.projects ?? [], d.tabs).find((p) => cwdKey(p.cwd) === key)
}

function projectItems(d: PaletteData, cwd: string, split?: SplitDir): PaletteItem[] {
  const p = findProject(d, cwd)
  const target = p?.cwd ?? cwd
  const convs = p?.conversations ?? []
  const open = (key: string, label: string, detail: string, req: NewTabRequest): PaletteItem => ({
    key,
    label,
    detail,
    hint: '',
    command: { type: 'open', req, ...withSplit(split) }
  })
  const out = [open('claude-new', 'Claude: новый разговор', p?.name ?? folderName(cwd), { cwd: target, kind: 'claude', claude: 'new' })]
  if (convs.length > 0) {
    out.push(open('claude-continue', 'Claude: продолжить последний', convs[0].title, { cwd: target, kind: 'claude', claude: 'continue' }))
    out.push({
      key: 'claude-pick',
      label: 'Claude: выбрать разговор…',
      detail: `разговоров: ${convs.length}`,
      hint: '',
      command: { type: 'page', mode: { page: 'conversations', cwd: target, ...withSplit(split) } }
    })
  }
  for (const shell of shellNames(d.config)) {
    out.push(open(`shell:${shell}`, `Консоль: ${shell}`, d.config.shells[shell].file, { cwd: target, kind: 'shell', shell }))
  }
  return out
}

function conversationItems(d: PaletteData, cwd: string, split?: SplitDir): PaletteItem[] {
  const p = findProject(d, cwd)
  return p ? p.conversations.map((c) => conversationItem(p, c, d.now, false, split)) : []
}

function splitItems(d: PaletteData, dir: SplitDir): PaletteItem[] {
  const shown = new Set(d.layoutTabs)
  return [
    {
      key: 'split-new',
      label: 'Новая вкладка…',
      detail: 'выбрать проект',
      hint: '',
      command: { type: 'page', mode: { page: 'new-tab', split: dir } }
    },
    ...orderedTabs(d)
      .filter((t) => !shown.has(t.id))
      .map((t) => tabItem(t, { type: 'split-with', tab: t.id, dir }))
  ]
}

function shellItems(d: PaletteData, tab: string): PaletteItem[] {
  return shellNames(d.config).map((shell) => ({
    key: `shell:${shell}`,
    label: shell,
    detail: d.config.shells[shell].file,
    hint: '',
    command: { type: 'set-shell', tab, shell }
  }))
}

export function pageItems(mode: PaletteMode, d: PaletteData): PaletteItem[] {
  switch (mode.page) {
    case 'root':
      return rootItems(d)
    case 'new-tab':
      return newTabItems(d, mode.split)
    case 'project':
      return projectItems(d, mode.cwd, mode.split)
    case 'conversations':
      return conversationItems(d, mode.cwd, mode.split)
    case 'split':
      return splitItems(d, mode.dir)
    case 'shell':
      return shellItems(d, mode.tab)
  }
}

export function pagePlaceholder(mode: PaletteMode): string {
  switch (mode.page) {
    case 'root':
      return 'Вкладки, проекты, разговоры и команды'
    case 'new-tab':
      return mode.split ? 'Проект для второй панели' : 'Новая вкладка: выберите проект'
    case 'project':
      return `Что запустить в ${folderName(mode.cwd)}`
    case 'conversations':
      return `Разговор Claude в ${folderName(mode.cwd)}`
    case 'split':
      return 'Что открыть во второй панели'
    case 'shell':
      return 'Оболочка для вкладки'
  }
}
