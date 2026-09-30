// ё и е не различаем: в названиях разговоров бывает и так, и так
function norm(s: string): string {
  return s.toLocaleLowerCase('ru').replace(/ё/g, 'е')
}

const SEPARATOR = /[\s/\\\-_.·:,()[\]]/

// Начало слова: после разделителя или заглавная после строчной (SoundBox)
function isBoundary(orig: string, i: number): boolean {
  if (i === 0) return true
  const prev = orig[i - 1]
  if (SEPARATOR.test(prev)) return true
  const cur = orig[i]
  return cur !== cur.toLowerCase() && prev === prev.toLowerCase() && prev !== prev.toUpperCase()
}

function boundaryIndex(t: string, orig: string, ch: string, from: number): number {
  for (let i = t.indexOf(ch, from); i >= 0; i = t.indexOf(ch, i + 1)) {
    if (isBoundary(orig, i)) return i
  }
  return -1
}

function scoreFrom(q: string, t: string, orig: string, preferBoundary: boolean): number | null {
  let score = 0
  let from = 0
  let prev = -2
  for (const ch of q) {
    let i = preferBoundary ? boundaryIndex(t, orig, ch, from) : -1
    if (i < 0) i = t.indexOf(ch, from)
    if (i < 0) return null
    score += 1
    if (i === prev + 1) score += 5
    if (isBoundary(orig, i)) score += 8
    score -= Math.min(i - from, 10) * 0.2
    prev = i
    from = i + 1
  }
  return score
}

export function fuzzyScore(query: string, text: string): number | null {
  const q = norm(query).replace(/\s+/g, '')
  if (!q) return 0
  const t = norm(text)
  // жадный поиск с началами слов и без них: берём лучший из двух
  const a = scoreFrom(q, t, text, true)
  const b = scoreFrom(q, t, text, false)
  if (a === null && b === null) return null
  let best = Math.max(a ?? -Infinity, b ?? -Infinity)
  if (t.includes(q)) best += 10
  // при прочих равных короче — лучше
  return best - t.length * 0.01
}

export function fuzzyFilter<T>(items: T[], query: string, text: (item: T) => string): T[] {
  if (!query.trim()) return items
  return items
    .map((item, i) => ({ item, i, score: fuzzyScore(query, text(item)) }))
    .filter((r): r is { item: T; i: number; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((r) => r.item)
}
