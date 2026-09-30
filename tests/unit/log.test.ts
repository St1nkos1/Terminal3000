import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLogger } from '../../src/main/log'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 't3000-log-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('log', () => {
  it('пишет строки с уровнем и создаёт папку', () => {
    const logDir = join(dir, 'logs')
    const log = createLogger(logDir)
    log.info('tab t_1 started')
    log.error('spawn failed', new Error('ENOENT'))
    const text = readFileSync(join(logDir, 'main.log'), 'utf8')
    expect(text).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z INFO tab t_1 started\n/)
    expect(text).toContain('ERROR spawn failed: Error: ENOENT')
  })

  it('ротация: не больше трёх файлов', () => {
    const log = createLogger(dir, 200)
    for (let i = 0; i < 40; i++) log.info(`line ${i} ${'x'.repeat(40)}`)
    expect(existsSync(join(dir, 'main.log'))).toBe(true)
    expect(existsSync(join(dir, 'main.1.log'))).toBe(true)
    expect(existsSync(join(dir, 'main.2.log'))).toBe(true)
    expect(existsSync(join(dir, 'main.3.log'))).toBe(false)
    expect(readFileSync(join(dir, 'main.log'), 'utf8')).toContain('line 39')
  })

  it('ошибка записи не бросает исключение', () => {
    writeFileSync(join(dir, 'file'), 'x')
    const log = createLogger(join(dir, 'file', 'logs'))
    expect(() => log.warn('x')).not.toThrow()
  })
})
