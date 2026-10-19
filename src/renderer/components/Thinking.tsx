import { useEffect, useState } from 'react'
import { t } from '../i18n'

/**
 * The mark shown while the agent thinks: a thought bubble whose three dots light up one after
 * another, with the two little circles under it fading in turn like a thought rising. Only opacity
 * and scale change; nothing moves across the screen.
 */
export function ThinkingMark({ size = 20 }: { size?: number }) {
  return (
    <svg className="hx-think" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <rect className="bubble" x="5" y="5" width="16" height="13" rx="4.5" />
      <circle className="dot" cx="9" cy="11.5" r="1.5" />
      <circle className="dot" cx="13" cy="11.5" r="1.5" />
      <circle className="dot" cx="17" cy="11.5" r="1.5" />
      <circle className="trail near" cx="4.25" cy="20.5" r="1.75" />
      <circle className="trail far" cx="1.5" cy="23.25" r="1.15" />
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
