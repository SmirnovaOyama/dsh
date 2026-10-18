interface SegmentedProps<T extends string> {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange(value: T): void
}

/** The selected segment turns bold; each label reserves its bold width so nothing shifts. */
export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="oy-segmented" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="seg"
          role="tab"
          aria-selected={option.value === value}
          onClick={() => onChange(option.value)}
        >
          <span className="hx-reserve">
            <span className="bold" aria-hidden="true">
              {option.label}
            </span>
            <span>{option.label}</span>
          </span>
        </button>
      ))}
    </div>
  )
}
