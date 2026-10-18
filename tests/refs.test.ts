import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanRefs, withRefs } from '../src/main/refs'

let ws: string

beforeEach(async () => {
  ws = await mkdtemp(path.join(tmpdir(), 'dsh-refs-'))
  await writeFile(path.join(ws, 'a.ts'), ['one', 'two', 'three', 'four', 'five'].join('\n') + '\n')
})

afterEach(async () => {
  await rm(ws, { recursive: true, force: true })
})

describe('file references', () => {
  it('keeps only well-formed references', () => {
    expect(cleanRefs([{ path: 'a.ts', start: 4, end: 2 }, { path: '' }, { path: 'b.ts', start: 0 }, 'x', null])).toEqual([
      { path: 'a.ts', start: 4, end: 4 },
      { path: 'b.ts' },
    ])
    expect(cleanRefs('nope')).toEqual([])
  })

  it('adds the picked lines, numbered, after the message', async () => {
    const text = await withRefs(ws, 'Fix this', [{ path: 'a.ts', start: 2, end: 3 }])
    expect(text.startsWith('Fix this\n\n')).toBe(true)
    expect(text).toContain('a.ts, lines 2-3:\n```\n2  two\n3  three\n```')
    expect(text).not.toContain('four')
  })

  it('adds a whole file when no lines are picked', async () => {
    const text = await withRefs(ws, 'Look', [{ path: 'a.ts' }])
    expect(text).toContain('1  one\n2  two\n3  three\n4  four\n5  five')
  })

  it('says when a file cannot be read, and refuses paths outside the folder', async () => {
    const text = await withRefs(ws, 'Look', [{ path: 'missing.ts' }, { path: '../outside.ts' }])
    expect(text).toContain('missing.ts: could not be read')
    expect(text).toContain('../outside.ts: could not be read')
  })

  it('leaves the message alone without references', async () => {
    expect(await withRefs(ws, 'Just text', [])).toBe('Just text')
  })
})
