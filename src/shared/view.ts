import { containsTab, layoutTabs, normalizeLayout, pane, replaceTab, splitTab } from './layout'
import type { LayoutNode, SplitDir, ViewState } from './types'

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

type IsShell = (tab: string) => boolean

// Пара «Claude над консолью»: две панели одна под другой, снизу консоль, сверху не консоль
function isPair(node: LayoutNode, isShell: IsShell): boolean {
  if (node.type !== 'split' || node.dir !== 'column' || node.children.length !== 2) return false
  const [top, bottom] = node.children
  return top.type === 'pane' && bottom.type === 'pane' && !isShell(top.tab) && isShell(bottom.tab)
}

// Место под вкладку: пара, в которую входит панель target, иначе сама панель
function slotOf(node: LayoutNode, target: string, isShell: IsShell): LayoutNode | null {
  if (node.type === 'pane') return node.tab === target ? node : null
  if (isPair(node, isShell) && containsTab(node, target)) return node
  for (const child of node.children) {
    const slot = slotOf(child, target, isShell)
    if (slot) return slot
  }
  return null
}

function replaceNode(node: LayoutNode, from: LayoutNode, to: LayoutNode): LayoutNode {
  if (node === from) return to
  if (node.type === 'pane') return node
  return { ...node, children: node.children.map((c) => replaceNode(c, from, to)) }
}

// Claude-вкладка встаёт на экран вместе с консолью своего проекта снизу; shell: null — консоли пока нет
export function showWithConsole(view: ViewState, tab: string, shell: string | null, isShell: IsShell): ViewState {
  if (containsTab(view.layout, tab)) return { ...view, activeTab: tab }
  const target = targetPane(view)
  const slot = view.layout && target ? slotOf(view.layout, target, isShell) : null
  // консоль, которая уже стоит на экране вне этого места, не дублируем
  const below = shell !== null && (!containsTab(view.layout, shell) || containsTab(slot, shell)) ? shell : null
  const sizes = slot?.type === 'split' ? slot.sizes : [0.5, 0.5]
  const next: LayoutNode = below
    ? { type: 'split', dir: 'column', sizes, children: [pane(tab), pane(below)] }
    : pane(tab)
  return { ...view, layout: view.layout && slot ? replaceNode(view.layout, slot, next) : next, activeTab: tab }
}

// Консоль встаёт на экран под Claude своего проекта; claude: null — Claude в папке нет, консоль встаёт одна.
// Место — как у Claude: пара активной панели сменяется целиком, пропорции остаются
export function showConsole(view: ViewState, shell: string, claude: string | null, isShell: IsShell): ViewState {
  if (containsTab(view.layout, shell)) return { ...view, activeTab: shell }
  // Claude уже на экране: консоль встаёт под ним, в паре — вместо нижней
  const onScreen = claude !== null && containsTab(view.layout, claude)
  const target = onScreen ? claude : targetPane(view)
  const slot = view.layout && target ? slotOf(view.layout, target, isShell) : null
  const sizes = slot?.type === 'split' ? slot.sizes : [0.5, 0.5]
  const next: LayoutNode = claude
    ? { type: 'split', dir: 'column', sizes, children: [pane(claude), pane(shell)] }
    : pane(shell)
  return { ...view, layout: view.layout && slot ? replaceNode(view.layout, slot, next) : next, activeTab: shell }
}

// Созданная консоль встаёт под вкладкой, если та ещё на экране; активная вкладка не меняется
export function attachConsole(view: ViewState, tab: string, shell: string): ViewState {
  if (!view.layout || !containsTab(view.layout, tab) || containsTab(view.layout, shell)) return view
  return { ...view, layout: splitTab(view.layout, tab, shell, 'column') }
}
