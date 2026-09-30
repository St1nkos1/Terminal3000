import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NO_PROMPT, ProjectIndex, parseConversationHead } from '../../src/main/project-index'

const line = (o: unknown) => JSON.stringify(o) + '\n'
const user = (cwd: string, content: unknown, extra: object = {}) =>
  line({ type: 'user', cwd, sessionId: 's', message: { role: 'user', content }, ...extra })

describe('parseConversationHead', () => {
  it('cwd из первой записи, где он есть; запрос-строка', () => {
    const text = line({ type: 'file-history-snapshot', messageId: 'm' }) + user('C:\\Work\\Проект', 'почини тесты')
    expect(parseConversationHead(text)).toEqual({ cwd: 'C:\\Work\\Проект', firstPrompt: 'почини тесты' })
  })

  it('пропускает служебные записи и берёт текстовые блоки', () => {
    const text =
      user('C:\\A', '<local-command-caveat>Caveat</local-command-caveat>', { isMeta: true }) +
      user('C:\\A', '<command-name>/clear</command-name>') +
      user('C:\\A', '  <system-reminder>x</system-reminder>') +
      user('C:\\A', [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }]) +
      user('C:\\A', [{ type: 'image' }, { type: 'text', text: 'опиши' }, { type: 'text', text: 'картинку' }])
    expect(parseConversationHead(text).firstPrompt).toBe('опиши картинку')
  })

  it('схлопывает пробелы и обрезает до 80 символов', () => {
    const text = user('C:\\A', 'раз\n\n  два\tтри ' + 'я'.repeat(100))
    const { firstPrompt } = parseConversationHead(text)
    expect(firstPrompt.startsWith('раз два три я')).toBe(true)
    expect(firstPrompt).toHaveLength(80)
    expect(firstPrompt.endsWith('…')).toBe(true)
  })

  it('обрезанная последняя строка и мусор не мешают', () => {
    const text = 'не json\n' + user('C:\\A', 'первый') + '{"type":"user","cwd":"C:\\\\B","message":{"conte'
    expect(parseConversationHead(text)).toEqual({ cwd: 'C:\\A', firstPrompt: 'первый' })
  })

  it('нет запроса и нет cwd', () => {
    expect(parseConversationHead(line({ type: 'summary', summary: 'x' }))).toEqual({ cwd: null, firstPrompt: NO_PROMPT })
  })
})

describe('ProjectIndex', () => {
  let root: string
  let claudeDir: string
  let work: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 't3000-index-'))
    claudeDir = join(root, '.claude')
    work = join(root, 'work')
    mkdirSync(work)
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  function conversation(dirName: string, id: string, body: string, mtime: Date): string {
    const dir = join(claudeDir, 'projects', dirName)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${id}.jsonl`)
    writeFileSync(file, body)
    utimesSync(file, mtime, mtime)
    return file
  }

  it('кириллический путь берётся из cwd, а не из имени папки', async () => {
    const cwd = join(work, 'Проект')
    mkdirSync(cwd)
    conversation('C--work-------', 'aaa-111', user(cwd, 'привет'), new Date(2026, 8, 1))
    const projects = await new ProjectIndex(claudeDir).list([])
    expect(projects).toEqual([
      {
        cwd,
        name: 'Проект',
        lastUsed: new Date(2026, 8, 1).getTime(),
        conversations: [{ sessionId: 'aaa-111', cwd, title: 'привет', mtime: new Date(2026, 8, 1).getTime() }]
      }
    ])
  })

  it('группирует по папке без учёта регистра и сортирует по времени', async () => {
    const a = join(work, 'alpha')
    const b = join(work, 'beta')
    mkdirSync(a)
    mkdirSync(b)
    conversation('x', 'a1', user(a, 'старый'), new Date(2026, 0, 1))
    conversation('x', 'a2', user(a.toUpperCase(), 'новый'), new Date(2026, 0, 3))
    conversation('y', 'b1', user(b, 'бета'), new Date(2026, 0, 2))
    const projects = await new ProjectIndex(claudeDir).list([])
    expect(projects.map((p) => p.name.toLowerCase())).toEqual(['alpha', 'beta'])
    expect(projects[0].conversations.map((c) => c.title)).toEqual(['новый', 'старый'])
    expect(projects[0].lastUsed).toBe(new Date(2026, 0, 3).getTime())
  })

  it('скрывает проекты, чьих папок больше нет, и файлы без cwd', async () => {
    conversation('x', 'gone', user(join(work, 'удалён'), 'x'), new Date(2026, 0, 1))
    conversation('x', 'nocwd', line({ type: 'summary', summary: 'x' }), new Date(2026, 0, 1))
    expect(await new ProjectIndex(claudeDir).list([])).toEqual([])
  })

  it('пропускает файлы с небезопасным именем и не-jsonl', async () => {
    const a = join(work, 'alpha')
    mkdirSync(a)
    conversation('x', "bad'id", user(a, 'x'), new Date(2026, 0, 1))
    writeFileSync(join(claudeDir, 'projects', 'x', 'notes.txt'), user(a, 'x'))
    writeFileSync(join(claudeDir, 'projects', 'file.jsonl'), user(a, 'x'))
    expect(await new ProjectIndex(claudeDir).list([])).toEqual([])
  })

  it('читает только первые 64 КБ', async () => {
    const a = join(work, 'alpha')
    mkdirSync(a)
    const body = user(a, [{ type: 'tool_result', content: 'x' }]) + line({ type: 'pad', pad: 'x'.repeat(70000) }) + user(a, 'поздний')
    conversation('x', 'big', body, new Date(2026, 0, 1))
    const [p] = await new ProjectIndex(claudeDir).list([])
    expect(p.conversations[0].title).toBe(NO_PROMPT)
  })

  it('добавляет подпапки projectRoots, пропуская скрытые и файлы', async () => {
    mkdirSync(join(work, 'one'))
    mkdirSync(join(work, '.git'))
    writeFileSync(join(work, 'readme.md'), 'x')
    const projects = await new ProjectIndex(claudeDir).list([work, join(root, 'нет-такой')])
    expect(projects).toEqual([{ cwd: join(work, 'one'), name: 'one', lastUsed: 0, conversations: [] }])
  })

  it('нет папки ~/.claude/projects — пустой список', async () => {
    expect(await new ProjectIndex(join(root, 'nothing')).list([])).toEqual([])
  })

  it('кеш по mtime и размеру; удалённый файл исчезает', async () => {
    const a = join(work, 'alpha')
    mkdirSync(a)
    const t1 = new Date(2026, 0, 1)
    const file = conversation('x', 'c1', user(a, 'один'), t1)
    const index = new ProjectIndex(claudeDir)
    expect((await index.list([]))[0].conversations[0].title).toBe('один')

    // Та же длина и то же время изменения: файл не перечитывается
    writeFileSync(file, user(a, 'пять'))
    utimesSync(file, t1, t1)
    expect((await index.list([]))[0].conversations[0].title).toBe('один')

    const t2 = new Date(2026, 0, 2)
    utimesSync(file, t2, t2)
    expect((await index.list([]))[0].conversations[0].title).toBe('пять')

    rmSync(file)
    expect(await index.list([])).toEqual([])
  })
})
