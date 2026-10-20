import {
  Check,
  ChevronDown,
  ChevronLeft,
  CircleAlert,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FolderDown,
  Maximize2,
  Minimize2,
  Monitor,
  RotateCw,
  Smartphone,
  Tablet,
  X,
  type LucideIcon,
} from 'lucide-react'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { diffText } from '../../shared/diff'
import type { ArtifactVersion, SaveResult } from '../../shared/types'
import { api } from '../api'
import {
  artifactIcon,
  codeLanguage,
  fenced,
  fileNameFor,
  hasPreview,
  isArtifact,
  isPage,
  latestArtifacts,
  pageFor,
  typeLabel,
  versionsOf,
  withBridge,
  type ArtifactItem,
} from '../artifacts'
import { clockTime } from '../format'
import { t } from '../i18n'
import { actions, useApp } from '../store'
import { DiffView } from './DiffView'
import { tokenLines } from './FilesView'
import { Icon } from './Icon'
import { Markdown } from './Markdown'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from './Menu'
import { Reserve } from './Reserve'
import { ThinkingMark } from './Thinking'

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Asks where to save an artifact and saves it; null when the person cancels. Never rejects. */
export async function saveArtifact(artifact: ArtifactVersion): Promise<SaveResult | null> {
  try {
    return await api.artifacts.save(fileNameFor(artifact), artifact.content)
  } catch (error) {
    return { ok: false, error: errorText(error) }
  }
}

export function ArtifactsView() {
  const items = useApp((s) => s.chat?.session.items)
  const viewed = useApp((s) => s.viewedArtifact)
  const item = viewed ? items?.find((i) => i.id === viewed) : undefined
  // One viewer per artifact: stepping through its versions keeps the view, another artifact starts fresh.
  if (item && isArtifact(item)) return <ArtifactViewer key={item.artifact.id || item.id} item={item} />
  return <ArtifactList />
}

function CloseButton() {
  return (
    <button type="button" className="btn-ghost hx-icon-btn" aria-label={t('artifact.close')} title={t('artifact.close')} onClick={() => actions.closeArtifacts()}>
      <Icon icon={X} size={16} />
    </button>
  )
}

function ArtifactList() {
  const items = useApp((s) => s.chat?.session.items)
  const list = useMemo(() => latestArtifacts(items ?? []), [items])
  return (
    <>
      <div className="hx-changes-head hx-artifact-list-head">
        <h2>{t('panel.artifacts')}</h2>
        {list.length > 0 && <span className="sum">{t('artifact.count', { n: list.length })}</span>}
        <span className="grow" />
        <CloseButton />
      </div>
      {list.length ? (
        <div className="hx-artifact-list">
          {list.map((item) => (
            <button key={item.id} type="button" className="hx-artifact-row" onClick={() => actions.viewArtifact(item.id)}>
              <span className="kind">{item.status === 'running' && !item.queued ? <ThinkingMark size={16} /> : <Icon icon={artifactIcon(item.artifact.type)} size={16} />}</span>
              <span className="name">{item.artifact.title || t('artifact.untitled')}</span>
              <span className="sub">
                <span>{typeLabel(item.artifact)}</span>
                {item.artifact.version > 1 && <span>{t('artifact.version', { n: item.artifact.version })}</span>}
                {item.status === 'stopped' && <span>{t('artifact.stopped')}</span>}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="hx-changes-empty">{t('artifact.empty')}</div>
      )}
    </>
  )
}

type Mode = 'preview' | 'code' | 'diff'
type Device = 'desktop' | 'tablet' | 'phone'
type Notice = { kind: 'saved'; path: string; inProject: boolean } | { kind: 'failed'; text: string } | { kind: 'link'; url: string }

/** The two ways to look at an artifact; comparing versions lives in the version menu. */
const VIEWS = [
  { value: 'preview', icon: Eye, label: 'artifact.preview' },
  { value: 'code', icon: Code2, label: 'artifact.code' },
] as const
const DEVICES = [
  { value: 'desktop', icon: Monitor, label: 'artifact.device.desktop' },
  { value: 'tablet', icon: Tablet, label: 'artifact.device.tablet' },
  { value: 'phone', icon: Smartphone, label: 'artifact.device.phone' },
] as const

/** What a page may report about itself: a few errors, each cut short. */
const MAX_ERRORS = 5
const MAX_ERROR_LENGTH = 1000

/** A row of icon toggles; each keeps its own width, so choosing one never moves the others. */
function IconToggles<T extends string>(props: {
  label: string
  value: T | null
  options: { value: T; icon: LucideIcon; label: string; title?: string; disabled?: boolean }[]
  onChange(value: T): void
}) {
  return (
    <span className="hx-iconseg" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={props.value === o.value}
          aria-label={o.label}
          title={o.title ?? o.label}
          disabled={o.disabled}
          onClick={() => props.onChange(o.value)}
        >
          <Icon icon={o.icon} size={16} />
        </button>
      ))}
    </span>
  )
}

function ArtifactViewer({ item }: { item: ArtifactItem }) {
  const items = useApp((s) => s.chat?.session.items)
  const busy = useApp((s) => (s.chat ? s.chat.session.status !== 'idle' : true))
  const many = useMemo(() => latestArtifacts(items ?? []).length > 1, [items])
  const versions = useMemo(() => versionsOf(items ?? [], item), [items, item])
  const index = versions.findIndex((v) => v.id === item.id)
  const artifact = item.artifact
  // Written in full but waiting for earlier steps: it can be looked at, not yet copied or saved.
  const queued = item.status === 'running' && !!item.queued
  const writing = item.status === 'running' && !queued
  const ready = item.status === 'done'
  const unfinished = !writing && !queued && !ready
  const page = isPage(artifact.type)
  const last = versions[versions.length - 1]
  const newestDone = versions.findLast((v) => v.status === 'done')
  // A diff is against the version this one was made from, which is never a stopped one.
  const base = versions.slice(0, Math.max(0, index)).findLast((v) => v.status === 'done')

  const [mode, setMode] = useState<Mode>('preview')
  const [full, setFull] = useState(false)
  const [device, setDevice] = useState<Device>('desktop')
  const [reloads, setReloads] = useState(0)
  // A page's errors belong to the version that showed them; another version never shows or sends them.
  const [pageErrors, setPageErrors] = useState<{ item: string; list: string[] }>({ item: item.id, list: [] })
  const errors = pageErrors.item === item.id ? pageErrors.list : []
  const clearErrors = () => setPageErrors({ item: item.id, list: [] })
  const [notice, setNotice] = useState<Notice | null>(null)
  const [copied, setCopied] = useState(false)
  const [menu, setMenu] = useState<'more' | 'versions' | null>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const versionRef = useRef<HTMLButtonElement>(null)

  const previewable = hasPreview(artifact.type)
  const usable: Mode[] = [...(previewable ? (['preview'] as const) : []), 'code', ...(base ? (['diff'] as const) : [])]
  // While the agent writes, and for a version it never finished, the code is what there is to see.
  const shownMode: Mode = writing || unfinished ? 'code' : usable.includes(mode) ? mode : usable[0]

  // Once the agent finishes writing, the preview takes over again.
  const wasWriting = useRef(writing)
  useEffect(() => {
    if (wasWriting.current && !writing) setMode('preview')
    wasWriting.current = writing
  }, [writing])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), notice.kind === 'link' ? 15000 : 5000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const shrink = () => {
    setFull(false)
    moreRef.current?.focus({ preventScroll: true })
  }
  // A choice from the menu leaves focus on the arrow that opened it, once the menu has gone.
  const keepFocus = () => requestAnimationFrame(() => moreRef.current?.focus({ preventScroll: true }))

  // Expanded, the artifact is a dialog over the window: Escape shrinks it before anything else hears
  // the key, and nothing behind it can take focus. It stays where it is in the page, so it keeps running.
  useEffect(() => {
    if (!full) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('.hx-menu')) return
      event.preventDefault()
      event.stopPropagation()
      shrink()
    }
    document.addEventListener('keydown', onKey, true)
    const view = viewRef.current
    const behind = Array.from(view?.closest('.hx-app')?.children ?? []).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && !el.contains(view) && !el.inert,
    )
    for (const el of behind) el.inert = true
    return () => {
      document.removeEventListener('keydown', onKey, true)
      for (const el of behind) el.inert = false
    }
  }, [full])

  const failed = (text: string) => setNotice({ kind: 'failed', text })
  const saveToProject = async () => {
    setMenu(null)
    const saved = await api.artifacts.saveToProject(fileNameFor(artifact), artifact.content).catch((error) => ({ ok: false as const, error: errorText(error) }))
    if (saved.ok) setNotice({ kind: 'saved', path: saved.path, inProject: true })
    else failed(t('artifact.saveFailed', { error: saved.error }))
  }
  const saveAs = async () => {
    setMenu(null)
    const saved = await saveArtifact(artifact)
    if (saved?.ok) setNotice({ kind: 'saved', path: saved.path, inProject: false })
    else if (saved) failed(t('artifact.saveFailed', { error: saved.error }))
  }
  const openInBrowser = async () => {
    setMenu(null)
    const opened = await api.artifacts.openInBrowser(fileNameFor(artifact), pageFor(artifact)).catch((error) => ({ ok: false as const, error: errorText(error) }))
    if (!opened.ok) failed(t('artifact.openFailed', { error: opened.error }))
  }
  // The label stays put while the icon turns into a tick, so the button never changes width.
  const copy = () => {
    void navigator.clipboard.writeText(artifact.content).then(
      () => setCopied(true),
      (error) => failed(errorText(error)),
    )
  }
  const reload = () => {
    setMenu(null)
    setMode('preview')
    setReloads((n) => n + 1)
  }
  // Only the error on screen goes to the agent, fenced off and marked as the page's words, not the person's.
  const fix = () => {
    if (!errors.length) return
    void actions.send(t('artifact.fixPrompt', { title: artifact.title, n: artifact.version, error: fenced(errors[0]) }), { withRefs: false })
    clearErrors()
  }
  // A link the page asks to open waits for the person, and a second request never swaps the address under them.
  const askLink = (url: string) => setNotice((n) => (n?.kind === 'link' ? n : { kind: 'link', url }))

  const html = useMemo(() => (page ? withBridge(pageFor(artifact)) : ''), [page, artifact])
  const versionLabel = (n: number) => t('artifact.version', { n })
  const shortLabel = (n: number) => t('artifact.versionShort', { n })
  const versionSub = (v: ArtifactItem) => {
    if (v.status === 'running') return t(v.queued ? 'artifact.queued' : 'artifact.writing')
    if (v.status !== 'done') return t('artifact.failed')
    if (v.id === newestDone?.id) return t('artifact.latest')
    const at = v.endedAt ?? v.startedAt
    return at ? clockTime(at) : undefined
  }

  return (
    <div
      ref={viewRef}
      className={full ? 'hx-files-view hx-artifact-view hx-artifact-full' : 'hx-files-view hx-artifact-view'}
      role={full ? 'dialog' : undefined}
      aria-modal={full || undefined}
      aria-label={full ? artifact.title : undefined}
    >
      <div className="hx-changes-head hx-artifact-head">
        {many && !full && (
          <button type="button" className="btn-ghost hx-icon-btn hx-to-list" aria-label={t('artifact.back')} title={t('artifact.back')} onClick={() => actions.viewArtifact(null)}>
            <Icon icon={ChevronLeft} size={16} />
          </button>
        )}
        {previewable && (
          <IconToggles<Mode>
            label={t('artifact.view')}
            value={shownMode === 'diff' ? null : shownMode}
            options={VIEWS.map((v) => ({ value: v.value, icon: v.icon, label: t(v.label), disabled: (writing || unfinished) && v.value === 'preview' }))}
            onChange={setMode}
          />
        )}
        <span className="title" title={artifact.title}>
          {artifact.title || t('artifact.untitled')}
        </span>
        <span className="grow" />
        {versions.length > 1 && (
          <button
            ref={versionRef}
            type="button"
            className="btn-ghost hx-version-pick"
            aria-haspopup="menu"
            aria-expanded={menu === 'versions'}
            aria-label={`${t('artifact.versionsMenu')} ${versionLabel(artifact.version)}`}
            title={t('artifact.versionsMenu')}
            onClick={() => setMenu((m) => (m === 'versions' ? null : 'versions'))}
          >
            {/* Holds the width of the longest label, so going from version 10 to 9 moves nothing. */}
            <span className="n long" aria-hidden="true">
              <Reserve shown={0} forms={[versionLabel(artifact.version), versionLabel(last.artifact.version)]} />
            </span>
            <span className="n short" aria-hidden="true">
              <Reserve shown={0} forms={[shortLabel(artifact.version), shortLabel(last.artifact.version)]} />
            </span>
            <Icon icon={ChevronDown} size={14} />
          </button>
        )}
        <span className="hx-split">
          <button type="button" className="copy" disabled={!ready} aria-label={t(copied ? 'copy.done' : 'artifact.copy')} title={t(copied ? 'copy.done' : 'artifact.copy')} onClick={copy}>
            <span className="hx-swap" data-on={copied}>
              <Icon icon={Copy} size={16} />
              <Icon icon={Check} size={16} />
            </span>
            <span className="label">{t('artifact.copyShort')}</span>
          </button>
          <button
            ref={moreRef}
            type="button"
            className="more"
            aria-haspopup="menu"
            aria-expanded={menu === 'more'}
            aria-label={t('artifact.more')}
            title={t('artifact.more')}
            onClick={() => setMenu((m) => (m === 'more' ? null : 'more'))}
          >
            <Icon icon={ChevronDown} size={14} />
          </button>
        </span>
        {full ? (
          <button type="button" className="btn-ghost hx-icon-btn" aria-label={t('artifact.shrink')} title={t('artifact.shrink')} onClick={shrink}>
            <Icon icon={Minimize2} size={16} />
          </button>
        ) : (
          <CloseButton />
        )}
      </div>

      {unfinished && (
        <div className="hx-artifact-unfinished" role="note">
          <Icon icon={CircleAlert} size={16} />
          <span className="text">{t(item.status === 'stopped' ? 'artifact.unfinished.stopped' : 'artifact.unfinished.error')}</span>
          {newestDone && (
            <button type="button" className="btn-ghost" onClick={() => actions.viewArtifact(newestDone.id)}>
              {t('artifact.toLatest')}
            </button>
          )}
        </div>
      )}

      <div className="hx-artifact-body">
        {shownMode === 'code' ? (
          <ArtifactCode item={item} follow={writing} />
        ) : shownMode === 'diff' && base ? (
          <ArtifactDiff before={base} after={item} />
        ) : artifact.type === 'markdown' ? (
          <div className="hx-viewer hx-artifact-doc">
            <Markdown text={artifact.content} />
          </div>
        ) : null}
        {/* The page stays loaded behind the code and the diff, so a look at them neither restarts it nor repeats its errors. */}
        {page && !writing && !unfinished && (
          <Frame
            html={html}
            title={artifact.title}
            device={full ? device : 'desktop'}
            reloads={reloads}
            hidden={shownMode !== 'preview'}
            onLoadStart={clearErrors}
            onError={(error) => setPageErrors((e) => ({ item: item.id, list: e.item === item.id ? [...e.list, error] : [error] }))}
            onEscape={() => full && shrink()}
            onLink={askLink}
          />
        )}

        {/* What just happened sits at the top, the page's errors at the foot, so neither moves the other. */}
        {notice && (
          <div className="hx-artifact-notes is-top">
            <NoticeBar
              notice={notice}
              onClose={() => setNotice(null)}
              onShowFile={(path) => {
                setFull(false)
                actions.viewFile(path)
              }}
            />
          </div>
        )}
        {shownMode === 'preview' && errors.length > 0 && (
          <div className="hx-artifact-notes">
            <div className="hx-artifact-error" role="alert">
              <Icon icon={CircleAlert} size={16} />
              <div className="text">
                <p className="title">
                  {t('artifact.error')}
                  {/* Its room is kept from the first error, so a second one never re-wraps the title. */}
                  <span className="more" data-none={errors.length < 2 || undefined} aria-hidden={errors.length < 2 || undefined}>
                    {t(errors.length <= 2 ? 'artifact.errorMore.one' : 'artifact.errorMore', { n: Math.max(1, errors.length - 1) })}
                  </span>
                </p>
                <p className="detail">{errors[0]}</p>
              </div>
              {/* The agent only ever edits the newest version, so any other one points there instead. */}
              {newestDone && ready && item.id !== newestDone.id ? (
                <button type="button" className="btn-secondary hx-fix" onClick={() => actions.viewArtifact(newestDone.id)}>
                  {t('artifact.toLatest')}
                </button>
              ) : (
                <button type="button" className="btn-secondary hx-fix" disabled={busy} title={busy ? t('artifact.fixBusy') : undefined} onClick={fix}>
                  {t('artifact.fix')}
                </button>
              )}
              <button type="button" className="btn-ghost hx-icon-btn" aria-label={t('artifact.dismiss')} title={t('artifact.dismiss')} onClick={clearErrors}>
                <Icon icon={X} size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      <Menu anchor={moreRef.current} open={menu === 'more'} onClose={() => setMenu(null)} label={t('artifact.more')} align="end" minWidth={220}>
        <MenuItem icon={<Icon icon={Download} size={16} />} disabled={!ready} onSelect={() => void saveAs()}>
          {t('artifact.save')}
        </MenuItem>
        <MenuItem icon={<Icon icon={FolderDown} size={16} />} disabled={!ready} onSelect={() => void saveToProject()}>
          {t('artifact.saveToProject')}
        </MenuItem>
        {page && (
          <MenuItem icon={<Icon icon={ExternalLink} size={16} />} disabled={!ready} onSelect={() => void openInBrowser()}>
            {t('artifact.openBrowser')}
          </MenuItem>
        )}
        {(page || !full) && <MenuSeparator />}
        {page && (
          <MenuItem icon={<Icon icon={RotateCw} size={16} />} disabled={!ready} onSelect={reload}>
            {t('artifact.reload')}
          </MenuItem>
        )}
        {!full && (
          <MenuItem
            icon={<Icon icon={Maximize2} size={16} />}
            onSelect={() => {
              setMenu(null)
              setFull(true)
              keepFocus()
            }}
          >
            {t('artifact.expand')}
          </MenuItem>
        )}
        {full && page && <MenuSeparator />}
        {full && page && <MenuLabel>{t('artifact.device')}</MenuLabel>}
        {full &&
          page &&
          DEVICES.map((d) => (
            <MenuItem
              key={d.value}
              icon={<Icon icon={d.icon} size={16} />}
              checked={device === d.value}
              onSelect={() => {
                setMenu(null)
                setDevice(d.value)
                setMode('preview')
                keepFocus()
              }}
            >
              {t(d.label)}
            </MenuItem>
          ))}
      </Menu>

      <Menu anchor={versionRef.current} open={menu === 'versions'} onClose={() => setMenu(null)} label={t('artifact.versionsMenu')} align="end" minWidth={180}>
        {[...versions].reverse().map((v) => (
          <MenuItem
            key={v.id}
            checked={v.id === item.id}
            sub={versionSub(v)}
            onSelect={() => {
              setMenu(null)
              actions.viewArtifact(v.id)
            }}
          >
            {versionLabel(v.artifact.version)}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem
          checked={shownMode === 'diff'}
          disabled={!base || writing || unfinished}
          sub={base ? undefined : t('artifact.diffFirst')}
          onSelect={() => {
            setMenu(null)
            setMode((m) => (m === 'diff' ? 'preview' : 'diff'))
          }}
        >
          {t('artifact.mode.diff')}
        </MenuItem>
      </Menu>
    </div>
  )
}

/** A short note at the foot of the artifact: what just happened, or a link the page wants to open. */
function NoticeBar({ notice, onClose, onShowFile }: { notice: Notice; onClose(): void; onShowFile(path: string): void }) {
  const bad = notice.kind === 'failed'
  return (
    <div className="hx-artifact-notice" role={notice.kind === 'link' ? 'alertdialog' : 'status'} aria-label={notice.kind === 'link' ? t('artifact.linkTitle') : undefined}>
      <Icon icon={notice.kind === 'link' ? ExternalLink : bad ? CircleAlert : Check} size={16} className={bad ? 'hx-danger' : notice.kind === 'link' ? 'hx-muted' : 'hx-positive'} />
      <span className="text" title={notice.kind === 'link' ? notice.url : notice.kind === 'saved' ? notice.path : undefined}>
        {notice.kind === 'saved'
          ? t('artifact.savedTo', { path: notice.path })
          : notice.kind === 'failed'
            ? notice.text
            : t('artifact.linkAsk', { url: notice.url })}
      </span>
      {notice.kind === 'saved' && notice.inProject && (
        <button type="button" className="btn-ghost" onClick={() => onShowFile(notice.path)}>
          {t('artifact.showFile')}
        </button>
      )}
      {notice.kind === 'link' && (
        <>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              onClose()
              void api.openExternal(notice.url)
            }}
          >
            {t('artifact.linkOpen')}
          </button>
          <button type="button" className="btn-ghost hx-icon-btn" aria-label={t('common.cancel')} title={t('common.cancel')} onClick={onClose}>
            <Icon icon={X} size={16} />
          </button>
        </>
      )}
    </div>
  )
}

const ArtifactCode = memo(function ArtifactCode({ item, follow }: { item: ArtifactItem; follow: boolean }) {
  const lines = useMemo(() => tokenLines(item.artifact.content, codeLanguage(item.artifact)), [item.artifact])
  const ref = useRef<HTMLDivElement>(null)
  // Follows the end of the code while it streams in, unless the reader scrolled up to look at something.
  const pinned = useRef(true)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && follow && pinned.current) el.scrollTop = el.scrollHeight
  }, [lines, follow])
  return (
    <div
      ref={ref}
      className="hx-viewer"
      onScroll={(event) => {
        const el = event.currentTarget
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      }}
    >
      <div className="hx-code-lines" role="table" aria-label={item.artifact.title}>
        {lines.map((tokens, i) => (
          <div key={i} className="l" role="row">
            <span className="num is-static" aria-hidden="true">
              {i + 1}
            </span>
            <span className="code" role="cell">
              {tokens.map((token, j) => (token.kind ? <span key={j} className={`tok-${token.kind}`}>{token.text}</span> : token.text))}
            </span>
          </div>
        ))}
      </div>
      {follow && (
        <p className="hx-artifact-writing">
          <ThinkingMark size={14} />
          <span>{t('artifact.writing')}</span>
        </p>
      )}
    </div>
  )
})

function ArtifactDiff({ before, after }: { before: ArtifactItem; after: ArtifactItem }) {
  const diff = useMemo(() => diffText(before.artifact.content, after.artifact.content), [before.artifact.content, after.artifact.content])
  return (
    <div className="hx-viewer hx-artifact-diff">
      {diff.lines.length ? <DiffView lines={diff.lines} label={t('artifact.mode.diff')} /> : <p className="hx-files-note">{t('artifact.noChanges')}</p>}
    </div>
  )
}

/**
 * The page loads from an address of its own, under a policy that lets it run scripts and load code
 * from a few public CDNs and nothing else, in a sandbox with no origin: it cannot reach the app, the
 * person's files or the rest of the window. All it can do is post messages, which are read as text:
 * that it loaded, that it failed, that Escape was pressed, or that a link was clicked.
 *
 * A new page fades in over the one it replaces, so stepping through versions never shows the panel
 * between them. Only the newest page is listened to.
 */
function Frame(props: {
  html: string
  title: string
  device: Device
  reloads: number
  hidden: boolean
  onLoadStart(): void
  onError(error: string): void
  onEscape(): void
  onLink(url: string): void
}) {
  const { html, title, device, reloads, hidden } = props
  const ref = useRef<HTMLIFrameElement>(null)
  // The newest page last; its address is null until the main process has it ready. A page is settled once
  // it has faded in fully, and only a settled page is kept under a new one as its cover.
  const [pages, setPages] = useState<{ src: string | null; shown: boolean; settled?: boolean }[]>([])
  const [failed, setFailed] = useState<string | null>(null)
  // A page slow to load gives way to the loading note rather than leaving the old one up.
  const [slow, setSlow] = useState(false)
  const handlers = useRef(props)
  handlers.current = props

  useEffect(() => {
    let live = true
    setFailed(null)
    setSlow(false)
    handlers.current.onLoadStart()
    setPages((list) => [...list.filter((p) => p.settled).slice(-1), ...list.filter((p) => p.shown && !p.settled).slice(-1), { src: null, shown: false }])
    const timer = window.setTimeout(() => live && setSlow(true), 300)
    api.artifacts.preview(html).then(
      (src) => live && setPages((list) => [...list.slice(0, -1), { src, shown: false }]),
      (error) => {
        if (!live) return
        setPages([])
        setFailed(errorText(error))
      },
    )
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [html, reloads])

  const newest = pages.at(-1)
  const waiting = !failed && !newest?.shown
  const covered = pages.some((p) => p.shown)
  const show = (src: string) => setPages((list) => (list.at(-1)?.src === src && !list.at(-1)?.shown ? [...list.slice(0, -1), { src, shown: true }] : list))
  // Once the new page has faded in, it settles and the ones under it go; if it is slow to come, they go first.
  useEffect(() => {
    if (!newest?.shown || newest.settled) return
    const timer = window.setTimeout(() => setPages((list) => list.slice(-1).map((p) => (p.shown ? { ...p, settled: true } : p))), 400)
    return () => window.clearTimeout(timer)
  }, [newest?.shown, newest?.settled, newest?.src])
  useEffect(() => {
    if (slow && waiting && covered) setPages((list) => list.slice(-1))
  }, [slow, waiting, covered])

  const newestSrc = newest?.src
  useEffect(() => {
    if (!newestSrc) return
    // Each page gets a few distinct errors; anything past that is dropped without touching the app.
    const seen = new Set<string>()
    const onMessage = (event: MessageEvent) => {
      if (!ref.current || event.source !== ref.current.contentWindow) return
      const data = event.data as Record<string, unknown> | null
      if (!data || typeof data !== 'object') return
      if (data.dshArtifactReady === true) show(newestSrc)
      else if (data.dshArtifactKey === 'Escape') handlers.current.onEscape()
      else if (typeof data.dshArtifactOpen === 'string') {
        const url = data.dshArtifactOpen
        if (url.length <= 2000 && /^https?:\/\//i.test(url)) handlers.current.onLink(url)
      } else if (typeof data.dshArtifactError === 'string' && seen.size < MAX_ERRORS) {
        const error = data.dshArtifactError.trim().slice(0, MAX_ERROR_LENGTH)
        if (!error || seen.has(error)) return
        seen.add(error)
        handlers.current.onError(error)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [newestSrc])

  return (
    <div className="hx-artifact-frame" data-device={device} hidden={hidden}>
      {pages.map(({ src, shown }) =>
        src ? (
          <iframe
            key={src}
            ref={src === newest?.src ? ref : undefined}
            title={t('artifact.frame', { title })}
            sandbox="allow-scripts allow-forms allow-modals"
            src={src}
            data-shown={shown}
            aria-hidden={src !== newest?.src || undefined}
            tabIndex={src !== newest?.src ? -1 : undefined}
            onLoad={() => show(src)}
          />
        ) : null,
      )}
      {failed ? (
        <p className="hx-artifact-loading is-failed">{t('artifact.previewFailed', { error: failed })}</p>
      ) : (
        waiting &&
        (slow || !covered) && (
          <p className={slow ? 'hx-artifact-loading is-late' : 'hx-artifact-loading'} role="status">
            <ThinkingMark size={14} />
            <span>{t('artifact.loading')}</span>
          </p>
        )
      )}
    </div>
  )
}
