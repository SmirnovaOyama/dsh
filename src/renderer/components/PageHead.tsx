import { ChevronLeft, PanelLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { t } from '../i18n'
import { actions, useApp } from '../store'
import { Icon } from './Icon'

/** The title of a page the sidebar opens, in the same column as its content, with actions on the right. */
interface PageHeadProps {
  title: string
  scrolled?: boolean
  /** A way back to the page this one was opened from, named by `backLabel`. */
  onBack?: () => void
  backLabel?: string
  children?: ReactNode
}

export function PageHead({ title, scrolled, onBack, backLabel, children }: PageHeadProps) {
  const showSidebar = useApp((s) => s.showSidebar)
  return (
    <header className={`hx-page-head ${scrolled ? 'is-scrolled' : ''}`}>
      {!showSidebar && (
        <button
          type="button"
          className="btn-ghost hx-icon-btn hx-page-toggle"
          aria-label={t('sidebar.show')}
          title={t('sidebar.show')}
          onClick={() => actions.toggleSidebar()}
        >
          <Icon icon={PanelLeft} size={18} />
        </button>
      )}
      <div className="in">
        {onBack && (
          <button type="button" className="hx-page-back" onClick={onBack}>
            <Icon icon={ChevronLeft} size={16} />
            {backLabel}
          </button>
        )}
        <div className="hx-page-head-row">
          <h1>{title}</h1>
          {children}
        </div>
      </div>
    </header>
  )
}
