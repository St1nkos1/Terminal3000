import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../src/main/config'
import { Notifier, type Toast } from '../../src/main/notifier'
import type { Alert } from '../../src/main/session-store'
import type { AppConfig, PlaySoundRequest } from '../../src/shared/types'

function setup(o: { config?: (c: AppConfig) => void; dnd?: boolean; focused?: boolean } = {}) {
  const config = structuredClone(DEFAULT_CONFIG)
  o.config?.(config)
  const calls = { toasts: [] as Toast[], flashes: 0, sounds: [] as PlaySoundRequest[], focused: [] as string[] }
  const notifier = new Notifier({
    getConfig: () => config,
    doNotDisturb: () => o.dnd ?? false,
    windowFocused: () => o.focused ?? false,
    showToast: (t) => calls.toasts.push(t),
    flashFrame: () => {
      calls.flashes++
    },
    playSound: (req) => calls.sounds.push(req),
    focusTab: (tab) => calls.focused.push(tab)
  })
  return { notifier, calls }
}

const waiting: Alert = { tab: 't1', kind: 'waiting', title: 'MyWebShop · ждёт разрешения', body: 'Allow Bash: npm test?' }
const crashed: Alert = { tab: 't2', kind: 'crashed', title: 'Data · упала', body: 'Claude завершился с кодом 1' }

describe('Notifier', () => {
  it('окно не в фокусе: уведомление, мигание и звук; клик открывает вкладку', () => {
    const { notifier, calls } = setup()
    notifier.alert(waiting)
    expect(calls.toasts.map((t) => [t.title, t.body])).toEqual([[waiting.title, waiting.body]])
    expect(calls.flashes).toBe(1)
    expect(calls.sounds).toEqual([{ tab: 't1', kind: 'waiting', spec: 'builtin:faceit', volume: 0.8 }])
    calls.toasts[0].onClick()
    expect(calls.focused).toEqual(['t1'])
  })

  it('окно в фокусе, но вкладку не видно: без мигания', () => {
    const { notifier, calls } = setup({ focused: true })
    notifier.alert(waiting)
    expect(calls.toasts).toHaveLength(1)
    expect(calls.flashes).toBe(0)
    expect(calls.sounds).toHaveLength(1)
  })

  it('звук берётся по виду события', () => {
    const { notifier, calls } = setup()
    notifier.alert(crashed)
    expect(calls.sounds).toEqual([{ tab: 't2', kind: 'crashed', spec: 'builtin:low', volume: 0.8 }])
  })

  it('«Не беспокоить» глушит уведомление, мигание и звук', () => {
    const { notifier, calls } = setup({ dnd: true })
    notifier.alert(waiting)
    expect(calls).toEqual({ toasts: [], flashes: 0, sounds: [], focused: [] })
  })

  it('флаги конфига и отключённый звук', () => {
    const { notifier, calls } = setup({
      config: (c) => {
        c.notifications.toast = false
        c.notifications.flashFrame = false
        c.sounds.waiting = 'none'
        c.sounds.crashed = ''
      }
    })
    notifier.alert(waiting)
    notifier.alert(crashed)
    expect(calls).toEqual({ toasts: [], flashes: 0, sounds: [], focused: [] })

    const quiet = setup({ config: (c) => (c.sounds.volume = 0) })
    quiet.notifier.alert(waiting)
    expect(quiet.calls.sounds).toEqual([])
    expect(quiet.calls.toasts).toHaveLength(1)
  })
})
