import type { LayoutNode, NewTabRequest, ViewState } from '../shared/types'

const isStr = (v: unknown): v is string => typeof v === 'string'
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function isTabId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 64
}

export function parseNewTabRequest(raw: unknown): NewTabRequest | null {
  if (!isObj(raw) || !isStr(raw.cwd) || raw.cwd === '') return null
  if (raw.kind !== 'shell' && raw.kind !== 'claude') return null
  const req: NewTabRequest = { cwd: raw.cwd, kind: raw.kind }
  if (raw.shell !== undefined) {
    if (!isStr(raw.shell)) return null
    req.shell = raw.shell
  }
  if (raw.claude !== undefined) {
    if (raw.claude !== 'new' && raw.claude !== 'continue' && raw.claude !== 'resume') return null
    req.claude = raw.claude
  }
  if (raw.sessionId !== undefined) {
    if (!isStr(raw.sessionId)) return null
    req.sessionId = raw.sessionId
  }
  if (raw.title !== undefined) {
    if (!isStr(raw.title)) return null
    req.title = raw.title.slice(0, 200)
  }
  return req
}

// Раскладку не разбираем: Controller.updateView приводит её через normalizeLayout
export function parseViewState(raw: unknown): ViewState | null {
  if (!isObj(raw)) return null
  const { sidebar, visibleTabs, activeTab } = raw
  if (!isObj(sidebar) || !Array.isArray(visibleTabs)) return null
  const { collapsed, collapsedGroups } = sidebar
  if (typeof collapsed !== 'boolean' || !Array.isArray(collapsedGroups)) return null
  if (activeTab !== null && !isTabId(activeTab)) return null
  return {
    layout: (raw.layout ?? null) as LayoutNode | null,
    activeTab,
    sidebar: { collapsed, collapsedGroups: collapsedGroups.filter(isStr) },
    visibleTabs: visibleTabs.filter(isTabId)
  }
}
