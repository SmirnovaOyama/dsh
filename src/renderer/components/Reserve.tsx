import type { ReactNode } from 'react'

/** Stacks every form a label can take, so switching between them never changes its width. */
export function Reserve({ shown, forms }: { shown: number; forms: ReactNode[] }) {
  return (
    <span className="hx-reserve">
      {forms.map((form, i) => (
        <span key={i} data-hidden={i === shown ? undefined : 'true'} aria-hidden={i === shown ? undefined : true}>
          {form}
        </span>
      ))}
    </span>
  )
}
