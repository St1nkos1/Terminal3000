import { statSync } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { cwdKey, folderName, truncate } from '../shared/text'
import type { Conversation, Project } from '../shared/types'

export const HEAD_BYTES = 64 * 1024
export const NO_PROMPT = '(без запроса)'

const SESSION_FILE = /^([A-Za-z0-9_.-]{1,200})\.jsonl$/
const SERVICE_PREFIXES = ['<command-name', '<command-message', '<local-command', '<system-reminder']

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

function promptText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b) => isObj(b) && b.type === 'text' && typeof b.text === 'string')
    .map((b) => (b as Obj).text as string)
    .join(' ')
}

export function parseConversationHead(text: string): { cwd: string | null; firstPrompt: string } {
  let cwd: string | null = null
  let firstPrompt: string | null = null
  for (const raw of text.split('\n')) {
    if (cwd !== null && firstPrompt !== null) break
    let o: unknown
    try {
      o = JSON.parse(raw)
    } catch {
      continue
    }
    if (!isObj(o)) continue
    if (cwd === null && typeof o.cwd === 'string' && o.cwd.length > 0) cwd = o.cwd
    if (firstPrompt !== null || o.type !== 'user' || o.isMeta === true || !isObj(o.message)) continue
    const prompt = promptText(o.message.content).replace(/\s+/g, ' ').trim()
    if (prompt && !SERVICE_PREFIXES.some((p) => prompt.startsWith(p))) firstPrompt = truncate(prompt, 80)
  }
  return { cwd, firstPrompt: firstPrompt ?? NO_PROMPT }
}

async function readHead(file: string): Promise<string> {
  const fh = await open(file, 'r')
  try {
    const buf = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0)
    return buf.subarray(0, bytesRead).toString('utf8')
  } finally {
    await fh.close()
  }
}

function isDirSync(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

interface CacheEntry {
  mtime: number
  size: number
  cwd: string | null
  title: string
}

export class ProjectIndex {
  private readonly cache = new Map<string, CacheEntry>()

  constructor(
    private readonly claudeDir: string,
    private readonly isDir: (p: string) => boolean = isDirSync
  ) {}

  async list(projectRoots: string[]): Promise<Project[]> {
    const conversations = (await this.conversations()).sort((a, b) => b.mtime - a.mtime)
    const byKey = new Map<string, Project>()
    const project = (cwd: string): Project => {
      const key = cwdKey(cwd)
      let p = byKey.get(key)
      if (!p) {
        p = { cwd, name: folderName(cwd), lastUsed: 0, conversations: [] }
        byKey.set(key, p)
      }
      return p
    }
    // Разговоры уже отсортированы, поэтому cwd проекта берётся из самого свежего
    for (const c of conversations) {
      const p = project(c.cwd)
      p.conversations.push(c)
      p.lastUsed = Math.max(p.lastUsed, c.mtime)
    }
    for (const root of projectRoots) {
      try {
        for (const e of await readdir(root, { withFileTypes: true })) {
          if (e.isDirectory() && !e.name.startsWith('.')) project(join(root, e.name))
        }
      } catch {
        // Папки из projectRoots может не быть
      }
    }
    return [...byKey.values()]
      .filter((p) => this.isDir(p.cwd))
      .sort((a, b) => b.lastUsed - a.lastUsed || a.name.localeCompare(b.name))
  }

  private async conversations(): Promise<Conversation[]> {
    const root = join(this.claudeDir, 'projects')
    let dirs: string[]
    try {
      dirs = await readdir(root)
    } catch {
      this.cache.clear()
      return []
    }
    const seen = new Set<string>()
    const out: Conversation[] = []
    for (const dir of dirs) {
      let names: string[]
      try {
        names = await readdir(join(root, dir))
      } catch {
        continue // не папка
      }
      const found = await Promise.all(
        names.map(async (name) => {
          const m = SESSION_FILE.exec(name)
          if (!m) return null
          const file = join(root, dir, name)
          seen.add(file)
          const entry = await this.read(file)
          return entry?.cwd ? { sessionId: m[1], cwd: entry.cwd, title: entry.title, mtime: entry.mtime } : null
        })
      )
      for (const c of found) if (c) out.push(c)
    }
    for (const file of this.cache.keys()) if (!seen.has(file)) this.cache.delete(file)
    return out
  }

  private async read(file: string): Promise<CacheEntry | null> {
    try {
      const st = await stat(file)
      if (!st.isFile()) return null
      const cached = this.cache.get(file)
      if (cached && cached.mtime === st.mtimeMs && cached.size === st.size) return cached
      const { cwd, firstPrompt } = parseConversationHead(await readHead(file))
      const entry = { mtime: st.mtimeMs, size: st.size, cwd, title: firstPrompt }
      this.cache.set(file, entry)
      return entry
    } catch {
      return null // файл удалили между readdir и чтением
    }
  }
}
