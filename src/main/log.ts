import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

// В лог пишутся только события приложения. Вывод терминалов, окружение и текст Claude — никогда
export interface Logger {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string, err?: unknown): void
}

export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
}

function describeError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err)
}

export function createLogger(dir: string, maxBytes = 1024 * 1024): Logger {
  const file = join(dir, 'main.log')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // лог не должен ронять приложение
  }

  const rotate = () => {
    rmSync(join(dir, 'main.2.log'), { force: true })
    try {
      renameSync(join(dir, 'main.1.log'), join(dir, 'main.2.log'))
    } catch {
      // первого архива ещё нет
    }
    renameSync(file, join(dir, 'main.1.log'))
  }

  const write = (level: string, msg: string) => {
    try {
      let size = 0
      try {
        size = statSync(file).size
      } catch {
        size = 0
      }
      if (size >= maxBytes) rotate()
      appendFileSync(file, `${new Date().toISOString()} ${level} ${msg}\n`)
    } catch {
      // диск полон или папка недоступна — работаем без лога
    }
  }

  return {
    info: (msg) => write('INFO', msg),
    warn: (msg) => write('WARN', msg),
    error: (msg, err) => write('ERROR', err === undefined ? msg : `${msg}: ${describeError(err)}`)
  }
}
