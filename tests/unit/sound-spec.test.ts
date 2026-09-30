import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readSoundFile, soundFilePath } from '../../src/main/sound-file'
import { parseSoundSpec } from '../../src/shared/sounds'

describe('parseSoundSpec', () => {
  it('встроенные, свои файлы и отключение', () => {
    expect(parseSoundSpec('')).toEqual({ type: 'none' })
    expect(parseSoundSpec(' none ')).toEqual({ type: 'none' })
    expect(parseSoundSpec('builtin:faceit')).toEqual({ type: 'builtin', name: 'faceit' })
    expect(parseSoundSpec('BUILTIN:Chime')).toEqual({ type: 'builtin', name: 'chime' })
    expect(parseSoundSpec('builtin:siren')).toEqual({ type: 'builtin', name: 'alert' })
    expect(parseSoundSpec('sounds/custom/ding.mp3')).toEqual({ type: 'file', path: 'sounds/custom/ding.mp3' })
    expect(parseSoundSpec('D:\\Звуки\\ding.wav')).toEqual({ type: 'file', path: 'D:\\Звуки\\ding.wav' })
  })
})

describe('soundFilePath', () => {
  const sounds = join('C:', 'app', 'sounds')
  const data = join('C:', 'Users', 'u', 'AppData', 'Roaming', 'Terminal3000')

  it('faceit — из папки звуков приложения, свои — от папки данных', () => {
    expect(soundFilePath({ type: 'builtin', name: 'faceit' }, sounds, data)).toBe(join(sounds, 'faceit-accept.mp3'))
    expect(soundFilePath({ type: 'file', path: 'sounds/custom/ding.mp3' }, sounds, data)).toBe(
      join(data, 'sounds/custom/ding.mp3')
    )
    expect(soundFilePath({ type: 'file', path: 'D:\\ding.wav' }, sounds, data)).toBe('D:\\ding.wav')
  })

  it('синтезированным звукам и «без звука» файл не нужен', () => {
    expect(soundFilePath({ type: 'builtin', name: 'low' }, sounds, data)).toBeNull()
    expect(soundFilePath({ type: 'none' }, sounds, data)).toBeNull()
  })
})

describe('readSoundFile', () => {
  it('читает файл целиком, пропавший или слишком большой — null', () => {
    const dir = mkdtempSync(join(tmpdir(), 't3000-sound-'))
    const file = join(dir, 'a.mp3')
    writeFileSync(file, Buffer.from([1, 2, 3, 4, 5]))
    const data = readSoundFile(file)
    expect(data).toBeInstanceOf(ArrayBuffer)
    expect([...new Uint8Array(data!)]).toEqual([1, 2, 3, 4, 5])
    expect(readSoundFile(join(dir, 'нет.mp3'))).toBeNull()
    expect(readSoundFile(file, 4)).toBeNull()
  })
})
