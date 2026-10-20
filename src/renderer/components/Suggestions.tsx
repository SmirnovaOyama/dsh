import { FileText } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Icon } from './Icon'

export interface Suggestion {
  id: string
  label: string
  /** Words that may follow, such as "[重點]". */
  hint?: string
  /** A description, or the folder a file is in. */
  detail?: string
  /** A quiet label at the end, such as "專案". */
  tag?: string
  file?: boolean
}

interface SuggestionsProps {
  id: string
  label: string
  items: Suggestion[]
  active: number
  onHover(index: number): void
  onPick(index: number): void
}

/**
 * The list above the composer for / and @. Focus stays in the text box; the box points at the
 * active row with aria-activedescendant, so arrow keys and typing both keep working.
 */
export function Suggestions({ id, label, items, active, onHover, onPick }: SuggestionsProps) {
  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`#${id}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [id, active])
  return (
    <ul ref={listRef} id={id} className="hx-suggest" role="listbox" aria-label={label}>
      {items.map((item, i) => (
        <li
          key={item.id}
          id={`${id}-${i}`}
          role="option"
          aria-selected={i === active}
          className={item.file ? 'is-file' : undefined}
          // Keep focus in the text box when a row is clicked.
          onPointerDown={(event) => event.preventDefault()}
          onPointerMove={() => i !== active && onHover(i)}
          onClick={() => onPick(i)}
        >
          {item.file && <Icon icon={FileText} size={16} />}
          <span className="label">{item.label}</span>
          {item.hint && <span className="hint">{item.hint}</span>}
          {item.detail && <span className="detail">{item.detail}</span>}
          {item.tag && <span className="tag">{item.tag}</span>}
        </li>
      ))}
    </ul>
  )
}
