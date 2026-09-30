import type { TabInfo } from '../../src/shared/types'

export function makeTab(id: string, cwd: string, extra: Partial<TabInfo> = {}): TabInfo {
  return {
    id,
    title: 'x',
    cwd,
    kind: 'shell',
    shell: 'powershell',
    claudeSessionId: null,
    customTitle: false,
    status: 'shell',
    statusSince: 0,
    alive: true,
    note: null,
    ...extra
  }
}
