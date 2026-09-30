import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../src/main/config'
import {
  formatAge,
  formatAgo,
  groupMenuItems,
  mergeProjects,
  pageItems,
  pagePlaceholder,
  TAB_HISTORY,
  tabHistory,
  type PaletteData
} from '../../src/renderer/palette-pages'
import type { Project } from '../../src/shared/types'
import { makeTab } from '../fixtures/tabs'

const NOW = Date.UTC(2026, 8, 30, 12)
const MIN = 60_000

const projects: Project[] = [
  {
    cwd: 'C:\\Work\\MyWebShop',
    name: 'MyWebShop',
    lastUsed: NOW - MIN,
    conversations: [
      { sessionId: 's2', cwd: 'C:\\Work\\MyWebShop', title: 'почини тесты', mtime: NOW - MIN },
      { sessionId: 's1', cwd: 'C:\\Work\\MyWebShop', title: 'добавь экспорт', mtime: NOW - 180 * MIN }
    ]
  },
  {
    cwd: 'C:\\Work\\Data',
    name: 'Data',
    lastUsed: NOW - 1440 * MIN,
    conversations: [{ sessionId: 's3', cwd: 'C:\\Work\\Data', title: 'обучи модель', mtime: NOW - 90 * MIN }]
  }
]

function data(extra: Partial<PaletteData> = {}): PaletteData {
  return {
    tabs: [],
    projects,
    config: structuredClone(DEFAULT_CONFIG),
    hooks: { state: 'installed' },
    doNotDisturb: false,
    sidebarCollapsed: false,
    activeTab: null,
    layoutTabs: [],
    now: NOW,
    homeDir: 'C:\\Users\\u',
    ...extra
  }
}

const keys = (d: PaletteData, mode: Parameters<typeof pageItems>[0]) => pageItems(mode, d).map((i) => i.key)

describe('palette-pages', () => {
  it('главная: вкладки, команды, проекты, разговоры (свежие первыми)', () => {
    const tabs = [makeTab('t1', 'C:\\Work\\Data'), makeTab('t2', 'C:\\Work\\MyWebShop', { kind: 'claude' })]
    const items = pageItems({ page: 'root' }, data({ tabs, activeTab: 't1' }))
    const kinds = items.map((i) => i.key.split(':')[0])
    expect(kinds.indexOf('cmd')).toBeGreaterThan(kinds.lastIndexOf('tab'))
    expect(kinds.indexOf('project')).toBeGreaterThan(kinds.lastIndexOf('cmd'))
    expect(kinds.indexOf('conv')).toBeGreaterThan(kinds.lastIndexOf('project'))
    expect(items.filter((i) => i.key.startsWith('tab:')).map((i) => i.label)).toEqual(['Data · pwsh', 'MyWebShop · claude'])
    expect(items.find((i) => i.key === 'cmd:newTab')?.hint).toBe('Ctrl+Shift+T')
    const convs = items.filter((i) => i.key.startsWith('conv:'))
    expect(convs.map((i) => i.key)).toEqual(['conv:s2', 'conv:s3', 'conv:s1'])
    expect(convs[0].detail).toBe('MyWebShop · 1 мин назад')
    expect(convs[0].command).toEqual({
      type: 'open',
      req: { cwd: 'C:\\Work\\MyWebShop', kind: 'claude', claude: 'resume', sessionId: 's2' }
    })
  })

  it('команды для вкладки есть, только когда есть активная вкладка', () => {
    expect(keys(data({ activeTab: null }), { page: 'root' })).not.toContain('cmd:splitVertical')
    const withTab = keys(data({ tabs: [makeTab('t1', 'C:\\x')], activeTab: 't1' }), { page: 'root' })
    for (const k of ['cmd:splitVertical', 'cmd:splitHorizontal', 'cmd:toggleConsole', 'cmd:search', 'cmd:rename', 'cmd:closeTab']) {
      expect(withTab).toContain(k)
    }
  })

  it('подписи команд «Не беспокоить» и панели зависят от состояния', () => {
    const label = (d: PaletteData, key: string) => pageItems({ page: 'root' }, d).find((i) => i.key === key)?.label
    expect(label(data(), 'cmd:doNotDisturb')).toBe('Не беспокоить: включить')
    expect(label(data({ doNotDisturb: true }), 'cmd:doNotDisturb')).toBe('Не беспокоить: выключить')
    expect(label(data({ sidebarCollapsed: true }), 'cmd:toggle-sidebar')).toBe('Развернуть панель')
  })

  it('новая вкладка: консоль в домашней папке, «Выбрать папку…», проект активной вкладки, папки вкладок', () => {
    const tabs = [makeTab('t1', 'C:\\Work\\Data'), makeTab('t2', 'E:\\Новая')]
    expect(keys(data({ tabs, activeTab: 't1' }), { page: 'new-tab' })).toEqual([
      'home-console',
      'pick-folder',
      'project:c:/work/data',
      'project:c:/work/mywebshop',
      'project:e:/новая'
    ])
    const home = pageItems({ page: 'new-tab' }, data())[0]
    expect(home).toMatchObject({ label: 'Консоль', detail: '~ (C:\\Users\\u)' })
    expect(home.command).toEqual({ type: 'open', req: { cwd: 'C:\\Users\\u', kind: 'shell' } })
    const split = pageItems({ page: 'new-tab', split: 'row' }, data())
    expect(split[0].command).toEqual({ type: 'open', req: { cwd: 'C:\\Users\\u', kind: 'shell' }, split: 'row' })
    expect(split[1].command).toEqual({ type: 'pick-folder', split: 'row' })
    expect(split[2].command).toEqual({ type: 'page', mode: { page: 'project', cwd: 'C:\\Work\\MyWebShop', split: 'row' } })
  })

  it('главная палитра: команда «Новая консоль в домашней папке»', () => {
    const item = pageItems({ page: 'root' }, data()).find((i) => i.key === 'cmd:home-console')
    expect(item?.label).toBe('Новая консоль в домашней папке')
    expect(item?.command).toEqual({ type: 'open', req: { cwd: 'C:\\Users\\u', kind: 'shell' } })
  })

  it('проект: Claude, продолжение и выбор разговора, консоли (оболочка по умолчанию первой)', () => {
    const d = data({ config: { ...structuredClone(DEFAULT_CONFIG), defaultShell: 'cmd' } })
    expect(keys(d, { page: 'project', cwd: 'c:/work/mywebshop' })).toEqual([
      'claude-new',
      'claude-continue',
      'claude-pick',
      'shell:cmd',
      'shell:powershell',
      'shell:gitbash'
    ])
    const items = pageItems({ page: 'project', cwd: 'C:\\Work\\MyWebShop', split: 'column' }, d)
    expect(items[0].command).toEqual({
      type: 'open',
      req: { cwd: 'C:\\Work\\MyWebShop', kind: 'claude', claude: 'new' },
      split: 'column'
    })
    expect(items[1].detail).toBe('почини тесты')
    expect(items[2].command).toEqual({
      type: 'page',
      mode: { page: 'conversations', cwd: 'C:\\Work\\MyWebShop', split: 'column' }
    })
    // папка без разговоров
    expect(keys(d, { page: 'project', cwd: 'E:\\Новая' })).toEqual(['claude-new', 'shell:cmd', 'shell:powershell', 'shell:gitbash'])
  })

  it('разговоры проекта, сплит и выбор оболочки', () => {
    const conv = pageItems({ page: 'conversations', cwd: 'C:\\Work\\MyWebShop' }, data())
    expect(conv.map((i) => [i.label, i.detail])).toEqual([
      ['почини тесты', '1 мин назад'],
      ['добавь экспорт', '3 ч назад']
    ])
    const tabs = [makeTab('a', 'C:\\x'), makeTab('b', 'C:\\x'), makeTab('c', 'D:\\y')]
    const split = pageItems({ page: 'split', dir: 'column' }, data({ tabs, layoutTabs: ['a'], activeTab: 'a' }))
    expect(split.map((i) => i.key)).toEqual(['split-new', 'tab:b', 'tab:c'])
    expect(split[0].command).toEqual({ type: 'page', mode: { page: 'new-tab', split: 'column' } })
    expect(split[1].command).toEqual({ type: 'split-with', tab: 'b', dir: 'column' })
    const shells = pageItems({ page: 'shell', tab: 'a' }, data())
    expect(shells[0].command).toEqual({ type: 'set-shell', tab: 'a', shell: 'powershell' })
  })

  it('mergeProjects, formatAgo, подсказки в строке ввода', () => {
    expect(mergeProjects(projects, [makeTab('a', 'c:/work/data/')]).length).toBe(2)
    expect(formatAgo(10_000)).toBe('только что')
    expect(formatAgo(5 * MIN)).toBe('5 мин назад')
    expect(formatAgo(3 * 60 * MIN)).toBe('3 ч назад')
    expect(formatAgo(2 * 1440 * MIN)).toBe('2 дн назад')
    expect(formatAgo(65 * 1440 * MIN)).toBe('2 мес назад')
    expect(pagePlaceholder({ page: 'project', cwd: 'C:\\Work\\Data' })).toBe('Что запустить в Data')
  })
})

describe('меню группы', () => {
  const brief = (d: PaletteData, cwd: string) =>
    groupMenuItems(d, cwd).map((i) => [i.key, i.command !== null, i.separator ?? false])

  it('Claude и консоли в папке группы, оболочка по умолчанию первой, линия перед консолями', () => {
    const d = data({ config: { ...structuredClone(DEFAULT_CONFIG), defaultShell: 'cmd' } })
    expect(brief(d, 'c:/work/mywebshop')).toEqual([
      ['claude-new', true, false],
      ['claude-continue', true, false],
      ['claude-pick', true, false],
      ['shell:cmd', true, true],
      ['shell:powershell', true, false],
      ['shell:gitbash', true, false]
    ])
    const items = groupMenuItems(d, 'c:/work/mywebshop')
    expect(items.map((i) => i.label)).toEqual([
      'Claude: новый разговор',
      'Claude: продолжить последний',
      'Claude: выбрать разговор…',
      'Консоль: cmd',
      'Консоль: powershell',
      'Консоль: gitbash'
    ])
    expect(items[0].command).toEqual({ type: 'open', req: { cwd: 'C:\\Work\\MyWebShop', kind: 'claude', claude: 'new' } })
    expect(items[1].detail).toBe('почини тесты')
    expect(items[2].command).toEqual({ type: 'page', mode: { page: 'conversations', cwd: 'C:\\Work\\MyWebShop' } })
    expect(items[3].command).toEqual({ type: 'open', req: { cwd: 'C:\\Work\\MyWebShop', kind: 'shell', shell: 'cmd' } })
  })

  it('пока разговоры читаются и когда их нет, пункты на месте, но недоступны', () => {
    const disabled = [
      ['claude-new', true, false],
      ['claude-continue', false, false],
      ['claude-pick', false, false],
      ['shell:powershell', true, true],
      ['shell:cmd', true, false],
      ['shell:gitbash', true, false]
    ]
    expect(brief(data({ projects: null }), 'C:\\Work\\MyWebShop')).toEqual(disabled)
    expect(brief(data(), 'E:\\Новая')).toEqual(disabled)
  })
})

describe('tabHistory: прошлые разговоры под Claude-вкладкой', () => {
  const cwd = 'C:\\Work\\Shop'
  const conversations = Array.from({ length: 13 }, (_, i) => ({
    sessionId: `c${i}`,
    cwd,
    title: `разговор ${i}`,
    mtime: NOW - i * MIN
  }))
  const shop: Project = { cwd, name: 'Shop', lastUsed: NOW, conversations }
  const ids = (h: ReturnType<typeof tabHistory>) => h.items.map((i) => i.conversation.sessionId)

  it('formatAge: короткий возраст для панели', () => {
    expect([10_000, 5 * MIN, 3 * 60 * MIN, 2 * 1440 * MIN, 65 * 1440 * MIN, -MIN].map(formatAge)).toEqual([
      'сейчас',
      '5 мин',
      '3 ч',
      '2 дн',
      '2 мес',
      'сейчас'
    ])
  })

  it('разговоры проекта свежими первыми, без своего, не больше TAB_HISTORY', () => {
    const tab = makeTab('a', 'c:/work/shop', { kind: 'claude', claudeSessionId: 'c0' })
    const h = tabHistory(tab, [projects[0], shop], [tab])
    expect(TAB_HISTORY).toBe(10)
    expect(ids(h)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10'])
    expect(h.total).toBe(13)
    expect(h.more).toBe(true)
  })

  it('разговор, открытый в другой Claude-вкладке, помечен ею; консоль после выхода Claude не в счёт', () => {
    const tab = makeTab('a', cwd, { kind: 'claude' })
    const other = makeTab('b', cwd, { kind: 'claude', claudeSessionId: 'c2' })
    const exited = makeTab('c', cwd, { kind: 'shell', claudeSessionId: 'c3' })
    const h = tabHistory(tab, [shop], [tab, other, exited])
    expect(ids(h)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9'])
    expect(h.items.map((i) => i.openIn)).toEqual([null, null, 'b', null, null, null, null, null, null, null])
  })

  it('всё поместилось — ссылка на палитру не нужна; проекта нет в индексе — пусто', () => {
    const tab = makeTab('a', 'C:\\Work\\MyWebShop', { kind: 'claude', claudeSessionId: 's2' })
    expect(tabHistory(tab, projects, [tab])).toEqual({
      items: [{ conversation: projects[0].conversations[1], openIn: null }],
      total: 2,
      more: false
    })
    const lonely = makeTab('z', 'E:\\Новая', { kind: 'claude' })
    expect(tabHistory(lonely, projects, [lonely])).toEqual({ items: [], total: 0, more: false })
  })
})
