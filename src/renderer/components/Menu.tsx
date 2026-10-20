import { Check } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

interface MenuProps {
  anchor: HTMLElement | null
  open: boolean
  onClose(): void
  label: string
  side?: 'bottom' | 'top'
  align?: 'start' | 'end'
  /** Match the anchor's width, as a select does. */
  matchWidth?: boolean
  minWidth?: number
  children: ReactNode
}

const ITEMS = '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)'

/** A popover menu in a portal, placed against its anchor, so opening it never moves the layout. */
export function Menu({ anchor, open, onClose, label, side = 'bottom', align = 'start', matchWidth, minWidth, children }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useLayoutEffect(() => {
    if (open && anchor) setRect(anchor.getBoundingClientRect())
  }, [open, anchor])

  // The menu renders once its anchor is measured; wire it up only then, so focus and outside clicks see it.
  const placed = rect !== null
  useEffect(() => {
    if (!open || !placed) return
    const menu = ref.current
    const items = () => Array.from(menu?.querySelectorAll<HTMLElement>(ITEMS) ?? [])
    const first = items().find((el) => el.getAttribute('aria-checked') === 'true') ?? items()[0]
    first?.focus({ preventScroll: true })

    const close = (returnFocus: boolean) => {
      onCloseRef.current()
      if (returnFocus) anchor?.focus({ preventScroll: true })
    }
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (menu?.contains(target) || anchor?.contains(target)) return
      close(false)
    }
    const onKey = (event: KeyboardEvent) => {
      const list = items()
      const index = list.indexOf(document.activeElement as HTMLElement)
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close(true)
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        list[(index + step + list.length) % list.length]?.focus()
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        list[event.key === 'Home' ? 0 : list.length - 1]?.focus()
      } else if (event.key === 'Tab') {
        close(false)
      }
    }
    const onResize = () => close(false)
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('blur', onResize)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('blur', onResize)
    }
  }, [open, anchor, placed])

  if (!open || !rect) return null
  const style: CSSProperties = {
    minWidth: matchWidth ? rect.width : minWidth,
    maxWidth: Math.max(rect.width, 360),
  }
  if (side === 'bottom') style.top = rect.bottom + 4
  else style.bottom = window.innerHeight - rect.top + 4
  if (align === 'start') style.left = rect.left
  else style.right = window.innerWidth - rect.right

  return createPortal(
    <div ref={ref} className="oy-menu hx-menu" role="menu" aria-label={label} data-side={side} style={style}>
      {children}
    </div>,
    document.body,
  )
}

interface MenuItemProps {
  onSelect(): void
  /** Set for choices; the chosen one shows a check. */
  checked?: boolean
  icon?: ReactNode
  desc?: string
  sub?: string
  danger?: boolean
  disabled?: boolean
  children: ReactNode
}

export function MenuItem({ onSelect, checked, icon, desc, sub, danger, disabled, children }: MenuItemProps) {
  const isChoice = checked !== undefined
  const classes = ['oy-menu-item', desc || sub ? 'has-desc' : '', danger ? 'is-danger' : ''].filter(Boolean).join(' ')
  return (
    <button
      type="button"
      className={classes}
      role={isChoice ? 'menuitemradio' : 'menuitem'}
      aria-checked={isChoice ? checked : undefined}
      tabIndex={-1}
      disabled={disabled}
      onClick={onSelect}
    >
      {icon}
      <span className="grow">
        <span style={{ display: 'block' }}>{children}</span>
        {desc && <span className="desc">{desc}</span>}
        {sub && <span className="sub">{sub}</span>}
      </span>
      {isChoice && <Icon icon={Check} size={16} className="check" />}
    </button>
  )
}

export function MenuSeparator() {
  return <div className="oy-menu-sep" role="separator" />
}

/** A quiet heading over a group of items. */
export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="hx-menu-label" role="presentation">
      {children}
    </div>
  )
}
