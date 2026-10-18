import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface ModalProps {
  open: boolean
  onClose(): void
  title: string
  body?: ReactNode
  children?: ReactNode
  actions: ReactNode
}

export function Modal({ open, onClose, title, body, children, actions }: ModalProps) {
  const titleId = useId()
  const cardRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const card = cardRef.current
    const target = card?.querySelector<HTMLElement>('[data-autofocus]') ?? card?.querySelector<HTMLElement>('input, textarea, button')
    target?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
      } else if (event.key === 'Tab' && card) {
        // Keep focus inside the dialog.
        const focusable = Array.from(card.querySelectorAll<HTMLElement>('input, textarea, button:not(:disabled)'))
        if (!focusable.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      previous?.focus({ preventScroll: true })
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div className="modal-overlay" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-shell" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div ref={cardRef} className="modal-card is-dialog">
          <h2 className="modal-title" id={titleId}>
            {title}
          </h2>
          {body && <p className="modal-body">{body}</p>}
          {children}
          <div className="oy-modal-actions">{actions}</div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
