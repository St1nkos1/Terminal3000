// Рисует иконку Terminal3000 и пакует её в build/icon.ico без зависимостей.
// Запуск: npm run icon (или node scripts/make-icon.mjs <путь>)
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const SIZES = [16, 24, 32, 48, 64, 128, 256]
const BG = [37, 37, 38]
const ACCENT = [58, 95, 138]
const LIGHT = [212, 212, 212]
const YELLOW = [229, 192, 123]

// Расстояние до отрезка ab
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}

// Меньше нуля — внутри скруглённого квадрата
function roundedRectDist(u, v) {
  const half = 0.44
  const r = 0.2
  const cx = Math.abs(u - 0.5) - (half - r)
  const cy = Math.abs(v - 0.5) - (half - r)
  return Math.hypot(Math.max(cx, 0), Math.max(cy, 0)) + Math.min(Math.max(cx, cy), 0) - r
}

// Тёмный квадрат с рамкой, приглашение «>_» и жёлтая точка статуса «ждёт»
function colorAt(u, v) {
  if (Math.hypot(u - 0.72, v - 0.3) < 0.085) return YELLOW
  const chevron = Math.min(segDist(u, v, 0.28, 0.36, 0.45, 0.5), segDist(u, v, 0.45, 0.5, 0.28, 0.64)) < 0.045
  const underscore = u > 0.52 && u < 0.74 && v > 0.6 && v < 0.67
  if (chevron || underscore) return LIGHT
  const d = roundedRectDist(u, v)
  if (d > 0) return null
  return d > -0.035 ? ACCENT : BG
}

// RGBA без premultiply, 4×4 субпикселя на пиксель для сглаживания
function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const S = 4
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let hits = 0
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const c = colorAt((x + (sx + 0.5) / S) / size, (y + (sy + 0.5) / S) / size)
          if (!c) continue
          r += c[0]
          g += c[1]
          b += c[2]
          hits++
        }
      }
      const i = (y * size + x) * 4
      if (hits > 0) {
        rgba[i] = Math.round(r / hits)
        rgba[i + 1] = Math.round(g / hits)
        rgba[i + 2] = Math.round(b / hits)
      }
      rgba[i + 3] = Math.round((hits / (S * S)) * 255)
    }
  }
  return rgba
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // бит на канал
  ihdr[9] = 6 // RGBA
  const stride = size * 4 + 1
  const raw = Buffer.alloc(size * stride)
  for (let y = 0; y < size; y++) rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ICO с PNG внутри: Windows Vista и новее понимают такие записи любого размера
function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const dir = Buffer.alloc(16 * images.length)
  let offset = header.length + dir.length
  images.forEach((img, i) => {
    const e = i * 16
    dir[e] = img.size >= 256 ? 0 : img.size
    dir[e + 1] = img.size >= 256 ? 0 : img.size
    dir.writeUInt16LE(1, e + 4)
    dir.writeUInt16LE(32, e + 6)
    dir.writeUInt32LE(img.data.length, e + 8)
    dir.writeUInt32LE(offset, e + 12)
    offset += img.data.length
  })
  return Buffer.concat([header, dir, ...images.map((img) => img.data)])
}

const out = process.argv[2] ?? fileURLToPath(new URL('../build/icon.ico', import.meta.url))
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, buildIco(SIZES.map((size) => ({ size, data: encodePng(size, renderIcon(size)) }))))
console.log(`иконка: ${out}`)
