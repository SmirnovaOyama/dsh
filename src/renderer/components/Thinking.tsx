import { useEffect, useState } from 'react'
import { t } from '../i18n'

/**
 * The mark shown while the agent thinks: a four-point sparkle that slowly turns and breathes,
 * with a small one beside it that twinkles. Only opacity, scale and rotation move; nothing travels.
 */
export function ThinkingMark({ size = 16 }: { size?: number }) {
  return (
    <svg className="hx-think" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path className="big" d="M11 5C11.6 10.4 13.6 12.4 19 13C13.6 13.6 11.6 15.6 11 21C10.4 15.6 8.4 13.6 3 13C8.4 12.4 10.4 10.4 11 5Z" />
      <path className="small" d="M19 1.5C19.25 3.9 19.6 4.25 22 4.5C19.6 4.75 19.25 5.1 19 7.5C18.75 5.1 18.4 4.75 16 4.5C18.4 4.25 18.75 3.9 19 1.5Z" />
    </svg>
  )
}

/** Seconds since a moment, ticking once a second while shown. */
export function useSeconds(since: number | undefined): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (since === undefined) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [since])
  return since === undefined ? 0 : Math.max(0, Math.floor((now - since) / 1000))
}

/** A label with a slow sweep of light across it, for work that is still going on. */
export function Shimmer({ children, className }: { children: string; className?: string }) {
  return <span className={className ? `hx-shimmer ${className}` : 'hx-shimmer'}>{children}</span>
}

/** Shown when the agent is working but nothing it wrote is on screen yet. */
export function ThinkingRow() {
  return (
    <div className="hx-thinking" role="status">
      <ThinkingMark />
      <Shimmer>{t('reasoning.live')}</Shimmer>
    </div>
  )
}
