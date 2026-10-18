import { ChevronDown } from 'lucide-react'
import { useRef, useState } from 'react'
import { Icon } from './Icon'
import { Menu, MenuItem } from './Menu'

interface SelectProps<T extends string | number> {
  label: string
  value: T
  options: { value: T; label: string; desc?: string }[]
  onChange(value: T): void
  className?: string
}

export function Select<T extends string | number>({ label, value, options, onChange, className }: SelectProps<T>) {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`oy-select ${open ? 'is-open' : ''} ${className ?? ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}, ${current?.label ?? ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="hx-tabular" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {current?.label}
        </span>
        <Icon icon={ChevronDown} className="chev" />
      </button>
      <Menu anchor={ref.current} open={open} onClose={() => setOpen(false)} label={label} matchWidth align="end">
        {options.map((option) => (
          <MenuItem
            key={String(option.value)}
            checked={option.value === value}
            desc={option.desc}
            onSelect={() => {
              setOpen(false)
              onChange(option.value)
              ref.current?.focus()
            }}
          >
            {option.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
