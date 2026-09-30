import { describe, expect, it } from 'vitest'
import { IPC } from '../../src/shared/ipc'
import { ACTION_IDS, DEFAULT_KEYBINDINGS } from '../../src/shared/types'

describe('shared', () => {
  it('имена каналов IPC уникальны', () => {
    const names = Object.values(IPC)
    expect(new Set(names).size).toBe(names.length)
  })

  it('у каждого действия есть сочетание по умолчанию', () => {
    for (const id of ACTION_IDS) expect(DEFAULT_KEYBINDINGS[id]).toBeTruthy()
    expect(Object.keys(DEFAULT_KEYBINDINGS).sort()).toEqual([...ACTION_IDS].sort())
  })
})
