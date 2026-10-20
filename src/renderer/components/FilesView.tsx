import { AtSign, Check, ChevronLeft, ChevronRight, File, FileCode2, FileImage, FileJson, FileText, FileType, Folder as FolderIcon, FolderOpen, RotateCw, Search, X, type LucideIcon } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { FileList, FileRef } from '../../shared/types'
import { api } from '../api'
import { highlight, type Token } from '../highlight'
import { t } from '../i18n'
import { actions, useApp } from '../store'
import { DiffStatsText } from './DiffView'
import { Icon } from './Icon'
import { Reserve } from './Reserve'

const SHOWN_MATCHES = 200
const SHOWN_LINES = 5000

/** Folders opened in the tree, per workspace, so leaving and coming back keeps the tree as it was. */
const openFolders = new Map<string, Set<string>>()

export function FilesView() {
  const viewed = useApp((s) => s.viewedFile)
  return viewed ? <FileViewer key={viewed} path={viewed} /> : <FileTree />
}

type Row = { kind: 'dir' | 'file'; path: string; name: string; depth: number }
type Folder = { dirs: Map<string, Folder>; files: string[] }

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const dirName = (p: string) => p.slice(0, Math.max(p.lastIndexOf('/'), 0))

const CODE = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'cs', 'php', 'sh', 'vue', 'svelte', 'html'])
const DATA = new Set(['json', 'jsonc', 'yaml', 'yml', 'toml', 'lock'])
const TEXT = new Set(['md', 'mdx', 'txt', 'rst'])
const STYLE = new Set(['css', 'scss', 'sass', 'less'])
const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'])

/** One quiet outline icon per kind of file, so a column of names is easy to scan without turning colourful. */
function fileIcon(name: string): LucideIcon {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  if (CODE.has(ext)) return FileCode2
  if (DATA.has(ext)) return FileJson
  if (TEXT.has(ext)) return FileText
  if (STYLE.has(ext)) return FileType
  if (IMAGE.has(ext)) return FileImage
  return File
}

/** Hairlines down the tree, one per level above the row, like an editor's indent guides. */
function Guides({ depth }: { depth: number }) {
  if (!depth) return null
  return (
    <span className="guides" aria-hidden="true">
      {Array.from({ length: depth }, (_, i) => (
        <span key={i} style={{ insetInlineStart: INDENT_START + i * INDENT + 7 }} />
      ))}
    </span>
  )
}

const INDENT = 16
const INDENT_START = 8

function buildTree(files: string[]): Folder {
  const root: Folder = { dirs: new Map(), files: [] }
  for (const file of files) {
    const parts = file.split('/')
    let folder = root
    for (const part of parts.slice(0, -1)) {
      let next = folder.dirs.get(part)
      if (!next) folder.dirs.set(part, (next = { dirs: new Map(), files: [] }))
      folder = next
    }
    folder.files.push(file)
  }
  return root
}

/** The tree as visible rows: folders first, then files, each sorted by name. */
function visibleRows(folder: Folder, open: Set<string>, prefix = '', depth = 0, rows: Row[] = []): Row[] {
  for (const name of [...folder.dirs.keys()].sort(byName)) {
    const path = prefix ? `${prefix}/${name}` : name
    rows.push({ kind: 'dir', path, name, depth })
    if (open.has(path)) visibleRows(folder.dirs.get(name)!, open, path, depth + 1, rows)
  }
  for (const file of [...folder.files].sort((a, b) => byName(baseName(a), baseName(b)))) {
    rows.push({ kind: 'file', path: file, name: baseName(file), depth })
  }
  return rows
}

/** Paths containing the query, file names that match ranked first. */
function matches(files: string[], query: string): string[] {
  const q = query.toLowerCase()
  const hits = files.filter((f) => f.toLowerCase().includes(q))
  const score = (f: string) => (baseName(f).toLowerCase().startsWith(q) ? 0 : baseName(f).toLowerCase().includes(q) ? 1 : 2)
  return hits.sort((a, b) => score(a) - score(b) || a.length - b.length || byName(a, b))
}

function FileTree() {
  const workspace = useApp((s) => s.workspace?.path ?? '')
  const changes = useApp((s) => s.chat?.changes)
  const [list, setList] = useState<FileList | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(() => openFolders.get(workspace) ?? new Set<string>())

  const load = useCallback(() => {
    setFailed(false)
    api.workspace.files().then(setList, () => setFailed(true))
  }, [])
  useEffect(load, [load, workspace])
  useEffect(() => {
    openFolders.set(workspace, open)
  }, [workspace, open])

  const stats = useMemo(() => new Map((changes ?? []).map((c) => [c.path, c.stats])), [changes])
  const tree = useMemo(() => buildTree(list?.files ?? []), [list])
  const q = query.trim()
  const rows = useMemo(() => (q ? [] : visibleRows(tree, open)), [tree, open, q])
  const found = useMemo(() => (q ? matches(list?.files ?? [], q) : []), [list, q])

  const toggle = (path: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  return (
    <div className="hx-files-view">
      <div className="hx-files-bar">
        <label className="hx-files-search">
          <Icon icon={Search} size={14} />
          <input
            type="search"
            value={query}
            placeholder={t('files.filter')}
            aria-label={t('files.filter')}
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query) {
                event.preventDefault()
                setQuery('')
              } else if (event.key === 'Enter' && found[0]) actions.viewFile(found[0])
            }}
          />
          {query ? (
            <button type="button" className="hx-files-clear" aria-label={t('files.clear')} onClick={() => setQuery('')}>
              <Icon icon={X} size={14} />
            </button>
          ) : (
            <button type="button" className="hx-files-clear" aria-label={t('files.reload')} title={t('files.reload')} onClick={load}>
              <Icon icon={RotateCw} size={14} />
            </button>
          )}
        </label>
      </div>

      <div className="hx-tree" role="tree" aria-label={t('files.title')}>
        {failed ? (
          <p className="hx-files-note">{t('files.failed')}</p>
        ) : !list ? null : list.files.length === 0 ? (
          <p className="hx-files-note">{t('files.empty')}</p>
        ) : q ? (
          found.length === 0 ? (
            <p className="hx-files-note">{t('files.noMatch')}</p>
          ) : (
            found.slice(0, SHOWN_MATCHES).map((path) => <FileRow key={path} path={path} name={baseName(path)} depth={0} dir={dirName(path)} stats={stats.get(path)} />)
          )
        ) : (
          rows.map((row) =>
            row.kind === 'dir' ? (
              <button
                key={row.path}
                type="button"
                role="treeitem"
                aria-expanded={open.has(row.path)}
                className="hx-tree-row is-dir"
                style={{ paddingInlineStart: INDENT_START + row.depth * INDENT }}
                onClick={() => toggle(row.path)}
              >
                <Guides depth={row.depth} />
                <Icon icon={ChevronRight} size={14} className="hx-chev" />
                <Icon icon={open.has(row.path) ? FolderOpen : FolderIcon} size={16} className="kind" />
                <span className="name">{row.name}</span>
              </button>
            ) : (
              <FileRow key={row.path} path={row.path} name={row.name} depth={row.depth} stats={stats.get(row.path)} />
            ),
          )
        )}
        {q && found.length > SHOWN_MATCHES && <p className="hx-files-note">{t('files.more', { n: found.length - SHOWN_MATCHES })}</p>}
        {!q && list?.truncated && <p className="hx-files-note">{t('files.truncated')}</p>}
      </div>
    </div>
  )
}

const FileRow = memo(function FileRow(props: { path: string; name: string; depth: number; dir?: string; stats?: { added: number; removed: number } }) {
  const { path, name, depth, dir, stats } = props
  return (
    <div className={stats ? 'hx-tree-row is-file is-changed' : 'hx-tree-row is-file'} role="treeitem" style={{ paddingInlineStart: INDENT_START + depth * INDENT }}>
      <Guides depth={depth} />
      <button type="button" className="open" title={path} onClick={() => actions.viewFile(path)}>
        {/* Files sit under their folder's name, past the chevron column. */}
        {dir === undefined && <span className="gap" aria-hidden="true" />}
        <Icon icon={fileIcon(name)} size={16} className="kind" />
        <span className="name">{name}</span>
        {dir && <span className="dir">{dir}</span>}
        {stats && (
          <span className="n">
            <DiffStatsText added={stats.added} removed={stats.removed} />
          </span>
        )}
      </button>
      <button type="button" className="btn-ghost hx-icon-btn point" aria-label={t('files.point', { path })} title={t('files.pointFile')} onClick={() => actions.addRef({ path })}>
        <Icon icon={AtSign} size={14} />
      </button>
    </div>
  )
})

/** Splits highlighted tokens into lines, so each line can carry its own number. */
export function tokenLines(text: string, ext: string): Token[][] {
  const lines: Token[][] = [[]]
  for (const token of highlight(text, ext)) {
    const parts = token.text.split('\n')
    parts.forEach((part, i) => {
      if (i > 0) lines.push([])
      if (part) lines[lines.length - 1].push({ kind: token.kind, text: part })
    })
  }
  if (lines.length > 1 && lines[lines.length - 1].length === 0) lines.pop()
  return lines
}

type Range = { start: number; end: number }

function lineOf(node: Node | null): number | null {
  const el = node instanceof Element ? node : node?.parentElement
  const line = el?.closest<HTMLElement>('[data-line]')?.dataset.line
  return line ? Number(line) : null
}

function FileViewer({ path }: { path: string }) {
  const [file, setFile] = useState<{ text: string } | { error: string } | null>(null)
  const [range, setRange] = useState<Range | null>(null)
  const [added, setAdded] = useState(false)
  const anchor = useRef<number | null>(null)
  const ext = path.slice(path.lastIndexOf('.') + 1)

  useEffect(() => {
    let live = true
    api.workspace.read(path).then(
      (result) => live && setFile(result.ok ? { text: result.text } : { error: result.error }),
      (error) => live && setFile({ error: String(error) }),
    )
    return () => {
      live = false
    }
  }, [path])

  useEffect(() => {
    if (!added) return
    const timer = setTimeout(() => setAdded(false), 1400)
    return () => clearTimeout(timer)
  }, [added])

  const lines = useMemo(() => (file && 'text' in file ? tokenLines(file.text, ext) : []), [file, ext])

  // Clicking a line number picks that line; shift-click stretches the pick to it.
  const pickLine = (line: number, event: MouseEvent) => {
    window.getSelection()?.removeAllRanges()
    if (event.shiftKey && anchor.current !== null) {
      setRange({ start: Math.min(anchor.current, line), end: Math.max(anchor.current, line) })
      return
    }
    anchor.current = line
    setRange((r) => (r && r.start === line && r.end === line ? null : { start: line, end: line }))
  }
  // Selecting text across lines picks those lines too.
  const pickSelection = () => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return
    const a = lineOf(selection.anchorNode)
    const b = lineOf(selection.focusNode)
    if (a === null || b === null) return
    anchor.current = Math.min(a, b)
    setRange({ start: Math.min(a, b), end: Math.max(a, b) })
  }

  const add = () => {
    const ref: FileRef = range ? { path, start: range.start, end: range.end } : { path }
    actions.addRef(ref)
    setRange(null)
    window.getSelection()?.removeAllRanges()
    setAdded(true)
  }

  const pickLabel = range ? (range.start === range.end ? t('ref.line', { a: range.start }) : t('ref.lines', { a: range.start, b: range.end })) : ''

  return (
    <div className="hx-files-view">
      <div className="hx-viewer-bar">
        <button type="button" className="btn-ghost hx-icon-btn" aria-label={t('files.back')} title={t('files.back')} onClick={() => actions.viewFile(null)}>
          <Icon icon={ChevronLeft} size={16} />
        </button>
        <span className="p" title={path}>
          <bdi className="name">{baseName(path)}</bdi>
          {dirName(path) && <bdi className="dir">{dirName(path)}</bdi>}
        </span>
        <button type="button" className="btn-ghost hx-point" disabled={!file || 'error' in file} onClick={add}>
          {/* The icon travels with each label, so a short label sits against the edge with no gap inside. */}
          <Reserve
            shown={added ? 2 : range ? 1 : 0}
            forms={[
              <>
                <Icon icon={AtSign} size={14} />
                {t('files.pointFile')}
              </>,
              <>
                <Icon icon={AtSign} size={14} />
                {t('files.pointLines', { lines: pickLabel || t('ref.lines', { a: 888, b: 888 }) })}
              </>,
              <>
                <Icon icon={Check} size={14} />
                {t('files.pointed')}
              </>,
            ]}
          />
        </button>
      </div>
      {!file ? null : 'error' in file ? (
        <p className="hx-files-note">{file.error}</p>
      ) : (
        <div className="hx-viewer" onMouseUp={pickSelection} onKeyDown={(event) => event.key === 'Escape' && range && setRange(null)}>
          <div className="hx-code-lines" role="table" aria-label={t('changes.diff', { path })}>
            {lines.slice(0, SHOWN_LINES).map((tokens, i) => {
              const n = i + 1
              const picked = range !== null && n >= range.start && n <= range.end
              return (
                <div key={n} className={picked ? 'l is-picked' : 'l'} data-line={n} role="row">
                  <button type="button" className="num" tabIndex={-1} aria-label={t('ref.line', { a: n })} onClick={(event) => pickLine(n, event)}>
                    {n}
                  </button>
                  <span className="code" role="cell">
                    {tokens.map((token, j) => (token.kind ? <span key={j} className={`tok-${token.kind}`}>{token.text}</span> : token.text))}
                  </span>
                </div>
              )
            })}
            {lines.length > SHOWN_LINES && <p className="hx-files-note">{t('files.longFile', { n: lines.length - SHOWN_LINES })}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
