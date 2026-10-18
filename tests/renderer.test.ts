import { describe, expect, it } from 'vitest'
import { dayGroup, formatSeconds, formatTokens, tildify } from '../src/renderer/format'
import { highlight } from '../src/renderer/highlight'

describe('format', () => {
  it('shortens token counts', () => {
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(18_420)).toBe('18k')
    expect(formatTokens(3_400)).toBe('3.4k')
    expect(formatTokens(128_000)).toBe('128k')
    expect(formatTokens(1_250_000)).toBe('1.3M')
  })

  it('shows paths under the home folder with ~', () => {
    expect(tildify('/Users/anya/Projects/dsh', '/Users/anya')).toBe('~/Projects/dsh')
    expect(tildify('/Users/anyab/x', '/Users/anya')).toBe('/Users/anyab/x')
    expect(tildify('C:\\Users\\anya\\dsh', 'C:\\Users\\anya')).toBe('~\\dsh')
  })

  it('groups by day', () => {
    const now = new Date(2026, 9, 18, 15, 0).getTime()
    expect(dayGroup(new Date(2026, 9, 18, 0, 5).getTime(), now)).toBe('today')
    expect(dayGroup(new Date(2026, 9, 17, 23, 0).getTime(), now)).toBe('yesterday')
    expect(dayGroup(new Date(2026, 9, 13, 9, 0).getTime(), now)).toBe('week')
    expect(dayGroup(new Date(2026, 9, 1).getTime(), now)).toBe('earlier')
  })

  it('formats seconds', () => {
    expect(formatSeconds(140)).toBe('0.1')
    expect(formatSeconds(12_400)).toBe('12')
  })
})

describe('highlight', () => {
  it('marks keywords, strings, numbers and comments without losing text', () => {
    const code = "const x = 'a' // note\nreturn 42"
    const tokens = highlight(code, 'ts')
    expect(tokens.map((t) => t.text).join('')).toBe(code)
    expect(tokens.filter((t) => t.kind).map((t) => [t.kind, t.text])).toEqual([
      ['k', 'const'],
      ['s', "'a'"],
      ['c', '// note'],
      ['k', 'return'],
      ['n', '42'],
    ])
  })

  it('uses # comments for shell and leaves plain text alone', () => {
    expect(highlight('echo hi # done', 'bash').at(-1)).toEqual({ kind: 'c', text: '# done' })
    expect(highlight('const x', 'text')).toEqual([{ kind: null, text: 'const x' }])
  })
})
