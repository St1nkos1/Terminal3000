import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC, type T3000Api, type Unsubscribe } from '../shared/ipc'

function subscribe<A extends unknown[]>(channel: string, cb: (...args: A) => void): Unsubscribe {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

// Узкий API окна: ничего, кроме этих вызовов, renderer в main не видит
const api: T3000Api = {
  getInit: () => ipcRenderer.invoke(IPC.getInit),
  onState: (cb) => subscribe(IPC.state, cb),
  onConfig: (cb) => subscribe(IPC.config, cb),
  onPtyData: (cb) => subscribe(IPC.ptyData, cb),
  onPlaySound: (cb) => subscribe(IPC.playSound, cb),
  onFocusTab: (cb) => subscribe(IPC.focusTab, cb),
  attach: (tab) => ipcRenderer.invoke(IPC.attach, tab),
  input: (tab, data) => ipcRenderer.send(IPC.input, tab, data),
  resize: (tab, cols, rows) => ipcRenderer.send(IPC.resize, tab, cols, rows),
  createTab: (req) => ipcRenderer.invoke(IPC.createTab, req),
  closeTab: (tab) => ipcRenderer.send(IPC.closeTab, tab),
  renameTab: (tab, title) => ipcRenderer.send(IPC.renameTab, tab, title),
  startTab: (tab, shell) => ipcRenderer.send(IPC.startTab, tab, shell),
  setTabCwd: (tab, cwd) => ipcRenderer.send(IPC.setTabCwd, tab, cwd),
  updateView: (view) => ipcRenderer.send(IPC.updateView, view),
  listProjects: () => ipcRenderer.invoke(IPC.listProjects),
  installHooks: () => ipcRenderer.invoke(IPC.installHooks),
  uninstallHooks: () => ipcRenderer.invoke(IPC.uninstallHooks),
  openConfig: () => ipcRenderer.send(IPC.openConfig),
  toggleDoNotDisturb: () => ipcRenderer.send(IPC.toggleDoNotDisturb),
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),
  readClipboard: () => ipcRenderer.invoke(IPC.readClipboard),
  writeClipboard: (text) => ipcRenderer.send(IPC.writeClipboard, text),
  openExternal: (url) => ipcRenderer.send(IPC.openExternal, url),
  loadSound: (kind) => ipcRenderer.invoke(IPC.loadSound, kind),
  setBadge: (dataUrl, count) => ipcRenderer.send(IPC.setBadge, dataUrl, count),
  dismissWelcome: () => ipcRenderer.send(IPC.dismissWelcome),
  pathForFile: (file) => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('t3000', api)
