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
import { conversationTab, panelOrder, paneTitle, STATUS_LABEL } from './tab-order'

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
  | { type: 'install-hooks' }
  | { type: 'uninstall-hooks' }

export interface PaletteItem {
  key: string
  label: string
  detail: string
  hint: string
  command: PaletteCommand
}

// Пункт меню группы; command: null — пункт виден, но недоступен
export interface MenuItem {
  key: string
  label: string
  detail: string
  command: PaletteCommand | null
  // линия перед пунктом
  separator?: true
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
  homeDir: string
}

// Сколько прошлых разговоров показывать на главной странице
const ROOT_CONVERSATIONS = 300
// Сколько разговоров проекта показывать в панели под Claude-вкладкой
export const TAB_HISTORY = 10

const CLAUDE_CONTINUE = 'Claude: продолжить последний'
const CLAUDE_PICK = 'Claude: выбрать разговор…'

const withSplit = (split?: SplitDir) => (split ? { split } : {})

// Короткий возраст для панели, где на счету каждый символ: «5 мин», «2 ч», «3 дн»
export function formatAge(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60000)
  if (m < 1) return 'сейчас'
  if (m < 60) return `${m} мин`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ч`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} дн`
  return `${Math.floor(d / 30)} мес`
}

export function formatAgo(ms: number): string {
  return ms < 60000 ? 'только что' : `${formatAge(ms)} назад`
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

// Консоль «вне проектов» — в домашней папке пользователя
function homeConsole(d: PaletteData, key: string, label: string, split?: SplitDir): PaletteItem {
  return {
    key,
    label,
    detail: `~ (${d.homeDir})`,
    hint: d.config.defaultShell,
    command: { type: 'open', req: { cwd: d.homeDir, kind: 'shell' }, ...withSplit(split) }
  }
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
  // в повреждённый settings.json установщик всё равно не пишет, команда не нужна
  const hooks: PaletteItem[] = []
  if (d.hooks.state === 'missing' || d.hooks.state === 'outdated') {
    const label = d.hooks.state === 'outdated' ? 'Обновить хуки Claude Code' : 'Установить хуки Claude Code'
    hooks.push(item('install-hooks', label, '', { type: 'install-hooks' }))
  }
  if (d.hooks.state === 'installed' || d.hooks.state === 'outdated') {
    hooks.push(item('uninstall-hooks', 'Удалить хуки Claude Code', '', { type: 'uninstall-hooks' }))
  }
  return [
    item('newTab', 'Новая вкладка…', kb.newTab, { type: 'page', mode: { page: 'new-tab' } }),
    { ...homeConsole(d, 'cmd:home-console', 'Новая консоль в домашней папке'), detail: 'команда' },
    ...forTab,
    action('nextAttention', 'Следующая вкладка, которая ждёт или готова'),
    action('doNotDisturb', d.doNotDisturb ? 'Не беспокоить: выключить' : 'Не беспокоить: включить'),
    item('toggle-sidebar', d.sidebarCollapsed ? 'Развернуть панель' : 'Свернуть панель', '', { type: 'toggle-sidebar' }),
    ...hooks,
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
    homeConsole(d, 'home-console', 'Консоль', split),
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
    out.push(open('claude-continue', CLAUDE_CONTINUE, convs[0].title, { cwd: target, kind: 'claude', claude: 'continue' }))
    out.push({
      key: 'claude-pick',
      label: CLAUDE_PICK,
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

// Правый клик по группе: то же, что страница проекта в палитре. Без разговоров
// (или пока они читаются) пункты остаются серыми, чтобы меню не прыгало под курсором
export function groupMenuItems(d: PaletteData, cwd: string): MenuItem[] {
  const items = projectItems(d, cwd)
  const toMenu = ({ key, label, detail, command }: PaletteItem): MenuItem => ({ key, label, detail, command })
  const claude = items.filter((i) => !i.key.startsWith('shell:')).map(toMenu)
  if (claude.length === 1) {
    claude.push(
      { key: 'claude-continue', label: CLAUDE_CONTINUE, detail: '', command: null },
      { key: 'claude-pick', label: CLAUDE_PICK, detail: '', command: null }
    )
  }
  const shells = items
    .filter((i) => i.key.startsWith('shell:'))
    .map((i, n): MenuItem => (n === 0 ? { ...toMenu(i), separator: true } : toMenu(i)))
  return [...claude, ...shells]
}

export interface TabHistory {
  // openIn — вкладка, где разговор уже открыт
  items: { conversation: Conversation; openIn: string | null }[]
  // разговоров в проекте: столько покажет страница палитры
  total: number
  // в панель поместились не все
  more: boolean
}

// Прошлые разговоры проекта под Claude-вкладкой, свежие первыми, без её собственного
export function tabHistory(tab: TabInfo, projects: Project[], tabs: TabInfo[]): TabHistory {
  const key = cwdKey(tab.cwd)
  const all = projects.find((p) => cwdKey(p.cwd) === key)?.conversations ?? []
  const others = all.filter((c) => c.sessionId !== tab.claudeSessionId)
  return {
    items: others.slice(0, TAB_HISTORY).map((c) => ({ conversation: c, openIn: conversationTab(tabs, c.sessionId)?.id ?? null })),
    total: all.length,
    more: others.length > TAB_HISTORY
  }
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
