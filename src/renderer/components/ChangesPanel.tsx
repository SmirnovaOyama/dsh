import { FileMinus, FilePen, FilePlus, GitCommitHorizontal, Undo2 } from 'lucide-react'
import { useState } from 'react'
import type { FileChange } from '../../shared/types'
import { t } from '../i18n'
import { actions, useApp, type ChatState } from '../store'
import { DiffStatsText, DiffView } from './DiffView'
import { Icon } from './Icon'
import { Modal } from './Modal'

const FILE_ICON = { added: FilePlus, modified: FilePen, deleted: FileMinus }

export function ChangesPanel({ chat }: { chat: ChatState | null }) {
  const selected = useApp((s) => s.selectedFile)
  const isGitRepo = useApp((s) => s.workspace?.isGitRepo ?? false)
  const changes = chat?.changes ?? []
  const running = chat ? chat.session.status !== 'idle' : false
  const current = changes.find((c) => c.path === selected) ?? changes[0]
  const added = changes.reduce((n, c) => n + c.stats.added, 0)
  const removed = changes.reduce((n, c) => n + c.stats.removed, 0)
  const [dialog, setDialog] = useState<'revert' | 'commit' | null>(null)

  return (
    <aside className="hx-changes" aria-label={t('changes.label')}>
      <div className="hx-changes-head">
        <h2>{t('changes.title')}</h2>
        {changes.length > 0 && <span className="count">{t('changes.count', { n: changes.length })}</span>}
        {changes.length > 0 && (
          <span className="total">
            <DiffStatsText added={added} removed={removed} showZero />
          </span>
        )}
      </div>

      {changes.length === 0 ? (
        <div className="hx-changes-empty">{t('changes.empty')}</div>
      ) : (
        <>
          <div className="hx-files">
            {changes.map((change) => (
              <button
                key={change.path}
                type="button"
                className="hx-file"
                aria-current={change === current}
                title={change.path}
                onClick={() => actions.selectFile(change.path)}
              >
                <Icon icon={FILE_ICON[change.status]} size={16} />
                <span className="p">
                  <bdi className="name">{fileName(change.path)}</bdi>
                  {folder(change.path) && <bdi className="dir">{folder(change.path)}</bdi>}
                </span>
                <span className="n">
                  <DiffStatsText added={change.stats.added} removed={change.stats.removed} />
                </span>
              </button>
            ))}
          </div>
          <div className="hx-diff-wrap">{current && <FileDiff change={current} />}</div>
        </>
      )}

      <div className="hx-changes-foot">
        <button
          type="button"
          className="btn-secondary"
          disabled={!changes.length || running}
          title={running ? t('changes.busy') : undefined}
          onClick={() => setDialog('revert')}
        >
          <Icon icon={Undo2} size={18} />
          {t('changes.revert')}
        </button>
        <button type="button" className="btn-tonal" disabled={!changes.length || running || !isGitRepo} onClick={() => setDialog('commit')}>
          <Icon icon={GitCommitHorizontal} size={18} />
          {t('changes.commit')}
        </button>
      </div>

      <RevertDialog open={dialog === 'revert'} count={changes.length} onClose={() => setDialog(null)} />
      {dialog === 'commit' && <CommitDialog title={chat?.session.title ?? ''} onClose={() => setDialog(null)} />}
    </aside>
  )
}

const fileName = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const folder = (p: string) => p.slice(0, Math.max(p.lastIndexOf('/'), 0))

function FileDiff({ change }: { change: FileChange }) {
  const note = change.status === 'added' ? t('changes.added') : change.status === 'deleted' ? t('changes.deleted') : null
  return (
    <>
      <p className="hx-diff-file">
        <span className="p">{change.path}</span>
        {note && <span>{note}</span>}
      </p>
      <DiffView lines={change.lines} label={t('changes.diff', { path: change.path })} />
    </>
  )
}

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
