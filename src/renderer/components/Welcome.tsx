import { FolderOpen, KeyRound } from 'lucide-react'
import { t } from '../i18n'
import { actions } from '../store'
import { FolderDoodle, KeyDoodle } from './Doodles'
import { Icon } from './Icon'

export function NoKey() {
  return (
    <div className="hx-empty">
      <KeyDoodle label={t('error.no-key.title')} />
      <h2>{t('error.no-key.title')}</h2>
      <p>{t('error.no-key.body')}</p>
      <button type="button" className="btn-primary" onClick={() => actions.openSettings('connection')}>
        <Icon icon={KeyRound} size={18} />
        {t('welcome.keyAction')}
      </button>
    </div>
  )
}

export function NoFolder() {
  return (
    <div className="hx-empty">
      <FolderDoodle label={t('welcome.folderTitle')} />
      <h2>{t('welcome.folderTitle')}</h2>
      <p>{t('welcome.folderBody')}</p>
      <button type="button" className="btn-primary" onClick={() => void actions.pickWorkspace()}>
        <Icon icon={FolderOpen} size={18} />
        {t('welcome.folderAction')}
      </button>
    </div>
  )
}
