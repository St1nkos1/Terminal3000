import { parseSoundSpec } from '../shared/sounds'
import type { AlertKind, PlaySoundRequest } from '../shared/types'

// Время в секундах от начала звука
export interface Note {
  freq: number
  start: number
  duration: number
}

// Встроенные сигналы без файлов
export const SYNTH: Record<'alert' | 'chime' | 'low', Note[]> = {
  alert: [
    { freq: 880, start: 0, duration: 0.15 },
    { freq: 880, start: 0.2, duration: 0.15 },
    { freq: 1175, start: 0.4, duration: 0.3 }
  ],
  chime: [
    { freq: 1047, start: 0, duration: 0.6 },
    { freq: 1319, start: 0.12, duration: 0.6 },
    { freq: 1568, start: 0.24, duration: 0.9 }
  ],
  low: [
    { freq: 220, start: 0, duration: 0.35 },
    { freq: 165, start: 0.3, duration: 0.6 }
  ]
}

export interface Playing {
  stop(): void
}

export interface SoundBackend {
  playBuffer(data: ArrayBuffer, volume: number): Promise<Playing>
  playNotes(notes: Note[], volume: number): Playing
}

// Один звук за раз; обрывается новым звуком или когда открыли его вкладку
export class SoundPlayer {
  // растёт при каждой остановке: звук, который ещё грузился, после этого не играет
  private token = 0
  private tab: string | null = null
  private playing: Playing | null = null
  private readonly cache = new Map<string, ArrayBuffer | null>()

  constructor(
    private readonly backend: SoundBackend,
    private readonly load: (kind: AlertKind) => Promise<ArrayBuffer | null>
  ) {}

  async play(req: PlaySoundRequest): Promise<void> {
    this.stop()
    const spec = parseSoundSpec(req.spec)
    if (spec.type === 'none' || req.volume <= 0) return
    const my = this.token
    this.tab = req.tab
    if (spec.type === 'builtin' && spec.name !== 'faceit') {
      this.playing = this.backend.playNotes(SYNTH[spec.name], req.volume)
      return
    }
    const key = `${req.kind}|${req.spec}`
    let data = this.cache.get(key)
    if (data === undefined) {
      data = await this.load(req.kind)
      this.cache.set(key, data)
    }
    if (my !== this.token) return
    let playing: Playing | null = null
    if (data) {
      try {
        // decodeAudioData забирает буфер, в кеше оставляем копию
        playing = await this.backend.playBuffer(data.slice(0), req.volume)
      } catch {
        playing = null
      }
    }
    if (my !== this.token) {
      playing?.stop()
      return
    }
    // файла нет или он не декодируется — встроенный сигнал
    this.playing = playing ?? this.backend.playNotes(SYNTH.alert, req.volume)
  }

  stop(): void {
    this.token++
    this.playing?.stop()
    this.playing = null
    this.tab = null
  }

  stopFor(visibleTabs: readonly string[], focused: boolean): void {
    if (this.tab && focused && visibleTabs.includes(this.tab)) this.stop()
  }

  // config.json поменялся — файлы звуков могли стать другими
  clearCache(): void {
    this.cache.clear()
  }
}

export class WebAudioBackend implements SoundBackend {
  private ctx: AudioContext | null = null

  async playBuffer(data: ArrayBuffer, volume: number): Promise<Playing> {
    const ctx = this.context()
    const buffer = await ctx.decodeAudioData(data)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const gain = ctx.createGain()
    gain.gain.value = volume
    src.connect(gain).connect(ctx.destination)
    src.start()
    return {
      stop: () => {
        try {
          src.stop()
        } catch {
          // уже доиграл
        }
      }
    }
  }

  playNotes(notes: Note[], volume: number): Playing {
    const ctx = this.context()
    const t0 = ctx.currentTime + 0.01
    const oscs = notes.map((n) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = n.freq
      // короткая атака и затухание, чтобы не щёлкало
      gain.gain.setValueAtTime(0, t0 + n.start)
      gain.gain.linearRampToValueAtTime(volume * 0.4, t0 + n.start + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.start + n.duration)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0 + n.start)
      osc.stop(t0 + n.start + n.duration + 0.05)
      return osc
    })
    return {
      stop: () => {
        for (const o of oscs) {
          try {
            o.stop()
          } catch {
            // уже доиграл
          }
        }
      }
    }
  }

  private context(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext()
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }
}
