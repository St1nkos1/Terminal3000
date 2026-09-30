import { readFileSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { FACEIT_FILE, type SoundSpec } from '../shared/sounds'

export const MAX_SOUND_BYTES = 20 * 1024 * 1024

// Путь к файлу звука; относительный путь пользователя — от %APPDATA%\Terminal3000
export function soundFilePath(spec: SoundSpec, soundsDir: string, userData: string): string | null {
  if (spec.type === 'builtin') return spec.name === 'faceit' ? join(soundsDir, FACEIT_FILE) : null
  if (spec.type === 'file') return isAbsolute(spec.path) ? spec.path : join(userData, spec.path)
  return null
}

export function readSoundFile(file: string, maxBytes = MAX_SOUND_BYTES): ArrayBuffer | null {
  try {
    if (statSync(file).size > maxBytes) return null
    const buf = readFileSync(file)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  } catch {
    return null
  }
}
