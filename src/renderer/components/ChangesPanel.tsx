import { ChevronRight, GitCommitHorizontal, Undo2, X } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import type { FileChange } from '../../shared/types'
import { t } from '../i18n'
import { actions, useApp, type ChatState } from '../store'
import type { Motion } from '../App'
import { DiffStatsText, DiffView } from './DiffView'
import { Icon } from './Icon'
import { Modal } from './Modal'

/** Every changed file stacked in one scroll, each with its own header that stays on top while you read it. */
export function ChangesPanel({ chat, motion }: { chat: ChatState | null; motion: Motion }) {
  const selected = useApp((s) => s.selectedFile)
  const isGitRepo = useApp((s) => s.workspace?.isGitRepo ?? false)
  const changes = chat?.changes ?? []
  const running = chat ? chat.session.status !== 'idle' : false
  const added = changes.reduce((n, c) => n + c.stats.added, 0)
  const removed = changes.reduce((n, c) => n + c.stats.removed, 0)
  const [dialog, setDialog] = useState<'revert' | 'commit' | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Opening a file from the conversation brings its section to the top of the panel.
  useEffect(() => {
    if (!selected) return
    const section = listRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(selected)}"]`)
    section?.scrollIntoView({ block: 'start' })
  }, [selected])

  return (
    <aside className="hx-changes" data-motion={motion} aria-label={t('changes.label')} inert={motion === 'out'}>
      <div className="hx-changes-head">
        <h2>{t('changes.title')}</h2>
        {changes.length > 0 && (
          <span className="sum">
            {t('changes.count', { n: changes.length })}
            <span className="stats">
              <DiffStatsText added={added} removed={removed} showZero />
            </span>
          </span>
        )}
        <span className="grow" />
        <button
          type="button"
          className="btn-ghost hx-icon-btn"
          disabled={!changes.length || running}
          aria-label={t('changes.revert')}
          title={running ? t('changes.busy') : t('changes.revert')}
          onClick={() => setDialog('revert')}
        >
          <Icon icon={Undo2} size={16} />
        </button>
        <button
          type="button"
          className="btn-secondary hx-commit"
          disabled={!changes.length || running || !isGitRepo}
          title={isGitRepo ? undefined : t('changes.noGit')}
          onClick={() => setDialog('commit')}
        >
          <Icon icon={GitCommitHorizontal} size={16} />
          {t('changes.commit')}
        </button>
        <button
          type="button"
          className="btn-ghost hx-icon-btn"
          aria-label={t('header.hideChanges')}
          title={t('header.hideChanges')}
          onClick={() => actions.toggleChanges(false)}
        >
          <Icon icon={X} size={16} />
        </button>
      </div>

      {changes.length === 0 ? (
        <div className="hx-changes-empty">{t('changes.empty')}</div>
      ) : (
        <div className="hx-changes-list" ref={listRef}>
          {changes.map((change) => (
            <FileSection key={change.path} change={change} />
          ))}
        </div>
      )}

      <RevertDialog open={dialog === 'revert'} count={changes.length} onClose={() => setDialog(null)} />
      {dialog === 'commit' && <CommitDialog title={chat?.session.title ?? ''} onClose={() => setDialog(null)} />}
    </aside>
  )
}

const fileName = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const folder = (p: string) => p.slice(0, Math.max(p.lastIndexOf('/'), 0))

const FileSection = memo(function FileSection({ change }: { change: FileChange }) {
  const [open, setOpen] = useState(true)
  const note = change.status === 'added' ? t('changes.added') : change.status === 'deleted' ? t('changes.deleted') : null
  const dir = folder(change.path)
  return (
    <section className="hx-cfile" data-path={change.path}>
      <button type="button" className="hx-cfile-head" aria-expanded={open} title={change.path} onClick={() => setOpen((o) => !o)}>
        <Icon icon={ChevronRight} size={14} className="hx-chev" />
        <span className="p">
          <bdi className="name">{fileName(change.path)}</bdi>
          {dir && <bdi className="dir">{dir}</bdi>}
        </span>
        {note && <span className="note">{note}</span>}
        <span className="n">
          <DiffStatsText added={change.stats.added} removed={change.stats.removed} />
        </span>
      </button>
      <div className={`hx-disc ${open ? 'is-open' : ''}`}>
        <div>
          <div className="hx-cfile-body">
            <DiffView lines={change.lines} label={t('changes.diff', { path: change.path })} />
          </div>
        </div>
      </div>
    </section>
  )
})

function RevertDialog({ open, count, onClose }: { open: boolean; count: number; onClose(): void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('changes.revertTitle')}
      body={t('changes.revertBody', { n: count })}
      actions={
        <>
          <button type="button" className="btn-secondary" data-autofocus onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={() => {
              onClose()
              void actions.revertAll()
            }}
          >
            {t('changes.revertConfirm')}
          </button>
        </>
      }
    />
  )
}

function CommitDialog({ title, onClose }: { title: string; onClose(): void }) {
  const [message, setMessage] = useState(title)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    if (!message.trim() || busy) return
    setBusy(true)
    setError(null)
    const result = await actions.commit(message.trim())
    setBusy(false)
    if (result.ok) onClose()
    else setError(t('changes.commitFailed', { error: result.error ?? '' }))
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={t('changes.commitTitle')}
      actions={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn-primary" disabled={!message.trim() || busy} onClick={() => void submit()}>
            {t('changes.commitConfirm')}
          </button>
        </>
      }
    >
      <label className="oy-field-label" htmlFor="hx-commit">
        {t('changes.commitLabel')}
      </label>
      <textarea
        id="hx-commit"
        className="input-base"
        rows={3}
        value={message}
        data-autofocus
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void submit()
          }
        }}
      />
      {error && <p className="hx-modal-error">{error}</p>}
    </Modal>
  )
}
