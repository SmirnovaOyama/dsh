import type { Locale } from '../shared/types'

export function tildify(path: string, home: string): string {
  if (!home) return path
  if (path === home) return '~'
  const sep = path.includes('\\') ? '\\' : '/'
  return path.startsWith(home + sep) ? '~' + path.slice(home.length) : path
}

/** 950, 18.4k, 1.2M: short enough to sit in a status line. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

export function formatSeconds(ms: number): string {
  const s = ms / 1000
  if (s < 10) return s.toFixed(1)
  return String(Math.round(s))
}

const pad = (n: number) => String(n).padStart(2, '0')

export function clockTime(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export type DayGroup = 'today' | 'yesterday' | 'week' | 'earlier'

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function dayGroup(ts: number, now: number): DayGroup {
  const today = startOfDay(now)
  const day = 86_400_000
  if (ts >= today) return 'today'
  if (ts >= today - day) return 'yesterday'
  if (ts >= today - 6 * day) return 'week'
  return 'earlier'
}

/** What the sidebar shows after a conversation title when nothing is running. */
export function sessionTime(ts: number, now: number, locale: Locale): string {
  const group = dayGroup(ts, now)
  if (group === 'today' || group === 'yesterday') return clockTime(ts)
  if (group === 'week') return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(ts)
  return new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' }).format(ts)
}

export function modKey(platform: string): string {
  return platform === 'darwin' ? '⌘' : 'Ctrl+'
}
