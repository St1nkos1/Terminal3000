import type { TabInfo } from './types'

// Claude в этой вкладке работает или ждёт ответа: закрытие прервёт его действие
export function isBusyClaude(t: Pick<TabInfo, 'kind' | 'status'>): boolean {
  return t.kind === 'claude' && (t.status === 'working' || t.status === 'waiting')
}
