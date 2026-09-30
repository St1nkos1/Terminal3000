import { describe, expect, it } from 'vitest'
import { SoundPlayer, SYNTH, type Note, type SoundBackend } from '../../src/renderer/sounds'
import type { AlertKind, PlaySoundRequest } from '../../src/shared/types'

function setup(files: Partial<Record<AlertKind, ArrayBuffer | null>> = {}) {
  const log: string[] = []
  const loads: AlertKind[] = []
  const backend: SoundBackend = {
    playBuffer: async (data, volume) => {
      // пустой буфер изображает файл, который не декодируется
      if (data.byteLength === 0) throw new Error('decode')
      log.push(`file:${data.byteLength}@${volume}`)
      return { stop: () => log.push('stop') }
    },
    playNotes: (notes: Note[], volume) => {
      log.push(`notes:${notes[0].freq}@${volume}`)
      return { stop: () => log.push('stop') }
    }
  }
  const player = new SoundPlayer(backend, async (kind) => {
    loads.push(kind)
    return files[kind] ?? null
  })
  return { player, log, loads }
}

const req = (tab: string, kind: AlertKind, spec: string, volume = 0.5): PlaySoundRequest => ({ tab, kind, spec, volume })
const alertFreq = SYNTH.alert[0].freq

describe('SoundPlayer', () => {
  it('синтезированный звук играет без обращения к main', async () => {
    const { player, log, loads } = setup()
    await player.play(req('t1', 'crashed', 'builtin:low'))
    expect(log).toEqual([`notes:${SYNTH.low[0].freq}@0.5`])
    expect(loads).toEqual([])
  })

  it('faceit и свои файлы грузятся через main один раз', async () => {
    const { player, log, loads } = setup({ waiting: new ArrayBuffer(8) })
    await player.play(req('t1', 'waiting', 'builtin:faceit'))
    await player.play(req('t2', 'waiting', 'builtin:faceit'))
    expect(loads).toEqual(['waiting'])
    expect(log).toEqual(['file:8@0.5', 'stop', 'file:8@0.5'])
    player.clearCache()
    await player.play(req('t1', 'waiting', 'builtin:faceit'))
    expect(loads).toEqual(['waiting', 'waiting'])
  })

  it('новый звук обрывает предыдущий', async () => {
    const { player, log } = setup()
    await player.play(req('t1', 'waiting', 'builtin:chime'))
    await player.play(req('t2', 'crashed', 'builtin:low'))
    expect(log).toEqual([`notes:${SYNTH.chime[0].freq}@0.5`, 'stop', `notes:${SYNTH.low[0].freq}@0.5`])
  })

  it('файла нет или он не декодируется — играет alert', async () => {
    const { player, log } = setup({ done: new ArrayBuffer(0) })
    await player.play(req('t1', 'waiting', 'D:\\нет.mp3'))
    await player.play(req('t1', 'done', 'builtin:faceit'))
    expect(log).toEqual([`notes:${alertFreq}@0.5`, 'stop', `notes:${alertFreq}@0.5`])
  })

  it('звук обрывается, когда его вкладку открыли в активном окне', async () => {
    const { player, log } = setup()
    await player.play(req('t1', 'waiting', 'builtin:alert'))
    player.stopFor(['t1'], false)
    player.stopFor(['t2'], true)
    expect(log).toEqual([`notes:${alertFreq}@0.5`])
    player.stopFor(['t2', 't1'], true)
    expect(log).toEqual([`notes:${alertFreq}@0.5`, 'stop'])
  })

  it('остановили, пока файл грузился, — звук не играет', async () => {
    const log: string[] = []
    let release: (b: ArrayBuffer) => void = () => undefined
    const player = new SoundPlayer(
      {
        playBuffer: async () => {
          log.push('file')
          return { stop: () => log.push('stop') }
        },
        playNotes: () => {
          log.push('notes')
          return { stop: () => log.push('stop') }
        }
      },
      () => new Promise<ArrayBuffer>((r) => (release = r))
    )
    const playing = player.play(req('t1', 'waiting', 'builtin:faceit'))
    player.stopFor(['t1'], true)
    release(new ArrayBuffer(4))
    await playing
    expect(log).toEqual([])
  })

  it('без звука и с нулевой громкостью ничего не играет', async () => {
    const { player, log, loads } = setup()
    await player.play(req('t1', 'waiting', 'none'))
    await player.play(req('t1', 'waiting', 'builtin:alert', 0))
    expect(log).toEqual([])
    expect(loads).toEqual([])
  })
})
