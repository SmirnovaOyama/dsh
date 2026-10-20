import { FilePen, FilePlus, Terminal } from 'lucide-react'
import type { PermissionRequest } from '../../shared/types'
import { tildify } from '../format'
import { t } from '../i18n'
import { actions, useApp } from '../store'
import { DiffStatsText, DiffView } from './DiffView'
import { Icon } from './Icon'

export function PermissionPanel({ request }: { request: PermissionRequest }) {
  const home = useApp((s) => s.app.home)
  const titleId = `perm-${request.id}`

  if (request.kind === 'command') {
    const prefix = request.prefix
    return (
      <section className="hx-perm" aria-labelledby={titleId}>
        <div className="q">
          <Icon icon={Terminal} />
          <div className="text">
            <h3 id={titleId}>{t('perm.commandTitle')}</h3>
            <p className="why">{t('perm.cwd', { cwd: tildify(request.cwd ?? '', home) })}</p>
          </div>
        </div>
        <div className="hx-code">
          <pre className="is-plain is-wrap">{request.command}</pre>
        </div>
        <div className="acts">
          <span className="hx-hint grow">
            <span>{t('perm.hintAllow')}</span>
            <span>{t('perm.hintDeny')}</span>
          </span>
          <button type="button" className="btn-secondary" onClick={() => void actions.respond({ type: 'deny' })}>
            {t('perm.deny')}
          </button>
          {prefix && (
            <button
              type="button"
              className="btn-tonal hx-perm-always"
              title={t('perm.always', { prefix })}
              onClick={() => void actions.respond({ type: 'allowAlways', prefix })}
            >
              <span>{t('perm.always', { prefix })}</span>
            </button>
          )}
          <button type="button" className="btn-primary" data-perm-allow onClick={() => void actions.respond({ type: 'allow' })}>
            {t('perm.allow')}
          </button>
        </div>
      </section>
    )
  }

  const stats = request.stats ?? { added: 0, removed: 0 }
  return (
    <section className="hx-perm" aria-labelledby={titleId}>
      <div className="q">
        <Icon icon={request.created ? FilePlus : FilePen} />
        <div className="text">
          <h3 id={titleId}>{t(request.created ? 'perm.createTitle' : 'perm.editTitle')}</h3>
          <p className="why hx-perm-file">
            <span className="hx-mono">{request.path}</span>
            <span className="stats">
              <DiffStatsText added={stats.added} removed={stats.removed} />
              <span>{t('perm.lines')}</span>
            </span>
          </p>
        </div>
      </div>
      {request.lines && request.lines.length > 0 && (
        <div className="box">
          <DiffView lines={request.lines} label={t('changes.diff', { path: request.path ?? '' })} />
        </div>
      )}
      <div className="acts">
        <span className="hx-hint grow">
          <span>{t('perm.hintAllow')}</span>
          <span>{t('perm.hintDeny')}</span>
        </span>
        <button type="button" className="btn-secondary" onClick={() => void actions.respond({ type: 'deny' })}>
          {t('perm.deny')}
        </button>
        <button type="button" className="btn-tonal" onClick={() => void actions.respond({ type: 'allowSession' })}>
          {t('perm.allowSession')}
        </button>
        <button type="button" className="btn-primary" data-perm-allow onClick={() => void actions.respond({ type: 'allow' })}>
          {t('perm.allow')}
        </button>
      </div>
    </section>
  )
}

/** Enter allows and Esc declines, unless focus is somewhere that uses those keys itself. */
export function permissionKey(event: KeyboardEvent, composerHasText: boolean): boolean {
  if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false
  const target = event.target as HTMLElement | null
  const inComposer = target?.closest('.hx-field') !== null && target?.tagName === 'TEXTAREA'
  const inControl = !inComposer && !!target?.closest('button, input, textarea, select, a, [role="menu"]')
  if (event.key === 'Enter') {
    if (inControl || (inComposer && composerHasText)) return false
    const allowButton = document.querySelector<HTMLButtonElement>('[data-perm-allow]')
    if (allowButton) allowButton.click()
    else void actions.respond({ type: 'allow' })
    return true
  }
  if (event.key === 'Escape') {
    if (inControl) return false
    void actions.respond({ type: 'deny' })
    return true
  }
  return false
}
