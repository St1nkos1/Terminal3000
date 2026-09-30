import { parseSoundSpec } from '../shared/sounds'
import type { AppConfig, PlaySoundRequest } from '../shared/types'
import type { Alert } from './session-store'

export interface Toast {
  title: string
  body: string
  onClick(): void
}

export interface NotifierDeps {
  getConfig(): AppConfig
  doNotDisturb(): boolean
  windowFocused(): boolean
  showToast(t: Toast): void
  flashFrame(): void
  playSound(req: PlaySoundRequest): void
  // развернуть окно и открыть вкладку
  focusTab(tab: string): void
}

// Когда уведомлять, решает SessionStore; здесь — чем уведомлять
export class Notifier {
  constructor(private readonly deps: NotifierDeps) {}

  alert(a: Alert): void {
    // «Не беспокоить»: статусы и бейдж работают, остальное молчит
    if (this.deps.doNotDisturb()) return
    const c = this.deps.getConfig()
    if (c.notifications.toast) {
      this.deps.showToast({ title: a.title, body: a.body, onClick: () => this.deps.focusTab(a.tab) })
    }
    if (c.notifications.flashFrame && !this.deps.windowFocused()) this.deps.flashFrame()
    const spec = c.sounds[a.kind]
    if (c.sounds.volume > 0 && parseSoundSpec(spec).type !== 'none') {
      this.deps.playSound({ tab: a.tab, kind: a.kind, spec, volume: c.sounds.volume })
    }
  }
}
