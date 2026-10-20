import { ChevronDown, Search, X } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ArtifactVersion, LibraryArtifact } from '../../shared/types'
import { api } from '../api'
import { artifactIcon, pageFor, svgPage, typeLabel } from '../artifacts'
import { tildify, timeAgo } from '../format'
import { highlight } from '../highlight'
import { t } from '../i18n'
import { actions, useApp } from '../store'
import { Icon } from './Icon'
import { Markdown } from './Markdown'
import { Menu, MenuItem, MenuSeparator } from './Menu'

const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path
const keyOf = (entry: LibraryArtifact) => `${entry.sessionId}:${entry.artifact.id || entry.itemId}`

/** Keeps the entries that did not change, so their previews are not loaded again. */
function keepSame(old: LibraryArtifact[] | null, next: LibraryArtifact[]): LibraryArtifact[] {
  if (!old) return next
  const before = new Map(old.map((e) => [keyOf(e), e]))
  return next.map((e) => {
    const was = before.get(keyOf(e))
    const same = was && was.itemId === e.itemId && was.updatedAt === e.updatedAt && was.sessionTitle === e.sessionTitle && was.workspace === e.workspace
    return same ? was : e
  })
}

// ── thumbnails ─────────────────────────────────────────────────

/** Pages load a couple at a time, so a long library never starts every page at once. */
const AT_ONCE = 2
let loading = 0
const queue: (() => void)[] = []

/** Waits for a free turn, then calls start. The returned function gives the turn back, or leaves the queue. */
function takeTurn(start: () => void): () => void {
  let state: 'waiting' | 'running' | 'done' = 'waiting'
  const run = () => {
    state = 'running'
    loading += 1
    start()
  }
  if (loading < AT_ONCE) run()
  else queue.push(run)
  return () => {
    if (state === 'running') {
      loading -= 1
      queue.shift()?.()
    } else if (state === 'waiting') {
      const index = queue.indexOf(run)
      if (index !== -1) queue.splice(index, 1)
    }
    state = 'done'
  }
}

/**
 * Shows content laid out at a fixed width, shrunk to fit the thumbnail, the way a screenshot would.
 * Zoom rather than a transform, so text is drawn at the small size and stays sharp.
 */
function Scaled({ width, children }: { width: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(() => setScale(el.clientWidth / width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [width])
  return (
    <div ref={ref} className="scaled">
      {scale > 0 && (
        <div className="inner" style={{ width, height: (width * 10) / 16, zoom: scale }}>
          {children}
        </div>
      )}
    </div>
  )
}

/** A live page, started only once it scrolls near and its turn comes. */
function PageThumb({ artifact }: { artifact: ArtifactVersion }) {
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => pageFor(artifact), [artifact.type, artifact.content])
  const [near, setNear] = useState(false)
  const [src, setSrc] = useState<string | null>(null)
  const [shown, setShown] = useState(false)
  const release = useRef<() => void>(() => {})

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Measured against the scrolling page, so the margin starts a page a little before it shows.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        setNear(true)
        observer.disconnect()
      },
      { root: el.closest('.hx-library'), rootMargin: '240px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!near) return
    let live = true
    let timer = 0
    const done = takeTurn(() => {
      // A page that never says it loaded still gives its turn up.
      timer = window.setTimeout(() => done(), 4000)
      api.artifacts.preview(html).then(
        (url) => live && setSrc(url),
        () => done(),
      )
    })
    release.current = done
    return () => {
      live = false
      window.clearTimeout(timer)
      done()
    }
  }, [near, html])

  return (
    <div ref={ref} className="page">
      <Glyph artifact={artifact} hidden={shown} />
      {src && (
        <Scaled width={800}>
          <iframe
            src={src}
            title=""
            aria-hidden
            tabIndex={-1}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            className={shown ? 'is-shown' : undefined}
            onLoad={() => {
              setShown(true)
              release.current()
            }}
          />
        </Scaled>
      )}
    </div>
  )
}

function Glyph({ artifact, hidden }: { artifact: ArtifactVersion; hidden?: boolean }) {
  return (
    <span className={`glyph ${hidden ? 'is-hidden' : ''}`}>
      <Icon icon={artifactIcon(artifact.type)} size={20} />
    </span>
  )
}

/**
 * The drawing as a standalone SVG file. The viewer reads it as HTML, which forgives a missing xmlns and
 * named entities; an image does not, so it is read the same way here and written back out as XML.
 */
function svgFile(content: string): string | null {
  const svg = new DOMParser().parseFromString(svgPage(content), 'text/html').querySelector('svg')
  return svg ? new XMLSerializer().serializeToString(svg) : null
}

function SvgThumb({ artifact }: { artifact: ArtifactVersion }) {
  const file = useMemo(() => svgFile(artifact.content), [artifact.content])
  const [broken, setBroken] = useState(false)
  if (!file || broken) return <Glyph artifact={artifact} />
  // An image never runs the drawing's scripts.
  return <img className="picture" alt="" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(file)}`} onError={() => setBroken(true)} />
}

const Thumb = memo(function Thumb({ artifact }: { artifact: ArtifactVersion }) {
  switch (artifact.type) {
    case 'svg':
      return <SvgThumb artifact={artifact} />
    case 'markdown':
      return (
        <Scaled width={560}>
          <div className="doc">
            <Markdown text={artifact.content.slice(0, 1600)} />
          </div>
        </Scaled>
      )
    case 'code': {
      const head = artifact.content.split('\n').slice(0, 28).join('\n')
      return (
        <Scaled width={560}>
          <pre className="code">
            {highlight(head, artifact.language).map((token, i) => (token.kind ? <span key={i} className={`tok-${token.kind}`}>{token.text}</span> : token.text))}
          </pre>
        </Scaled>
      )
    }
    default:
      return <PageThumb artifact={artifact} />
  }
})

// ── the page ───────────────────────────────────────────────────

const Card = memo(function Card({ entry, now, onOpen }: { entry: LibraryArtifact; now: number; onOpen(entry: LibraryArtifact): void }) {
  const locale = useApp((s) => s.settings.locale)
  const { artifact } = entry
  const title = artifact.title || t('artifact.untitled')
  const chat = entry.sessionTitle || t('header.newChat')
  return (
    <li className="hx-lib-card">
      <div className="thumb" aria-hidden inert>
        <Thumb artifact={artifact} />
      </div>
      <button type="button" className="name" title={`${title}\n${folderName(entry.workspace)} / ${chat}`} onClick={() => onOpen(entry)}>
        {title}
      </button>
      <span className="sub">
        <span>{typeLabel(artifact)}</span>
        <span>{timeAgo(entry.updatedAt, now, locale)}</span>
      </span>
      <span className="from">
        <span className="project">{folderName(entry.workspace)}</span>
        <span className="chat">{chat}</span>
      </span>
    </li>
  )
})

function matches(entry: LibraryArtifact, q: string): 0 | 1 | 2 {
  const named = [entry.artifact.title, entry.sessionTitle, folderName(entry.workspace), typeLabel(entry.artifact)]
  if (named.some((text) => text.toLowerCase().includes(q))) return 2
  return entry.artifact.content.toLowerCase().includes(q) ? 1 : 0
}

export function LibraryView() {
  const home = useApp((s) => s.app.home)
  const [entries, setEntries] = useState<LibraryArtifact[] | null>(null)
  const [query, setQuery] = useState('')
  const [project, setProject] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [scrolled, setScrolled] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const projectRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let live = true
    const load = () => {
      api.artifacts.library().then(
        (list) => {
          if (!live) return
          setEntries((old) => keepSame(old, list))
          setNow(Date.now())
        },
        () => live && setEntries((list) => list ?? []),
      )
    }
    load()
    // Coming back to the window picks up what the agent finished meanwhile.
    window.addEventListener('focus', load)
    return () => {
      live = false
      window.removeEventListener('focus', load)
    }
  }, [])

  useEffect(() => {
    if (!note) return
    const timer = window.setTimeout(() => setNote(null), 5000)
    return () => window.clearTimeout(timer)
  }, [note])

  const projects = useMemo(() => [...new Set((entries ?? []).map((e) => e.workspace))], [entries])
  const shownProject = project && projects.includes(project) ? project : null

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    const inProject = (entries ?? []).filter((e) => !shownProject || e.workspace === shownProject)
    if (!q) return inProject
    // Matches by name come first, then those that only mention the words inside.
    const ranked = inProject.map((entry) => ({ entry, rank: matches(entry, q) })).filter((r) => r.rank > 0)
    return [...ranked.filter((r) => r.rank === 2), ...ranked.filter((r) => r.rank === 1)].map((r) => r.entry)
  }, [entries, query, shownProject])

  const open = async (entry: LibraryArtifact) => {
    const outcome = await actions.openArtifact(entry)
    if (outcome === 'folder') setNote(t('library.missing', { name: folderName(entry.workspace) }))
    else if (outcome === 'conversation') {
      setNote(t('library.gone'))
      setEntries((list) => list && list.filter((e) => e.sessionId !== entry.sessionId))
    }
  }

  return (
    <div className="hx-page hx-library" onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}>
      <header className={`hx-page-head ${scrolled ? 'is-scrolled' : ''}`}>
        <div className="in">
          <div className="hx-lib-title">
            <h1>{t('library.title')}</h1>
            {entries && entries.length > 0 && <span className="count">{t('library.count', { n: entries.length })}</span>}
          </div>
          {entries && entries.length > 0 && (
            <div className="hx-lib-tools">
              <label className="hx-lib-search">
                <Icon icon={Search} />
                <input
                  type="search"
                  value={query}
                  placeholder={t('library.search')}
                  aria-label={t('library.search')}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && query) {
                      event.preventDefault()
                      setQuery('')
                    }
                  }}
                />
                {query && (
                  <button type="button" className="btn-ghost" aria-label={t('library.clear')} title={t('library.clear')} onClick={() => setQuery('')}>
                    <Icon icon={X} size={14} />
                  </button>
                )}
              </label>
              {projects.length > 1 && (
                <button
                  ref={projectRef}
                  type="button"
                  className="btn-ghost hx-lib-filter"
                  aria-haspopup="menu"
                  aria-expanded={menu}
                  onClick={() => setMenu((o) => !o)}
                >
                  <span>{shownProject ? folderName(shownProject) : t('library.allProjects')}</span>
                  <Icon icon={ChevronDown} size={14} />
                </button>
              )}
              {note && (
                <span className="hx-lib-note" role="status">
                  {note}
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="hx-lib-body">
        {entries && entries.length === 0 && (
          <div className="hx-lib-empty">
            <h2>{t('library.emptyTitle')}</h2>
            <p>{t('library.emptyBody')}</p>
          </div>
        )}
        {entries && entries.length > 0 && list.length === 0 && <p className="hx-lib-empty-note">{t('library.noResults')}</p>}
        {list.length > 0 && (
          <ul className="hx-lib-grid">
            {list.map((entry) => (
              <Card key={`${entry.sessionId}:${entry.artifact.id || entry.itemId}`} entry={entry} now={now} onOpen={(e) => void open(e)} />
            ))}
          </ul>
        )}
      </div>

      <Menu anchor={projectRef.current} open={menu} onClose={() => setMenu(false)} label={t('library.allProjects')} minWidth={220}>
        <MenuItem
          checked={!shownProject}
          onSelect={() => {
            setMenu(false)
            setProject(null)
          }}
        >
          {t('library.allProjects')}
        </MenuItem>
        <MenuSeparator />
        {projects.map((path) => (
          <MenuItem
            key={path}
            checked={path === shownProject}
            sub={tildify(path, home)}
            onSelect={() => {
              setMenu(false)
              setProject(path)
            }}
          >
            {folderName(path)}
          </MenuItem>
        ))}
      </Menu>
    </div>
  )
}
