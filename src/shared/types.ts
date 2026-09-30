export type TabKind = 'shell' | 'claude'
export type TabStatus =
  | 'sleeping'
  | 'starting'
  | 'idle'
  | 'working'
  | 'waiting'
  | 'done'
  | 'crashed'
  | 'shell'
export type AlertKind = 'waiting' | 'done' | 'crashed'
export type ClaudeStart = 'new' | 'continue' | 'resume'
export type SplitDir = 'row' | 'column'

// То, что сохраняется в workspace.json. Вывод и окружение сюда не попадают никогда.
export interface TabRecord {
  id: string
  title: string
  cwd: string
  kind: TabKind
  shell: string
  claudeSessionId: string | null
  customTitle: boolean
}

export type NoteAction = 'close' | 'pick-folder' | 'pick-shell'

export interface TabNote {
  text: string
  actions: NoteAction[]
}

export interface TabInfo extends TabRecord {
  status: TabStatus
  statusSince: number
  alive: boolean
  note: TabNote | null
}

export type LayoutNode =
  | { type: 'pane'; tab: string }
  | { type: 'split'; dir: SplitDir; sizes: number[]; children: LayoutNode[] }

export interface SidebarState {
  collapsed: boolean
  collapsedGroups: string[]
}

export const EMPTY_SIDEBAR: SidebarState = { collapsed: false, collapsedGroups: [] }

// Размер терминала в символах
export interface TermSize {
  cols: number
  rows: number
}

export interface Workspace {
  version: 1
  tabs: TabRecord[]
  layout: LayoutNode | null
  activeTab: string | null
  sidebar: SidebarState
  // последний размер терминала: с ним стартуют вкладки, которые ещё не показаны
  termSize?: TermSize
}

export interface ViewState {
  layout: LayoutNode | null
  activeTab: string | null
  sidebar: SidebarState
  visibleTabs: string[]
}

export interface HookEvent {
  tab: string
  event: string
  sessionId: string | null
  cwd: string | null
  source: string | null
  reason: string | null
  notificationType: string | null
  message: string | null
  lastAssistantMessage: string | null
  isAgent: boolean
  ts: number
}

export const ACTION_IDS = [
  'palette',
  'newTab',
  'nextTab',
  'prevTab',
  'nextAttention',
  'toggleConsole',
  'splitVertical',
  'splitHorizontal',
  'search',
  'rename',
  'closeTab',
  'doNotDisturb',
  'goToTab1',
  'goToTab2',
  'goToTab3',
  'goToTab4',
  'goToTab5',
  'goToTab6',
  'goToTab7',
  'goToTab8',
  'goToTab9'
] as const

export type ActionId = (typeof ACTION_IDS)[number]

export const DEFAULT_KEYBINDINGS: Record<ActionId, string> = {
  palette: 'Ctrl+Shift+P',
  newTab: 'Ctrl+Shift+T',
  nextTab: 'Ctrl+Tab',
  prevTab: 'Ctrl+Shift+Tab',
  nextAttention: 'Ctrl+Shift+J',
  toggleConsole: 'Ctrl+`',
  splitVertical: 'Ctrl+Shift+\\',
  splitHorizontal: 'Ctrl+Shift+-',
  search: 'Ctrl+Shift+F',
  rename: 'F2',
  closeTab: 'Ctrl+Shift+W',
  doNotDisturb: 'Ctrl+Shift+M',
  goToTab1: 'Ctrl+1',
  goToTab2: 'Ctrl+2',
  goToTab3: 'Ctrl+3',
  goToTab4: 'Ctrl+4',
  goToTab5: 'Ctrl+5',
  goToTab6: 'Ctrl+6',
  goToTab7: 'Ctrl+7',
  goToTab8: 'Ctrl+8',
  goToTab9: 'Ctrl+9'
}

export interface ShellSpec {
  file: string
  args: string[]
}

export interface AppConfig {
  defaultShell: string
  shells: Record<string, ShellSpec>
  claudeCommand: string
  projectRoots: string[]
  restore: 'lazy' | 'eager'
  font: { family: string; size: number }
  scrollback: number
  webgl: boolean
  status: { silenceMs: number }
  notifications: {
    toast: boolean
    flashFrame: boolean
    badge: boolean
    messagePreview: boolean
    doNotDisturb: boolean
  }
  sounds: { volume: number; waiting: string; done: string; crashed: string }
  keybindings: Record<ActionId, string>
}

export interface Conversation {
  sessionId: string
  cwd: string
  title: string
  mtime: number
}

export interface Project {
  cwd: string
  name: string
  lastUsed: number
  conversations: Conversation[]
}

export type HooksState =
  | { state: 'installed' }
  | { state: 'missing' }
  | { state: 'outdated' }
  | { state: 'broken'; path: string; error: string }

export type BannerCommand = 'install-hooks' | 'open-config'

export interface Banner {
  id: string
  level: 'info' | 'warn' | 'error'
  text: string
  action: { label: string; command: BannerCommand } | null
}

export interface AppState {
  tabs: TabInfo[]
  hooks: HooksState
  doNotDisturb: boolean
  firstRun: boolean
  banners: Banner[]
}

export interface NewTabRequest {
  cwd: string
  kind: TabKind
  shell?: string
  claude?: ClaudeStart
  sessionId?: string
  title?: string
}

export interface PlaySoundRequest {
  tab: string
  kind: AlertKind
  spec: string
  volume: number
}

export interface InitData {
  state: AppState
  config: AppConfig
  view: ViewState
  osBuild: number
}
