import { PanelLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { t } from '../i18n'
import { actions, useApp } from '../store'
import { Icon } from './Icon'

/** The title of a page the sidebar opens, in the same column as its content, with actions on the right. */
export function PageHead({ title, scrolled, children }: { title: string; scrolled?: boolean; children?: ReactNode }) {
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
      <div className="in hx-page-head-row">
        <h1>{title}</h1>
        {children}
      </div>
    </header>
  )
}
