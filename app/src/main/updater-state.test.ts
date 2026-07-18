import { describe, it, expect } from 'vitest'
import { INITIAL_UPDATE_STATE, reduceUpdate } from './updater-state.js'
import type { UpdateState } from '../shared/ipc.js'

describe('reduceUpdate', () => {
  it('walks the happy path idle → checking → available → downloading → ready', () => {
    let s: UpdateState = INITIAL_UPDATE_STATE
    s = reduceUpdate(s, { type: 'checking' })
    expect(s.phase).toBe('checking')
    s = reduceUpdate(s, { type: 'available', version: '0.1.1' })
    expect(s).toEqual({ phase: 'available', version: '0.1.1' })
    s = reduceUpdate(s, { type: 'progress' })
    expect(s).toEqual({ phase: 'downloading', version: '0.1.1' }) // carries the version forward
    s = reduceUpdate(s, { type: 'downloaded', version: '0.1.1' })
    expect(s).toEqual({ phase: 'ready', version: '0.1.1' })
  })

  it('dedupes repeated progress by returning the same reference', () => {
    const downloading = reduceUpdate({ phase: 'available', version: '0.1.1' }, { type: 'progress' })
    const again = reduceUpdate(downloading, { type: 'progress' })
    expect(again).toBe(downloading) // identity → caller skips the broadcast
  })

  it('dedupes repeated checking by returning the same reference', () => {
    const checking = reduceUpdate(INITIAL_UPDATE_STATE, { type: 'checking' })
    expect(reduceUpdate(checking, { type: 'checking' })).toBe(checking)
  })

  it('fails silent: error and none fall back to idle when not staged', () => {
    const checking = reduceUpdate(INITIAL_UPDATE_STATE, { type: 'checking' })
    expect(reduceUpdate(checking, { type: 'error' })).toEqual(INITIAL_UPDATE_STATE)
    expect(reduceUpdate(checking, { type: 'none' })).toEqual(INITIAL_UPDATE_STATE)
  })

  it('keeps idle stable (same ref) on error/none when already idle', () => {
    expect(reduceUpdate(INITIAL_UPDATE_STATE, { type: 'error' })).toBe(INITIAL_UPDATE_STATE)
    expect(reduceUpdate(INITIAL_UPDATE_STATE, { type: 'none' })).toBe(INITIAL_UPDATE_STATE)
  })

  it('keeps a staged update sticky against later checks', () => {
    const ready: UpdateState = { phase: 'ready', version: '0.1.1' }
    expect(reduceUpdate(ready, { type: 'checking' })).toBe(ready)
    expect(reduceUpdate(ready, { type: 'none' })).toBe(ready)
    expect(reduceUpdate(ready, { type: 'error' })).toBe(ready)
  })
})
