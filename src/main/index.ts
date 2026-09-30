import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import { randomBytes } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, release } from 'node:os'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import type { AppConfig, AppState, HookEvent, HooksState, InitData } from '../shared/types'
import { showTab } from '../shared/view'
import { parseSoundSpec } from '../shared/sounds'
import { buildBanners } from './banners'
import { hasHookFlag, parseFolderArg } from './cli'
import { loadConfig, watchConfig } from './config'
import { Controller } from './controller'
import { HookInstaller, isNodeOnPath, resolveHookCommand } from './hook-installer'
import { HookServer } from './hook-server'
import { isTabId, parseNewTabRequest, parseViewState } from './ipc-guards'
import { createLogger } from './log'
import { resolvePaths } from './paths'
import { loadWorkspace, WorkspaceSaver } from './persistence'
import { Notifier } from './notifier'
import { ProjectIndex } from './project-index'
import { PtyManager } from './pty-manager'
import { isSafeExternalUrl } from './security'
import type { Alert } from './session-store'
import { readSoundFile, soundFilePath } from './sound-file'

const paths = resolvePaths({
  isPackaged: app.isPackaged,
  appPath: app.getAppPath(),
  resourcesPath: process.resourcesPath,
  appData: app.getPath('appData'),
  home: homedir(),
  env: process.env
})
// до всего остального: тесты подменяют папку, и блокировка экземпляра берётся по ней
app.setPath('userData', paths.userData)

// Запасной хук без Node (Terminal3000.exe --t3000-hook): без окна и без блокировки экземпляра
if (hasHookFlag(process.argv)) runHook()
else main()

type HookRun = (env: NodeJS.ProcessEnv, stdin: NodeJS.ReadableStream) => Promise<void>

function runHook(): void {
  let run: HookRun = async () => undefined
  try {
    run = (createRequire(__filename)(paths.hookScript) as { run: HookRun }).run
  } catch {
    // скрипта нет — хук ничего не отправит, но выйдет с кодом 0
  }
  // process.stdin в main-процессе Electron на Windows сразу пуст: читаем fd 0 напрямую
  const stdin = createReadStream('', { fd: 0 })
  stdin.on('error', () => undefined)
  run(process.env, stdin)
    .catch(() => undefined)
    .finally(() => app.exit(0))
}

function main(): void {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  app.setAppUserModelId(app.isPackaged ? 'com.st1nkos.terminal3000' : process.execPath)
  // без меню: иначе Ctrl+R у Claude перезагрузит окно
  Menu.setApplicationMenu(null)
  void app
    .whenReady()
    .then(start)
    .catch((e: unknown) => {
      // без окна процесс держал бы блокировку экземпляра, и приложение больше не запускалось бы
      dialog.showErrorBox('Terminal3000 не запустился', e instanceof Error ? e.message : String(e))
      app.exit(1)
    })
}

async function start(): Promise<void> {
  const log = createLogger(paths.logDir)
  log.info(`запуск ${app.getVersion()}`)
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false))

  const welcomeNeeded = !existsSync(paths.configFile)
  const loaded = loadConfig(paths.configFile)
  let config: AppConfig = loaded.config
  // битый файл уже описан баннером broken-config, дублировать его в config-errors не нужно
  let configErrors = loaded.broken ? [] : loaded.errors
  if (loaded.broken) log.warn(`config.json повреждён, сохранён как ${loaded.broken}`)
  let doNotDisturb = config.notifications.doNotDisturb
  let welcome = welcomeNeeded

  const ws = loadWorkspace(paths.workspaceFile)
  if (ws.broken) log.warn(`workspace.json повреждён, сохранён как ${ws.broken}`)

  const token = randomBytes(32).toString('hex')
  let onHook: (ev: HookEvent) => void = () => undefined
  const server = new HookServer({
    token,
    onEvent: (ev) => onHook(ev),
    onError: (e) => log.error('сервер статусов', e)
  })
  let port = 0
  let hookServerFailed = false
  try {
    port = await server.listen()
  } catch (e) {
    hookServerFailed = true
    log.error('сервер статусов не запустился', e)
  }

  const installer = new HookInstaller(
    paths.claudeSettings,
    resolveHookCommand({ nodeAvailable: isNodeOnPath(), scriptPath: paths.hookScript, exePath: process.execPath })
  )
  let hooks: HooksState = installer.status()
  // для баннера «Хуки установлены…»: уже открытые сессии Claude их не видят
  let hooksJustInstalled = false
  const projects = new ProjectIndex(paths.claudeDir)
  const osBuild = Number(release().split('.')[2]) || 0

  let win: BrowserWindow | null = null
  let quitting = false

  const send = (channel: string, ...args: unknown[]): void => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
  }

  // ссылки держим, иначе сборщик мусора уберёт уведомление вместе с обработчиком клика
  const toasts = new Set<Notification>()
  const notifier = new Notifier({
    getConfig: () => config,
    doNotDisturb: () => doNotDisturb,
    windowFocused: () => !!win && win.isFocused(),
    showToast: ({ title, body, onClick }) => {
      if (!Notification.isSupported()) return
      // silent: звук играет сам Terminal3000
      const n = new Notification({ title, body, silent: true })
      toasts.add(n)
      n.on('click', () => {
        toasts.delete(n)
        onClick()
      })
      n.on('close', () => toasts.delete(n))
      n.show()
    },
    flashFrame: () => win?.flashFrame(true),
    playSound: (req) => send(IPC.playSound, req),
    focusTab: (tab) => {
      focusWindow()
      send(IPC.focusTab, tab)
    }
  })
  const onAlert = (alert: Alert): void => {
    // текст Claude в лог не пишем, только вид события
    log.info(`вкладка ${alert.tab}: уведомление ${alert.kind}`)
    notifier.alert(alert)
  }

  const controller: Controller = new Controller({
    getConfig: () => config,
    launch: { port, token, baseEnv: process.env },
    makePty: (cb) => new PtyManager(cb),
    isDir: (p) => {
      try {
        return statSync(p).isDirectory()
      } catch {
        return false
      }
    },
    fileExists: existsSync,
    now: Date.now,
    newId: () => 't_' + randomBytes(4).toString('hex'),
    log,
    onState: () => sendState(),
    onPersist: () => {
      if (!quitting) saver.schedule()
    },
    onData: (tab, seq, data) => send(IPC.ptyData, tab, seq, data),
    onAlert: (alert) => onAlert(alert)
  })
  onHook = (ev) => controller.hook(ev)
  const saver = new WorkspaceSaver(paths.workspaceFile, () => controller.workspace(), (e) => log.error('workspace.json', e))

  const appState = (): AppState => ({
    tabs: controller.tabs(),
    hooks,
    doNotDisturb,
    firstRun: welcome,
    banners: buildBanners({
      hooks,
      firstRun: welcome,
      hooksJustInstalled,
      hookServerFailed,
      configErrors,
      brokenConfig: loaded.broken,
      brokenWorkspace: ws.broken
    })
  })
  // без откладывания: createTab должен разослать новую вкладку раньше, чем ответит на invoke
  function sendState(): void {
    send(IPC.state, appState())
  }

  const focusWindow = (): void => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  // Terminal3000.exe <папка>: консоль в этой папке
  const openFolder = (folder: string): void => {
    const id = controller.createTab({ cwd: folder, kind: 'shell' })
    if (!id) {
      log.warn('папка из командной строки не найдена')
      return
    }
    // окна ещё нет — вид правит main, окно есть — вкладку ставит renderer
    if (win) send(IPC.focusTab, id)
    else controller.updateView(showTab(controller.view(), id))
  }

  controller.restore(ws.workspace)
  const folder = parseFolderArg(process.argv, process.defaultApp === true, process.cwd())
  if (folder) openFolder(folder)

  const silenceTimer = setInterval(() => controller.checkSilence(), 1000)
  const stopWatch = watchConfig(
    paths.configFile,
    () => config,
    (r) => {
      const dndBefore = config.notifications.doNotDisturb
      config = r.config
      configErrors = r.errors
      if (config.notifications.doNotDisturb !== dndBefore) doNotDisturb = config.notifications.doNotDisturb
      log.info(`config.json перечитан, ошибок: ${r.errors.length}`)
      send(IPC.config, config)
      sendState()
    }
  )

  // IPC только от своего окна
  const fromWindow = (e: IpcMainEvent | IpcMainInvokeEvent): boolean => !!win && e.sender === win.webContents
  const on = (channel: string, fn: (...args: unknown[]) => void): void => {
    ipcMain.on(channel, (e, ...args: unknown[]) => {
      if (fromWindow(e)) fn(...args)
    })
  }
  const handle = (channel: string, fn: (...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (e, ...args: unknown[]) => (fromWindow(e) ? fn(...args) : null))
  }
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

  handle(IPC.getInit, (): InitData => ({ state: appState(), config, view: controller.view(), osBuild }))
  handle(IPC.attach, (tab) => (isTabId(tab) ? controller.attach(tab) : { data: '', seq: 0 }))
  on(IPC.input, (tab, data) => {
    if (isTabId(tab) && typeof data === 'string') controller.input(tab, data)
  })
  on(IPC.resize, (tab, cols, rows) => {
    if (isTabId(tab) && isNum(cols) && isNum(rows)) controller.resize(tab, cols, rows)
  })
  handle(IPC.createTab, (raw) => {
    const req = parseNewTabRequest(raw)
    return req ? controller.createTab(req) : null
  })
  on(IPC.closeTab, (tab) => {
    if (isTabId(tab)) controller.closeTab(tab)
  })
  on(IPC.renameTab, (tab, title) => {
    if (isTabId(tab) && typeof title === 'string') controller.renameTab(tab, title.slice(0, 200))
  })
  on(IPC.startTab, (tab, shellName) => {
    if (isTabId(tab) && (shellName === undefined || typeof shellName === 'string')) controller.startTab(tab, shellName)
  })
  on(IPC.setTabCwd, (tab, cwd) => {
    if (isTabId(tab) && typeof cwd === 'string') controller.setTabCwd(tab, cwd)
  })
  on(IPC.updateView, (raw) => {
    const view = parseViewState(raw)
    if (view) controller.updateView(view)
  })
  handle(IPC.listProjects, () => projects.list(config.projectRoots))
  on(IPC.openConfig, () => {
    void shell.openPath(paths.configFile).then((err) => {
      // у .json может не быть программы по умолчанию — тогда показать файл в проводнике
      if (err) shell.showItemInFolder(paths.configFile)
    })
  })
  on(IPC.toggleDoNotDisturb, () => {
    doNotDisturb = !doNotDisturb
    log.info(`не беспокоить: ${doNotDisturb ? 'вкл' : 'выкл'}`)
    sendState()
  })
  handle(IPC.pickFolder, async () => {
    if (!win) return null
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
  // в Electron 44 буфер обмена асинхронный, как navigator.clipboard
  handle(IPC.readClipboard, async () => ({ text: await clipboard.readText(), hasImage: await clipboard.has('image/png') }))
  on(IPC.writeClipboard, (text) => {
    if (typeof text === 'string') void clipboard.writeText(text)
  })
  on(IPC.openExternal, (url) => {
    if (typeof url === 'string' && isSafeExternalUrl(url)) void shell.openExternal(url)
  })
  // Путь к звуку берётся из текущего конфига: renderer не может попросить произвольный файл
  handle(IPC.loadSound, (kind) => {
    if (kind !== 'waiting' && kind !== 'done' && kind !== 'crashed') return null
    const file = soundFilePath(parseSoundSpec(config.sounds[kind]), paths.soundsDir, paths.userData)
    if (!file) return null
    const data = readSoundFile(file)
    if (!data) log.warn(`звук «${kind}»: файл не найден или больше 20 МБ, играет встроенный сигнал`)
    return data
  })
  on(IPC.setBadge, (dataUrl, count) => {
    if (!win || typeof count !== 'number') return
    if (dataUrl === null || count <= 0) {
      win.setOverlayIcon(null, '')
      return
    }
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > 100_000) return
    win.setOverlayIcon(nativeImage.createFromDataURL(dataUrl), `Ждут внимания: ${count}`)
  })

  const setHooks = (next: HooksState, what: string): HooksState => {
    hooks = next
    log.info(`хуки: ${what}, состояние ${next.state}`)
    sendState()
    return next
  }
  handle(IPC.installHooks, () => {
    const next = installer.install()
    hooksJustInstalled = next.state === 'installed'
    return setHooks(next, 'установка')
  })
  handle(IPC.uninstallHooks, () => {
    hooksJustInstalled = false
    return setHooks(installer.uninstall(), 'удаление')
  })
  on(IPC.dismissWelcome, () => {
    welcome = false
    sendState()
  })
  // settings.json могли поправить руками или другой копией приложения
  const refreshHooks = (): void => {
    const next = installer.status()
    if (JSON.stringify(next) === JSON.stringify(hooks)) return
    hooks = next
    if (next.state !== 'installed') hooksJustInstalled = false
    sendState()
  }
  app.on('second-instance', (_e, argv, cwd) => {
    focusWindow()
    const f = parseFolderArg(argv, process.defaultApp === true, cwd)
    if (f) openFolder(f)
  })
  app.on('window-all-closed', () => app.quit())
  const beginQuit = (): void => {
    if (quitting) return
    quitting = true
    clearInterval(silenceTimer)
    stopWatch()
    // сначала запись, потом убийство процессов: их выход не должен попасть в workspace.json
    saver.flush()
    controller.shutdown()
    void server.close()
    log.info('выход')
  }
  app.on('before-quit', beginQuit)

  const createWindow = (): void => {
    const w = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 640,
      minHeight: 400,
      title: 'Terminal3000',
      backgroundColor: '#1e1e1e',
      show: false,
      // в сборке иконку даёт exe, в режиме разработки — файл из build/
      ...(app.isPackaged ? {} : { icon: join(app.getAppPath(), 'build', 'icon.ico') }),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false
      }
    })
    win = w
    w.once('ready-to-show', () => w.show())
    w.on('focus', () => {
      w.flashFrame(false)
      controller.setWindowFocused(true)
      refreshHooks()
    })
    w.on('blur', () => controller.setWindowFocused(false))
    // при выходе из Windows и перезагрузке before-quit не приходит
    w.on('session-end', beginQuit)
    w.on('closed', () => {
      win = null
    })
    const wc = w.webContents
    wc.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    // перетащенный файл или ссылка не должны уводить окно со страницы
    wc.on('will-navigate', (e) => e.preventDefault())
    let reloads: number[] = []
    wc.on('render-process-gone', (_e, details) => {
      log.warn(`renderer завершился: ${details.reason}`)
      if (details.reason === 'clean-exit' || w.isDestroyed()) return
      const now = Date.now()
      reloads = reloads.filter((t) => now - t < 60000)
      if (reloads.length >= 3) {
        log.error('renderer падает слишком часто, перезагрузка остановлена')
        return
      }
      reloads.push(now)
      wc.reload()
    })
    if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(process.env.ELECTRON_RENDERER_URL)
    else void w.loadFile(join(__dirname, '../renderer/index.html'))
  }

  createWindow()
}
