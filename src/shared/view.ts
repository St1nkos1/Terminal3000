import { containsTab, layoutTabs, normalizeLayout, pane, replaceTab, splitTab } from './layout'
import type { SplitDir, ViewState } from './types'

// То же правило, что у Controller.fixView (Task 12)
export function fixView(view: ViewState, known: readonly string[]): ViewState {
  const set = new Set(known)
  let layout = normalizeLayout(view.layout, set)
  let activeTab = view.activeTab
  if (!activeTab || !set.has(activeTab)) activeTab = layoutTabs(layout)[0] ?? known[0] ?? null
  if (!layout && activeTab) layout = pane(activeTab)
  return { ...view, layout, activeTab, visibleTabs: view.visibleTabs.filter((t) => set.has(t)) }
}

// Панель, в которую встаёт новая вкладка: активная, если она в раскладке, иначе первая
function targetPane(view: ViewState): string | null {
  if (view.activeTab && containsTab(view.layout, view.activeTab)) return view.activeTab
  return layoutTabs(view.layout)[0] ?? null
}

export function showTab(view: ViewState, tab: string): ViewState {
  if (containsTab(view.layout, tab)) return { ...view, activeTab: tab }
  const target = targetPane(view)
  if (!view.layout || !target) return { ...view, layout: pane(tab), activeTab: tab }
  return { ...view, layout: replaceTab(view.layout, target, tab), activeTab: tab }
}

export function placeTab(view: ViewState, tab: string, split?: SplitDir): ViewState {
  const target = targetPane(view)
  if (!split || !view.layout || !target || containsTab(view.layout, tab)) return showTab(view, tab)
  return { ...view, layout: splitTab(view.layout, target, tab, split), activeTab: tab }
}
