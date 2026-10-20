import { useEffect, useId, useState } from 'react'
import { t } from '../i18n'

const LOBES = [
  { cx: 8, cy: 13, r: 4.5 },
  { cx: 13, cy: 10, r: 5.5 },
  { cx: 17.5, cy: 13.5, r: 4 },
]
const BASE = { x: 8, y: 12, width: 9.5, height: 5.5 }
const LINE = 1.75

/**
 * The mark shown while the agent thinks: a little thought cloud. Its three puffs swell one after
 * another, left to right, and the two small circles under it fade in from the far one to the near
 * one. The outline is the edge of the puffs drawn through a mask, so it stays one clean line while
 * they swell. Only opacity and scale change; nothing moves across the screen.
 */
export function ThinkingMark({ size = 20 }: { size?: number }) {
  // useId has characters a url(#…) reference would need escaped; a plain id avoids that.
  const mask = `hx-think-${useId().replace(/[^\w-]/g, '')}`
  return (
    <svg className="hx-think" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <mask id={mask} maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28">
        {/* The puffs grown by the line width, with the puffs themselves cut out, leave just the outline. */}
        {LOBES.map((l, i) => (
          <circle key={i} className={`puff p${i + 1}`} cx={l.cx} cy={l.cy} r={l.r + LINE} fill="white" />
        ))}
        <rect x={BASE.x} y={BASE.y} width={BASE.width} height={BASE.height + LINE} fill="white" />
        {LOBES.map((l, i) => (
          <circle key={i} className={`puff p${i + 1}`} cx={l.cx} cy={l.cy} r={l.r} fill="black" />
        ))}
        <rect {...BASE} fill="black" />
      </mask>
      <rect className="cloud" x="-2" y="-2" width="28" height="28" mask={`url(#${mask})`} />
      <circle className="trail near" cx="5" cy="20.75" r="1.6" />
      <circle className="trail far" cx="2.25" cy="23" r="1" />
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
