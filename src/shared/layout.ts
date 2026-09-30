import type { LayoutNode, SplitDir } from './types'

export function pane(tab: string): LayoutNode {
  return { type: 'pane', tab }
}

export function layoutTabs(node: LayoutNode | null): string[] {
  if (!node) return []
  if (node.type === 'pane') return [node.tab]
  return node.children.flatMap(layoutTabs)
}

export function containsTab(node: LayoutNode | null, tab: string): boolean {
  return layoutTabs(node).includes(tab)
}

export function replaceTab(node: LayoutNode, from: string, to: string): LayoutNode {
  if (node.type === 'pane') return node.tab === from ? pane(to) : node
  return { ...node, children: node.children.map((c) => replaceTab(c, from, to)) }
}

export function removeTab(node: LayoutNode | null, tab: string): LayoutNode | null {
  if (!node) return null
  if (node.type === 'pane') return node.tab === tab ? null : node
  const kept: LayoutNode[] = []
  const sizes: number[] = []
  node.children.forEach((child, i) => {
    const r = removeTab(child, tab)
    if (r) {
      kept.push(r)
      sizes.push(node.sizes[i] ?? 0)
    }
  })
  if (kept.length === 0) return null
  if (kept.length === 1) return kept[0]
  return { ...node, children: kept, sizes: normalizeSizes(sizes, kept.length) }
}

export function splitTab(node: LayoutNode, target: string, tab: string, dir: SplitDir): LayoutNode {
  if (node.type === 'pane') {
    return node.tab === target ? { type: 'split', dir, sizes: [0.5, 0.5], children: [node, pane(tab)] } : node
  }
  return { ...node, children: node.children.map((c) => splitTab(c, target, tab, dir)) }
}

// path — индексы детей от корня до нужного split-узла
export function setSizes(node: LayoutNode, path: number[], sizes: number[]): LayoutNode {
  if (node.type === 'pane') return node
  if (path.length === 0) {
    return sizes.length === node.children.length ? { ...node, sizes: normalizeSizes(sizes, sizes.length) } : node
  }
  const [i, ...rest] = path
  return { ...node, children: node.children.map((c, j) => (j === i ? setSizes(c, rest, sizes) : c)) }
}

export function normalizeSizes(sizes: number[], n: number): number[] {
  const valid = sizes.length === n && sizes.every((s) => Number.isFinite(s) && s > 0)
  if (!valid) return Array.from({ length: n }, () => 1 / n)
  const sum = sizes.reduce((a, b) => a + b, 0)
  return sizes.map((s) => s / sum)
}

// Приводит сырое дерево из workspace.json к корректному виду
export function normalizeLayout(raw: unknown, known: ReadonlySet<string>): LayoutNode | null {
  const seen = new Set<string>()
  const walk = (n: unknown): LayoutNode | null => {
    if (!n || typeof n !== 'object') return null
    const o = n as Record<string, unknown>
    if (o.type === 'pane') {
      if (typeof o.tab !== 'string' || !known.has(o.tab) || seen.has(o.tab)) return null
      seen.add(o.tab)
      return pane(o.tab)
    }
    if (o.type !== 'split' || (o.dir !== 'row' && o.dir !== 'column') || !Array.isArray(o.children)) return null
    const rawSizes: unknown[] = Array.isArray(o.sizes) ? o.sizes : []
    const kids: LayoutNode[] = []
    const sizes: number[] = []
    o.children.forEach((child, i) => {
      const r = walk(child)
      if (r) {
        kids.push(r)
        const s = rawSizes[i]
        sizes.push(typeof s === 'number' ? s : Number.NaN)
      }
    })
    if (kids.length === 0) return null
    if (kids.length === 1) return kids[0]
    return { type: 'split', dir: o.dir, sizes: normalizeSizes(sizes, kids.length), children: kids }
  }
  return walk(raw)
}
