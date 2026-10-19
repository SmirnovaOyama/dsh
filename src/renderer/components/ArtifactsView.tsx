import { ChevronLeft, ChevronRight, Code2, Download, Eye, LoaderCircle, X } from 'lucide-react'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import {
  artifactIcon,
  codeLanguage,
  fileNameFor,
  hasPreview,
  isArtifact,
  latestArtifacts,
  reactPage,
  svgPage,
  typeLabel,
  versionsOf,
  type ArtifactItem,
} from '../artifacts'
import { t } from '../i18n'
import { actions, useApp } from '../store'
import { CopyButton } from './CodeBlock'
import { tokenLines } from './FilesView'
import { Icon } from './Icon'
import { Markdown } from './Markdown'

export function ArtifactsView() {
  const items = useApp((s) => s.chat?.session.items)
  const viewed = useApp((s) => s.viewedArtifact)
  const item = viewed ? items?.find((i) => i.id === viewed) : undefined
  if (item && isArtifact(item)) return <ArtifactViewer item={item} />
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
      {list.length ? <ListRows list={list} /> : <div className="hx-changes-empty">{t('artifact.empty')}</div>}
    </>
  )
}

function ListRows({ list }: { list: ArtifactItem[] }) {
  return (
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
        </button>
      ))}
    </div>
  )
}

type Mode = 'preview' | 'code'

function ArtifactViewer({ item }: { item: ArtifactItem }) {
  const items = useApp((s) => s.chat?.session.items)
  const versions = useMemo(() => versionsOf(items ?? [], item), [items, item])
  const index = versions.findIndex((v) => v.id === item.id)
  const artifact = item.artifact
  const writing = item.status === 'running'
  const previewable = hasPreview(artifact.type)
  const [mode, setMode] = useState<Mode>('preview')
  // While the agent writes, the code streams in; the preview takes over once it is done.
  const shownMode: Mode = writing || !previewable ? 'code' : mode
  const prev = versions[index - 1]
  const next = versions[index + 1]

  const many = useApp((s) => (s.chat ? latestArtifacts(s.chat.session.items).length > 1 : false))
  const modes: { value: Mode; label: string; icon: typeof Eye }[] = [
    { value: 'preview', label: t('artifact.preview'), icon: Eye },
    { value: 'code', label: t('artifact.code'), icon: Code2 },
  ]

  return (
    <div className="hx-files-view">
      <div className="hx-changes-head hx-artifact-head">
        {many && (
          <button type="button" className="btn-ghost hx-icon-btn" aria-label={t('artifact.back')} title={t('artifact.back')} onClick={() => actions.viewArtifact(null)}>
            <Icon icon={ChevronLeft} size={16} />
          </button>
        )}
        {previewable && (
          <span className="hx-iconseg" role="group" aria-label={t('artifact.view')}>
            {modes.map((m) => (
              <button
                key={m.value}
                type="button"
                aria-pressed={shownMode === m.value}
                aria-label={m.label}
                title={m.label}
                disabled={writing && m.value === 'preview'}
                onClick={() => setMode(m.value)}
              >
                <Icon icon={m.icon} size={16} />
              </button>
            ))}
          </span>
        )}
        <span className="title" title={artifact.title}>
          {artifact.title || t('artifact.untitled')}
        </span>
        <span className="grow" />
        {versions.length > 1 && (
          <span className="hx-versions">
            <button type="button" className="btn-ghost hx-icon-btn" disabled={!prev} aria-label={t('artifact.prev')} title={t('artifact.prev')} onClick={() => prev && actions.viewArtifact(prev.id)}>
              <Icon icon={ChevronLeft} size={14} />
            </button>
            <span className="n">{t('artifact.version', { n: artifact.version })}</span>
            <button type="button" className="btn-ghost hx-icon-btn" disabled={!next} aria-label={t('artifact.next')} title={t('artifact.next')} onClick={() => next && actions.viewArtifact(next.id)}>
              <Icon icon={ChevronRight} size={14} />
            </button>
          </span>
        )}
        <CopyButton text={artifact.content} label={t('artifact.copy')} />
        <button
          type="button"
          className="btn-ghost hx-icon-btn"
          disabled={writing}
          aria-label={t('artifact.save')}
          title={t('artifact.save')}
          onClick={() => void api.artifacts.save(fileNameFor(artifact), artifact.content)}
        >
          <Icon icon={Download} size={16} />
        </button>
        <CloseButton />
      </div>
      {shownMode === 'code' ? <ArtifactCode item={item} follow={writing} /> : <ArtifactPreview item={item} />}
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
          <Icon icon={LoaderCircle} size={14} className="hx-spin" />
          {t('artifact.writing')}
        </p>
      )}
    </div>
  )
})

function ArtifactPreview({ item }: { item: ArtifactItem }) {
  const { type, content, title } = item.artifact
  if (type === 'markdown') {
    return (
      <div className="hx-viewer hx-artifact-doc">
        <Markdown text={content} />
      </div>
    )
  }
  return <Frame html={type === 'react' ? reactPage(content) : type === 'svg' ? svgPage(content) : content} title={title} />
}

/**
 * The page runs in a sandbox with an origin of its own: it can run scripts and load from the web,
 * but it cannot reach the app, the person's files or the rest of the window.
 */
function Frame({ html, title }: { html: string; title: string }) {
  const [shown, setShown] = useState(false)
  useEffect(() => setShown(false), [html])
  return (
    <div className="hx-artifact-frame">
      <iframe
        key={html}
        title={t('artifact.frame', { title })}
        sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
        srcDoc={html}
        data-shown={shown}
        onLoad={() => setShown(true)}
      />
    </div>
  )
}
