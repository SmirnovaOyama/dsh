import { Shapes } from 'lucide-react'
import { t } from '../i18n'
import { Icon } from './Icon'
import { PageHead } from './PageHead'

/** Every artifact across conversations. The list itself comes with the artifacts feature. */
export function LibraryView() {
  return (
    <main className="hx-main">
      <PageHead title={t('library.title')} />
      <div className="hx-page-list">
        <div className="hx-page-empty">
          <Icon icon={Shapes} size={20} />
          <p>{t('artifacts.empty')}</p>
        </div>
      </div>
    </main>
  )
}
