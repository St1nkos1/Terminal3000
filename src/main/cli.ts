import { win32 } from 'node:path'

// Папка из командной строки: Terminal3000.exe <папка>
export function parseFolderArg(argv: string[], isDefaultApp: boolean, cwd: string): string | null {
  // сначала выкидываем флаги: Playwright и Chromium ставят их и перед путём приложения
  const rest = argv.slice(1).filter((a) => !a.startsWith('-'))
  // в режиме разработки первый аргумент — путь приложения (electron . <папка>)
  if (isDefaultApp) rest.shift()
  return rest.length > 0 ? win32.resolve(cwd, rest[0]) : null
}

export function hasHookFlag(argv: string[]): boolean {
  return argv.includes('--t3000-hook')
}
