import { t } from '../i18n'
import { PageHead } from './PageHead'

/** Every artifact across conversations. The list itself comes with the artifacts feature. */
export function LibraryView() {
  return (
    <main className="hx-page">
      <PageHead title={t('library.title')} />
      <div className="hx-page-body">
        <p className="hx-page-empty">{t('artifacts.empty')}</p>
      </div>
    </main>
  )
}
