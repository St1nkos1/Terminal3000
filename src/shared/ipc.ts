import type {
  AlertKind,
  AppConfig,
  AppState,
  HooksState,
  InitData,
  NewTabRequest,
  PlaySoundRequest,
  Project,
  ViewState
} from './types'

export const IPC = {
  getInit: 't3000:get-init',
  state: 't3000:state',
  config: 't3000:config',
  ptyData: 't3000:pty-data',
  playSound: 't3000:play-sound',
  focusTab: 't3000:focus-tab',
  attach: 't3000:attach',
  input: 't3000:input',
  resize: 't3000:resize',
  createTab: 't3000:create-tab',
  closeTab: 't3000:close-tab',
  renameTab: 't3000:rename-tab',
  startTab: 't3000:start-tab',
  setTabCwd: 't3000:set-tab-cwd',
  updateView: 't3000:update-view',
  listProjects: 't3000:list-projects',
  installHooks: 't3000:install-hooks',
  uninstallHooks: 't3000:uninstall-hooks',
  openConfig: 't3000:open-config',
  toggleDoNotDisturb: 't3000:toggle-dnd',
  pickFolder: 't3000:pick-folder',
  readClipboard: 't3000:read-clipboard',
  writeClipboard: 't3000:write-clipboard',
  openExternal: 't3000:open-external',
  loadSound: 't3000:load-sound',
  setBadge: 't3000:set-badge',
  dismissWelcome: 't3000:dismiss-welcome'
} as const

export type Unsubscribe = () => void

// Всё, что renderer может делать с main. Открыто через contextBridge как window.t3000.
export interface T3000Api {
  getInit(): Promise<InitData>
  onState(cb: (state: AppState) => void): Unsubscribe
  onConfig(cb: (config: AppConfig) => void): Unsubscribe
  onPtyData(cb: (tab: string, seq: number, data: string) => void): Unsubscribe
  onPlaySound(cb: (req: PlaySoundRequest) => void): Unsubscribe
  onFocusTab(cb: (tab: string) => void): Unsubscribe
  attach(tab: string): Promise<{ data: string; seq: number }>
  input(tab: string, data: string): void
  resize(tab: string, cols: number, rows: number): void
  createTab(req: NewTabRequest): Promise<string | null>
  closeTab(tab: string): void
  renameTab(tab: string, title: string): void
  startTab(tab: string, shell?: string): void
  setTabCwd(tab: string, cwd: string): void
  updateView(view: ViewState): void
  listProjects(): Promise<Project[]>
  installHooks(): Promise<HooksState>
  uninstallHooks(): Promise<HooksState>
  openConfig(): void
  toggleDoNotDisturb(): void
  pickFolder(): Promise<string | null>
  readClipboard(): Promise<{ text: string; hasImage: boolean }>
  writeClipboard(text: string): void
  openExternal(url: string): void
  loadSound(kind: AlertKind): Promise<ArrayBuffer | null>
  setBadge(dataUrl: string | null, count: number): void
  dismissWelcome(): void
  pathForFile(file: File): string
}
