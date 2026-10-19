import { ChevronRight, ChevronsDownUp, ChevronsUpDown, GitCommitHorizontal, Undo2, X } from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { FileChange } from '../../shared/types'
import { t } from '../i18n'
import { actions, useApp, type ChatState } from '../store'
import type { Motion } from '../App'
import { DiffStatsText, DiffView } from './DiffView'
import { ArtifactsView } from './ArtifactsView'
import { FilesView } from './FilesView'
import { Icon } from './Icon'
import { Modal } from './Modal'

/** Every changed file stacked in one scroll, each with its own header that stays on top while you read it. */
export function ChangesPanel({ chat, motion }: { chat: ChatState | null; motion: Motion }) {
  const selected = useApp((s) => s.selectedFile)
  const tab = useApp((s) => s.panelTab)
  const isGitRepo = useApp((s) => s.workspace?.isGitRepo ?? false)
  const changes = chat?.changes ?? []

  const running = chat ? chat.session.status !== 'idle' : false
  const added = changes.reduce((n, c) => n + c.stats.added, 0)
  const removed = changes.reduce((n, c) => n + c.stats.removed, 0)
  const [dialog, setDialog] = useState<'revert' | 'commit' | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const sessionId = chat?.session.id ?? null
  // Which files are unfolded; a file not in here uses the default for this many changes.
  const [folds, setFolds] = useState<{ session: string | null; open: Record<string, boolean> }>({ session: sessionId, open: {} })
  const open = folds.session === sessionId ? folds.open : {}
  const fewChanges = changes.length <= 3 && changes.reduce((n, c) => n + c.lines.length, 0) <= 300
  const isOpen = (path: string) => open[path] ?? fewChanges
  const allOpen = changes.length > 0 && changes.every((c) => isOpen(c.path))

  const setOpen = useCallback(
    (paths: string[], value: boolean) =>
      setFolds((f) => {
        const next = f.session === sessionId ? { ...f.open } : {}
        for (const path of paths) next[path] = value
        return { session: sessionId, open: next }
      }),
    [sessionId],
  )
  const toggle = useCallback(
    (path: string, value: boolean) => {
      // Folding a file you have scrolled into keeps its header where your eyes are.
      const list = listRef.current
      const section = list?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)
      if (!value && list && section && section.offsetTop < list.scrollTop) list.scrollTop = section.offsetTop
      setOpen([path], value)
    },
    [setOpen],
  )

  // Opening a file from the conversation unfolds it and brings it to the top of the panel.
  useEffect(() => {
    if (!selected) return
    setOpen([selected], true)
    const section = listRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(selected)}"]`)
    section?.scrollIntoView({ block: 'start' })
  }, [selected, setOpen])

  // An artifact takes the whole panel, with its own title bar, as it does in Claude.
  if (tab === 'artifacts') {
    return (
      <aside className="hx-changes is-artifacts" data-motion={motion} aria-label={t('artifact.label')} inert={motion === 'out'}>
        <ArtifactsView />
      </aside>
    )
  }

  return (
    <aside className="hx-changes" data-motion={motion} aria-label={t('changes.label')} inert={motion === 'out'}>
      <div className="hx-changes-head">
        <div className="hx-tabs" role="tablist" aria-label={t('changes.label')}>
          {(['changes', 'files'] as const).map((id) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => actions.setPanelTab(id)}>
              {t(`panel.${id}`)}
            </button>
          ))}
        </div>
        {tab === 'changes' && changes.length > 0 && (
          <span className="sum">
            {t('changes.count', { n: changes.length })}
            <span className="stats">
              <DiffStatsText added={added} removed={removed} showZero />
            </span>
          </span>
        )}
        <span className="grow" />
        {tab === 'changes' && (
          <>
            <button
              type="button"
              className="btn-ghost hx-icon-btn"
              disabled={!changes.length}
              aria-label={t(allOpen ? 'changes.collapseAll' : 'changes.expandAll')}
              title={t(allOpen ? 'changes.collapseAll' : 'changes.expandAll')}
              onClick={() => {
                if (listRef.current) listRef.current.scrollTop = 0
                setOpen(
                  changes.map((c) => c.path),
                  !allOpen,
                )
              }}
            >
              <Icon icon={allOpen ? ChevronsDownUp : ChevronsUpDown} size={16} />
            </button>
            <button
              type="button"
              className="btn-ghost hx-revert"
              disabled={!changes.length || running}
              aria-label={t('changes.revert')}
              title={running ? t('changes.busy') : t('changes.revert')}
              onClick={() => setDialog('revert')}
            >
              <Icon icon={Undo2} size={16} />
              <span className="label">{t('changes.revertShort')}</span>
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
          </>
        )}
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

      {tab === 'files' ? (
        <FilesView />

      ) : changes.length === 0 ? (
        <div className="hx-changes-empty">{t('changes.empty')}</div>
      ) : (
        <div className="hx-changes-list" ref={listRef}>
          {changes.map((change) => (
            <FileSection key={change.path} change={change} open={isOpen(change.path)} onToggle={toggle} />
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

/** Up and down arrows step between file headers; Enter and Space fold them as usual. */
function moveBetweenFiles(event: KeyboardEvent<HTMLButtonElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const heads = [...(event.currentTarget.closest('.hx-changes-list')?.querySelectorAll<HTMLButtonElement>('.hx-cfile-head') ?? [])]
  const next = heads[heads.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1)]
  if (!next) return
  event.preventDefault()
  next.focus()
}

const FileSection = memo(function FileSection({ change, open, onToggle }: { change: FileChange; open: boolean; onToggle(path: string, open: boolean): void }) {
  // A folded file renders nothing until it is first opened, so a long list stays light.
  const [rendered, setRendered] = useState(open)
  if (open && !rendered) setRendered(true)
  const note = change.status === 'added' ? t('changes.added') : change.status === 'deleted' ? t('changes.deleted') : null
  const dir = folder(change.path)
  return (
    <section className="hx-cfile" data-path={change.path}>
      <button type="button" className="hx-cfile-head" aria-expanded={open} title={change.path} onClick={() => onToggle(change.path, !open)} onKeyDown={moveBetweenFiles}>
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
          {rendered && (
            <div className="hx-cfile-body">
              <DiffView lines={change.lines} label={t('changes.diff', { path: change.path })} />
            </div>
          )}
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
