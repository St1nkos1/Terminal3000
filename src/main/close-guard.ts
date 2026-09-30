import { folderName } from '../shared/text'
import type { TabInfo } from '../shared/types'

// Закрыть окно, пока Claude работает или ждёт ответа, — прервать его действие; разговор вернёт --resume
export function closeWarning(tabs: TabInfo[]): string | null {
  const busy = tabs.filter((t) => t.kind === 'claude' && (t.status === 'working' || t.status === 'waiting'))
  if (busy.length === 0) return null
  const names = busy.map((t) => (t.customTitle ? t.title : folderName(t.cwd)))
  return (
    `Claude ещё работает: ${names.join(', ')}. ` +
    'Если закрыть окно, текущее действие прервётся. Разговоры продолжатся при следующем запуске.'
  )
}
