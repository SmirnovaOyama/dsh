import type { LucideIcon } from 'lucide-react'

export function Icon({ icon: Glyph, size = 20, className }: { icon: LucideIcon; size?: 14 | 16 | 18 | 20; className?: string }) {
  const classes = ['oy-icon', size === 20 ? '' : `ic${size}`, className ?? ''].filter(Boolean).join(' ')
  return <Glyph className={classes} size={size} strokeWidth={1.75} aria-hidden="true" focusable="false" />
}
