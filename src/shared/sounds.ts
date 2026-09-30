export type BuiltinSound = 'faceit' | 'alert' | 'chime' | 'low'

export type SoundSpec = { type: 'none' } | { type: 'builtin'; name: BuiltinSound } | { type: 'file'; path: string }

export const FACEIT_FILE = 'faceit-accept.mp3'

const BUILTINS: readonly BuiltinSound[] = ['faceit', 'alert', 'chime', 'low']

// Значение sounds.waiting / done / crashed из config.json
export function parseSoundSpec(spec: string): SoundSpec {
  const s = spec.trim()
  if (s === '' || s.toLowerCase() === 'none') return { type: 'none' }
  if (s.toLowerCase().startsWith('builtin:')) {
    const name = s.slice('builtin:'.length).toLowerCase()
    // неизвестный встроенный звук играет как alert
    const known = BUILTINS.find((b) => b === name)
    return { type: 'builtin', name: known ?? 'alert' }
  }
  return { type: 'file', path: s }
}
