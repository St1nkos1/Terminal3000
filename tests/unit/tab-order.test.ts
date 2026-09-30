import { describe, expect, it } from 'vitest'
import {
  formatDuration,
  groupTabs,
  panelOrder,
  paneTitle,
  showsDuration,
  STATUS_ICON,
  STATUS_LABEL,
  statusText,
  tabLabel,
  touchMru
} from '../../src/renderer/tab-order'
import { makeTab } from '../fixtures/tabs'

describe('tab-order', () => {
  it('группы по папке в порядке первого появления, регистр и слэши не важны', () => {
    const tabs = [
      makeTab('a', 'C:\\Work\\MyWebShop'),
      makeTab('b', 'C:\\Work\\Data'),
      makeTab('c', 'c:/work/mywebshop/'),
      makeTab('d', 'C:\\Work\\Data', { kind: 'claude' })
    ]
    const groups = groupTabs(tabs)
    expect(groups.map((g) => [g.name, g.tabs.map((t) => t.id)])).toEqual([
      ['MyWebShop', ['a', 'c']],
      ['Data', ['b', 'd']]
    ])
    expect(groups[0].cwd).toBe('C:\\Work\\MyWebShop')
    expect(panelOrder(tabs)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('MRU: вкладка встаёт первой без повторов', () => {
    expect(touchMru(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
    expect(touchMru([], 'a')).toEqual(['a'])
  })

  it('названия вкладок', () => {
    const cwd = 'C:\\Work\\MyWebShop'
    expect(tabLabel(makeTab('a', cwd))).toBe('pwsh')
    expect(tabLabel(makeTab('a', cwd, { shell: 'gitbash' }))).toBe('bash')
    expect(tabLabel(makeTab('a', cwd, { shell: 'cmd' }))).toBe('cmd')
    expect(tabLabel(makeTab('a', cwd, { kind: 'claude' }))).toBe('claude')
    expect(tabLabel(makeTab('a', cwd, { customTitle: true, title: 'тесты' }))).toBe('тесты')
    expect(paneTitle(makeTab('a', cwd, { kind: 'claude' }))).toBe('MyWebShop · claude')
    expect(paneTitle(makeTab('a', cwd, { customTitle: true, title: 'тесты' }))).toBe('тесты')
  })

  it('статусы: формулировки из спеки §4.2', () => {
    expect(STATUS_LABEL).toEqual({
      sleeping: 'спит',
      starting: 'запуск',
      idle: 'свободна',
      working: 'работает',
      waiting: 'ждёт',
      done: 'готово',
      crashed: 'упала',
      shell: 'консоль'
    })
    expect(Object.keys(STATUS_ICON).sort()).toEqual(Object.keys(STATUS_LABEL).sort())
    expect(showsDuration('working')).toBe(true)
    expect(showsDuration('waiting')).toBe(true)
    expect(showsDuration('done')).toBe(false)
  })

  it('formatDuration', () => {
    expect(formatDuration(-5)).toBe('0с')
    expect(formatDuration(14_900)).toBe('14с')
    expect(formatDuration(125_000)).toBe('2м')
    expect(formatDuration(3 * 3600_000 + 5)).toBe('3ч')
    expect(formatDuration(49 * 3600_000)).toBe('2д')
  })
})

describe('statusText', () => {
  it('Claude-вкладка без хуков не висит в «запуск»', () => {
    const starting = makeTab('a', 'C:/p', { kind: 'claude', status: 'starting', statusSince: 0 })
    // хуки не стоят или повреждены — статусов не будет
    expect(statusText(starting, false, 1000)).toBe('без статусов')
    // хуки стоят: обычный запуск, пока не прошло 30 с
    expect(statusText(starting, true, 10_000)).toBe('запуск')
    // сессия запущена до установки хуков и не присылает событий
    expect(statusText(starting, true, 31_000)).toBe('без статусов')
    expect(statusText(makeTab('b', 'C:/p', { kind: 'claude', status: 'idle' }), false, 99_000)).toBe('свободна')
  })
})
