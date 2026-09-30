import { describe, expect, it } from 'vitest'
import { cwdKey, folderName, truncate } from '../../src/shared/text'

describe('text', () => {
  it('folderName', () => {
    expect(folderName('C:\\Projects\\Проект')).toBe('Проект')
    expect(folderName('C:/work/proj/')).toBe('proj')
    expect(folderName('C:\\')).toBe('C:')
  })

  it('cwdKey не зависит от регистра и слэшей', () => {
    expect(cwdKey('C:\\Work\\Proj\\')).toBe('c:/work/proj')
    expect(cwdKey('c:/work/proj')).toBe('c:/work/proj')
  })

  it('truncate', () => {
    expect(truncate('abc', 5)).toBe('abc')
    expect(truncate('abcdef', 5)).toBe('abcd…')
  })
})
