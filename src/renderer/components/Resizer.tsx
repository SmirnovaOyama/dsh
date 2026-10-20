import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { t } from '../i18n'

export type Pane = 'sidebar' | 'changes' | 'artifacts'

const KEY = 'dsh.layout'
const LIMITS: Record<Pane, [number, number]> = { sidebar: [208, 420], changes: [320, 960], artifacts: [360, 1200] }
/** The conversation never gets narrower than this while a pane is dragged wider. */
const MAIN_MIN = 420
const STEP = 16

function load(): Partial<Record<Pane, number>> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}

function save(pane: Pane, width: number | null) {
  try {
    const widths = load()
    if (width === null) delete widths[pane]
    else widths[pane] = width
    localStorage.setItem(KEY, JSON.stringify(widths))
  } catch {
    // Without storage the pane simply opens at its default width next time.
  }
}

function apply(pane: Pane, width: number | null) {
  const style = document.documentElement.style
  if (width === null) style.removeProperty(`--${pane}-width`)
  else style.setProperty(`--${pane}-width`, `${width}px`)
}

/** Puts back the widths the panes were dragged to last time, before the first frame. */
export function restorePaneWidths() {
  const widths = load()
  for (const pane of Object.keys(LIMITS) as Pane[]) {
    const width = widths[pane]
    if (typeof width === 'number') apply(pane, clamp(pane, width))
  }
}

function clamp(pane: Pane, width: number, max = LIMITS[pane][1]): number {
  return Math.round(Math.min(Math.max(width, LIMITS[pane][0]), Math.max(LIMITS[pane][0], max)))
}

/**
 * A thin handle on a pane's edge, placed next to it in the app row. Drag or use the arrow keys to
 * resize, double-click to go back to the default width. The sidebar grows to the right and the
 * right panel to the left; it keeps one width for changes and another for artifacts.
 */
export function Resizer({ pane }: { pane: Pane }) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; width: number; max: number; sign: number } | null>(null)
  const [width, setWidth] = useState<number | null>(null)

  // The handle sits between the pane and the conversation, so it is never scrolled away.
  const paneEl = () => ((pane === 'sidebar' ? ref.current?.previousElementSibling : ref.current?.nextElementSibling) as HTMLElement | null) ?? null
  const maxWidth = (el: HTMLElement) => {
    const app = el.parentElement
    if (!app) return LIMITS[pane][1]
    // A page laid over the conversation, such as the library, takes no room in the row.
    const others = [...app.children].filter((c) => c !== el && !c.classList.contains('hx-main') && getComputedStyle(c).position !== 'absolute')
    const taken = others.reduce((sum, c) => sum + c.getBoundingClientRect().width, 0)
    return Math.min(LIMITS[pane][1], app.clientWidth - taken - MAIN_MIN)
  }
  const set = (next: number) => {
    apply(pane, next)
    setWidth(next)
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const el = paneEl()
    if (event.button !== 0 || !el) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const rtl = getComputedStyle(el).direction === 'rtl'
    const sign = (pane === 'sidebar' ? 1 : -1) * (rtl ? -1 : 1)
    drag.current = { x: event.clientX, width: el.getBoundingClientRect().width, max: maxWidth(el), sign }
    document.documentElement.dataset.resizing = ''
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    set(clamp(pane, d.width + (event.clientX - d.x) * d.sign, d.max))
  }
  const onPointerUp = () => {
    if (!drag.current) return
    drag.current = null
    delete document.documentElement.dataset.resizing
    const el = paneEl()
    if (el) save(pane, Math.round(el.getBoundingClientRect().width))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const el = paneEl()
    if (!el || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
    event.preventDefault()
    const rtl = getComputedStyle(el).direction === 'rtl'
    const grow = (event.key === 'ArrowRight') !== (pane !== 'sidebar') !== rtl
    const next = clamp(pane, el.getBoundingClientRect().width + (grow ? STEP : -STEP), maxWidth(el))
    set(next)
    save(pane, next)
  }
  const reset = () => {
    apply(pane, null)
    setWidth(null)
    save(pane, null)
  }

  return (
    <div
      ref={ref}
      className={`hx-resize is-${pane}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={t(`resize.${pane}`)}
      aria-valuemin={LIMITS[pane][0]}
      aria-valuemax={LIMITS[pane][1]}
      aria-valuenow={width ?? undefined}
      title={t('resize.hint')}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onDoubleClick={reset}
      onKeyDown={onKeyDown}
    />
  )
}
