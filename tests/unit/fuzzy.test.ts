import { describe, expect, it } from 'vitest'
import { fuzzyFilter, fuzzyScore } from '../../src/renderer/fuzzy'

describe('fuzzy', () => {
  it('подпоследовательность без учёта регистра, ё = е, пробелы в запросе не важны', () => {
    expect(fuzzyScore('sb', 'SoundBox')).not.toBeNull()
    expect(fuzzyScore('xyz', 'SoundBox')).toBeNull()
    expect(fuzzyScore('ЁЖИК', 'ежик')).not.toBeNull()
    expect(fuzzyScore('sound box', 'SoundBox')).not.toBeNull()
    expect(fuzzyScore('', 'что угодно')).toBe(0)
  })

  it('начало слова и буквы подряд ценятся выше', () => {
    expect(fuzzyScore('dt', 'Data Trainer')!).toBeGreaterThan(fuzzyScore('dt', 'adapted')!)
    expect(fuzzyScore('sb', 'SoundBox')!).toBeGreaterThan(fuzzyScore('sb', 'mysobad')!)
    expect(fuzzyScore('тест', 'почини тесты')!).toBeGreaterThan(fuzzyScore('тест', 'трест')!)
  })

  it('fuzzyFilter: по убыванию очков, при равенстве исходный порядок, пустой запрос — всё', () => {
    const items = ['adapted', 'Data Trainer', 'SoundBox', 'dt']
    expect(fuzzyFilter(items, 'dt', (s) => s)).toEqual(['dt', 'Data Trainer', 'adapted'])
    expect(fuzzyFilter(['b1', 'b2'], 'b', (s) => s)).toEqual(['b1', 'b2'])
    expect(fuzzyFilter(items, '  ', (s) => s)).toEqual(items)
  })
})
