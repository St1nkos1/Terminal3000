import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe('make-icon', () => {
  it('ICO из PNG всех нужных размеров, картинки распаковываются', () => {
    const out = join(mkdtempSync(join(tmpdir(), 't3000-icon-')), 'icon.ico')
    execFileSync(process.execPath, ['scripts/make-icon.mjs', out])
    const ico = readFileSync(out)
    expect(ico.readUInt16LE(0)).toBe(0)
    expect(ico.readUInt16LE(2)).toBe(1)
    const count = ico.readUInt16LE(4)
    const sizes: number[] = []
    for (let i = 0; i < count; i++) {
      const e = 6 + i * 16
      const size = ico[e] || 256
      const png = ico.subarray(ico.readUInt32LE(e + 12), ico.readUInt32LE(e + 12) + ico.readUInt32LE(e + 8))
      expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
      expect(png.readUInt32BE(16)).toBe(size)
      expect(png.readUInt32BE(20)).toBe(size)
      // первый чанк после IHDR — IDAT: строки по size * 4 + 1 байт
      expect(png.toString('ascii', 37, 41)).toBe('IDAT')
      const idat = png.subarray(41, 41 + png.readUInt32BE(33))
      const raw = inflateSync(idat)
      expect(raw.length).toBe(size * (size * 4 + 1))
      // иконка не пустая: в середине непрозрачные пиксели
      const mid = Math.floor(size / 2) * (size * 4 + 1) + 1 + Math.floor(size / 2) * 4
      expect(raw[mid + 3]).toBe(255)
      sizes.push(size)
    }
    expect(sizes).toEqual([16, 24, 32, 48, 64, 128, 256])
  })
})
