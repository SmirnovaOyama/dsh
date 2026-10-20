import { PanelLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { t } from '../i18n'
import { actions, useApp } from '../store'
import { Icon } from './Icon'

/** The title row of a page the sidebar opens, with room for actions on the right. */
export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  const showSidebar = useApp((s) => s.showSidebar)
  return (
    <header className="hx-header hx-page-title">
      {!showSidebar && (
        <button
          type="button"
          className="btn-ghost hx-icon-btn"
          aria-label={t('sidebar.show')}
          title={t('sidebar.show')}
          onClick={() => actions.toggleSidebar()}
        >
          <Icon icon={PanelLeft} size={18} />
        </button>
      )}
      <div className="heading">
        <h1 className="title">{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {children && <div className="actions">{children}</div>}
    </header>
  )
}
