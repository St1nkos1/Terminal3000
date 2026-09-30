import type { TabInfo } from '../shared/types'

export function attentionCount(tabs: TabInfo[]): number {
  return tabs.filter((t) => t.status === 'waiting' || t.status === 'done').length
}

export function badgeText(count: number): string {
  return count > 9 ? '9+' : String(count)
}

// Красный кружок с числом для иконки на панели задач
export function drawBadge(count: number): string | null {
  if (count <= 0) return null
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const g = canvas.getContext('2d')
  if (!g) return null
  g.fillStyle = '#e53935'
  g.beginPath()
  g.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#ffffff'
  g.font = `bold ${count > 9 ? 15 : 20}px 'Segoe UI', sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(badgeText(count), size / 2, size / 2 + 1)
  return canvas.toDataURL('image/png')
}
