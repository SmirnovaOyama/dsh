import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Code2,
  Copy,
  Download,
  Ellipsis,
  ExternalLink,
  Eye,
  FileDiff,
  FolderDown,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Monitor,
  RotateCw,
  Smartphone,
  Tablet,
  Wrench,
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
import { CopyButton } from './CodeBlock'
import { DiffView } from './DiffView'
import { tokenLines } from './FilesView'
import { Icon } from './Icon'
import { Markdown } from './Markdown'
import { Menu, MenuItem, MenuSeparator } from './Menu'
import { Reserve } from './Reserve'
import { Shimmer, ThinkingMark } from './Thinking'

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
      <div className="hx-changes-head">
        <h2>{t('panel.artifacts')}</h2>
        {list.length > 0 && <span className="sum">{t('artifact.count', { n: list.length })}</span>}
        <span className="grow" />
        <CloseButton />
      </div>
      {list.length ? (
        <div className="hx-artifact-list">
          {list.map((item) => (
            <button key={item.id} type="button" className="hx-artifact-row" onClick={() => actions.viewArtifact(item.id)}>
              <span className="glyph">
                <Icon icon={artifactIcon(item.artifact.type)} size={16} />
              </span>
              <span className="text">
                <span className="title">{item.artifact.title || t('artifact.untitled')}</span>
                <span className="sub">
                  <span>{typeLabel(item.artifact)}</span>
                  {item.artifact.version > 1 && <span>{t('artifact.versions', { n: item.artifact.version })}</span>}
                </span>
              </span>
              {item.status === 'running' ? <ThinkingMark size={14} /> : <Icon icon={ChevronRight} size={16} className="hx-row-chev" />}
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
type Notice =
  | { kind: 'saved'; path: string; inProject: boolean }
  | { kind: 'failed'; text: string }
  | { kind: 'copied' }
  | { kind: 'link'; url: string }

const MODE_ICONS: Record<Mode, LucideIcon> = { preview: Eye, code: Code2, diff: FileDiff }
const MODE_LABELS = { preview: 'artifact.preview', code: 'artifact.code', diff: 'artifact.mode.diff' } as const
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
  value: T
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
  const writing = item.status === 'running'
  const ready = item.status === 'done'
  const unfinished = !writing && !ready
  const page = isPage(artifact.type)
  const prev = versions[index - 1]
  const next = versions[index + 1]
  const last = versions[versions.length - 1]
  const newestDone = versions.findLast((v) => v.status === 'done')

  const [mode, setMode] = useState<Mode>('preview')
  const [full, setFull] = useState(false)
  const [device, setDevice] = useState<Device>('desktop')
  const [reloads, setReloads] = useState(0)
  const [errors, setErrors] = useState<string[]>([])
  const [notice, setNotice] = useState<Notice | null>(null)
  const [menu, setMenu] = useState<'more' | 'versions' | null>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  const fullRef = useRef<HTMLButtonElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const versionRef = useRef<HTMLButtonElement>(null)

  // The diff toggle stays put across versions and is only unavailable on the first, so the title never moves.
  const modes: Mode[] = [...(hasPreview(artifact.type) ? (['preview'] as const) : []), 'code', ...(versions.length > 1 ? (['diff'] as const) : [])]
  const usable = modes.filter((m) => m !== 'diff' || prev)
  // While the agent writes, and for a version it never finished, the code is what there is to see.
  const shownMode: Mode = writing || unfinished ? 'code' : usable.includes(mode) ? mode : usable[0]

  // Once the agent finishes writing, the preview takes over again.
  const wasWriting = useRef(writing)
  useEffect(() => {
    if (wasWriting.current && !writing) setMode('preview')
    wasWriting.current = writing
  }, [writing])

  // A new version, or a reload, starts with a clean slate of errors.
  useEffect(() => setErrors([]), [item.id, reloads])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), notice.kind === 'link' ? 15000 : 5000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const shrink = () => {
    setFull(false)
    fullRef.current?.focus({ preventScroll: true })
  }

  // Expanded, the artifact is a dialog over the window: Escape shrinks it before anything else hears
  // the key, and nothing behind it can take focus. It stays where it is in the page, so it keeps running.
  useEffect(() => {
    if (!full) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('.hx-menu')) return
      event.preventDefault()
      event.stopPropagation()
      setFull(false)
      fullRef.current?.focus({ preventScroll: true })
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
  const copy = () => {
    setMenu(null)
    void navigator.clipboard.writeText(artifact.content).then(
      () => setNotice({ kind: 'copied' }),
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
    setErrors([])
  }
  // A link the page asks to open waits for the person, and a second request never swaps the address under them.
  const askLink = (url: string) => setNotice((n) => (n?.kind === 'link' ? n : { kind: 'link', url }))

  const html = useMemo(() => (page ? withBridge(pageFor(artifact)) : ''), [page, artifact])
  const versionLabel = (n: number) => t('artifact.version', { n })
  const shortLabel = (n: number) => t('artifact.versionShort', { n })
  const versionSub = (v: ArtifactItem) => {
    if (v.status === 'running') return t('artifact.writing')
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
        <IconToggles<Mode>
          label={t('artifact.view')}
          value={shownMode}
          options={modes.map((m) => ({
            value: m,
            icon: MODE_ICONS[m],
            label: t(MODE_LABELS[m]),
            title: m === 'diff' && !prev ? t('artifact.diffFirst') : undefined,
            disabled: ((writing || unfinished) && m !== 'code') || (m === 'diff' && !prev),
          }))}
          onChange={setMode}
        />
        <span className="title" title={artifact.title}>
          {artifact.title || t('artifact.untitled')}
        </span>
        <span className="grow" />
        {full && page && shownMode === 'preview' && (
          <IconToggles<Device> label={t('artifact.device')} value={device} options={DEVICES.map((d) => ({ value: d.value, icon: d.icon, label: t(d.label) }))} onChange={setDevice} />
        )}
        {versions.length > 1 && (
          <span className="hx-versions">
            <button type="button" className="btn-ghost hx-icon-btn step" disabled={!prev} aria-label={t('artifact.prev')} title={t('artifact.prev')} onClick={() => prev && actions.viewArtifact(prev.id)}>
              <Icon icon={ChevronLeft} size={14} />
            </button>
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
              {/* Holds the width of the longest label, so stepping from 10 to 9 leaves the arrows in place. */}
              <span className="n long" aria-hidden="true">
                <Reserve shown={0} forms={[versionLabel(artifact.version), versionLabel(last.artifact.version)]} />
              </span>
              <span className="n short" aria-hidden="true">
                <Reserve shown={0} forms={[shortLabel(artifact.version), shortLabel(last.artifact.version)]} />
              </span>
              <Icon icon={ChevronDown} size={14} />
            </button>
            <button type="button" className="btn-ghost hx-icon-btn step" disabled={!next} aria-label={t('artifact.next')} title={t('artifact.next')} onClick={() => next && actions.viewArtifact(next.id)}>
              <Icon icon={ChevronRight} size={14} />
            </button>
          </span>
        )}
        {full && page && (
          <button type="button" className="btn-ghost hx-icon-btn" disabled={!ready || shownMode !== 'preview'} aria-label={t('artifact.reload')} title={t('artifact.reload')} onClick={reload}>
            <Icon icon={RotateCw} size={16} />
          </button>
        )}
        <CopyButton text={artifact.content} label={t('artifact.copy')} disabled={!ready} />
        <button
          ref={fullRef}
          type="button"
          className="btn-ghost hx-icon-btn"
          aria-label={t(full ? 'artifact.shrink' : 'artifact.expand')}
          title={t(full ? 'artifact.shrink' : 'artifact.expand')}
          onClick={() => setFull((f) => !f)}
        >
          <Icon icon={full ? Minimize2 : Maximize2} size={16} />
        </button>
        <button
          ref={moreRef}
          type="button"
          className="btn-ghost hx-icon-btn"
          aria-haspopup="menu"
          aria-expanded={menu === 'more'}
          aria-label={t('artifact.more')}
          title={t('artifact.more')}
          onClick={() => setMenu((m) => (m === 'more' ? null : 'more'))}
        >
          <Icon icon={Ellipsis} size={16} />
        </button>
        <CloseButton />
      </div>

      {unfinished && (
        <div className="hx-artifact-unfinished" role="note">
          <Icon icon={CircleAlert} size={14} />
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
        ) : shownMode === 'diff' && prev ? (
          <ArtifactDiff before={prev} after={item} />
        ) : artifact.type === 'markdown' ? (
          <div className="hx-viewer hx-artifact-doc">
            <Markdown text={artifact.content} />
          </div>
        ) : (
          <Frame
            html={html}
            title={artifact.title}
            device={full ? device : 'desktop'}
            reloads={reloads}
            onError={(error) => setErrors((list) => [...list, error])}
            onEscape={() => full && shrink()}
            onLink={askLink}
          />
        )}

        {/* Notes stack at the foot of the artifact, so one never covers another. */}
        <div className="hx-artifact-notes">
          {notice && (
            <NoticeBar
              notice={notice}
              onClose={() => setNotice(null)}
              onShowFile={(path) => {
                setFull(false)
                actions.viewFile(path)
              }}
            />
          )}
          {shownMode === 'preview' && errors.length > 0 && (
            <div className="hx-artifact-error" role="alert">
              <Icon icon={CircleAlert} size={16} />
              <div className="text">
                <p className="title">{t('artifact.error')}</p>
                <p className="detail">{errors[0]}</p>
                {errors.length > 1 && <p className="more">{t(errors.length === 2 ? 'artifact.errorMore.one' : 'artifact.errorMore', { n: errors.length - 1 })}</p>}
              </div>
              {/* The agent only ever edits the newest version, so an older one points there instead. */}
              {next ? (
                <button type="button" className="btn-secondary hx-fix" onClick={() => actions.viewArtifact(last.id)}>
                  {t('artifact.toLatest')}
                </button>
              ) : (
                <button type="button" className="btn-secondary hx-fix" disabled={busy} title={busy ? t('artifact.fixBusy') : undefined} onClick={fix}>
                  <Icon icon={Wrench} size={14} />
                  {t('artifact.fix')}
                </button>
              )}
              <button type="button" className="btn-ghost hx-icon-btn" aria-label={t('artifact.dismiss')} title={t('artifact.dismiss')} onClick={() => setErrors([])}>
                <Icon icon={X} size={14} />
              </button>
            </div>
          )}
        </div>
      </div>

      <Menu anchor={moreRef.current} open={menu === 'more'} onClose={() => setMenu(null)} label={t('artifact.more')} align="end" minWidth={220}>
        {many && (
          <MenuItem
            icon={<Icon icon={LayoutGrid} size={16} />}
            onSelect={() => {
              setMenu(null)
              setFull(false)
              actions.viewArtifact(null)
            }}
          >
            {t('artifact.all')}
          </MenuItem>
        )}
        {many && <MenuSeparator />}
        <MenuItem icon={<Icon icon={Copy} size={16} />} disabled={!ready} onSelect={copy}>
          {t('artifact.copy')}
        </MenuItem>
        {page && (
          <MenuItem icon={<Icon icon={RotateCw} size={16} />} disabled={!ready} onSelect={reload}>
            {t('artifact.reload')}
          </MenuItem>
        )}
        {page && (
          <MenuItem icon={<Icon icon={ExternalLink} size={16} />} disabled={!ready} onSelect={() => void openInBrowser()}>
            {t('artifact.openBrowser')}
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem icon={<Icon icon={FolderDown} size={16} />} disabled={!ready} onSelect={() => void saveToProject()}>
          {t('artifact.saveToProject')}
        </MenuItem>
        <MenuItem icon={<Icon icon={Download} size={16} />} disabled={!ready} onSelect={() => void saveAs()}>
          {t('artifact.save')}
        </MenuItem>
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
      </Menu>
    </div>
  )
}

/** A short note at the foot of the artifact: what just happened, or a link the page wants to open. */
function NoticeBar({ notice, onClose, onShowFile }: { notice: Notice; onClose(): void; onShowFile(path: string): void }) {
  const bad = notice.kind === 'failed'
  return (
    <div className="hx-artifact-notice" role={notice.kind === 'link' ? 'alertdialog' : 'status'} aria-label={notice.kind === 'link' ? t('artifact.linkTitle') : undefined}>
      <Icon icon={notice.kind === 'link' ? ExternalLink : bad ? CircleAlert : Check} size={14} className={bad ? 'hx-danger' : notice.kind === 'link' ? 'hx-muted' : 'hx-positive'} />
      <span className="text" title={notice.kind === 'link' ? notice.url : notice.kind === 'saved' ? notice.path : undefined}>
        {notice.kind === 'saved'
          ? t('artifact.savedTo', { path: notice.path })
          : notice.kind === 'failed'
            ? notice.text
            : notice.kind === 'link'
              ? t('artifact.linkAsk', { url: notice.url })
              : t('copy.done')}
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
            <Icon icon={X} size={14} />
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
          <Shimmer>{t('artifact.writing')}</Shimmer>
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
 */
function Frame(props: {
  html: string
  title: string
  device: Device
  reloads: number
  onError(error: string): void
  onEscape(): void
  onLink(url: string): void
}) {
  const { html, title, device, reloads } = props
  const ref = useRef<HTMLIFrameElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [shown, setShown] = useState(false)
  const handlers = useRef(props)
  handlers.current = props

  useEffect(() => {
    let live = true
    setSrc(null)
    setFailed(null)
    setShown(false)
    api.artifacts.preview(html).then(
      (url) => live && setSrc(url),
      (error) => live && setFailed(errorText(error)),
    )
    return () => {
      live = false
    }
  }, [html, reloads])

  useEffect(() => {
    // Each page gets a few distinct errors; anything past that is dropped without touching the app.
    const seen = new Set<string>()
    const onMessage = (event: MessageEvent) => {
      if (!ref.current || event.source !== ref.current.contentWindow) return
      const data = event.data as Record<string, unknown> | null
      if (!data || typeof data !== 'object') return
      if (data.dshArtifactReady === true) setShown(true)
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
  }, [src])

  return (
    <div className="hx-artifact-frame" data-device={device}>
      {src && (
        <iframe
          key={src}
          ref={ref}
          title={t('artifact.frame', { title })}
          sandbox="allow-scripts allow-forms allow-modals"
          src={src}
          data-shown={shown}
          onLoad={() => setShown(true)}
        />
      )}
      {failed ? (
        <p className="hx-artifact-loading is-failed">{t('artifact.previewFailed', { error: failed })}</p>
      ) : (
        !shown && (
          <p className="hx-artifact-loading" role="status">
            <ThinkingMark size={14} />
            <Shimmer>{t('artifact.loading')}</Shimmer>
          </p>
        )
      )}
    </div>
  )
}
