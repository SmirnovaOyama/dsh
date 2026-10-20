import { ChevronRight, Ellipsis, Folder, FolderOpen, FolderPlus, PanelLeft, Plus, Search, Settings as SettingsIcon, SquarePen, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { SessionMeta } from '../../shared/types'
import { modKey, sessionTime, tildify } from '../format'
import { t } from '../i18n'
import { actions, projectPaths, useApp } from '../store'
import { Icon } from './Icon'
import { Menu, MenuItem } from './Menu'

let handledSearchTick = 0
/** A project shows this many conversations until "show more". */
const SHOW = 5
const FOLDED_KEY = 'dsh.projects.folded'

function readFolded(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function writeFolded(paths: string[]) {
  try {
    localStorage.setItem(FOLDED_KEY, JSON.stringify(paths))
  } catch {
    // Without storage the projects just open unfolded next time.
  }
}

const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path

function SessionRow({ meta, current, now, project }: { meta: SessionMeta; current: boolean; now: number; project?: string }) {
  const locale = useApp((s) => s.settings.locale)
  const trail =
    meta.status === 'running' ? t('status.running') : meta.status === 'waiting' ? t('status.waiting') : sessionTime(meta.updatedAt, now, locale)
  return (
    <button
      type="button"
      className="hx-session"
      aria-current={current ? 'page' : undefined}
      onClick={() => void actions.openSession(meta.id)}
      title={meta.title}
    >
      <span className="t">{meta.title || t('header.newChat')}</span>
      {project && <span className="p">{project}</span>}
      <span className={`s ${meta.status === 'waiting' ? 'is-waiting' : ''}`}>{trail}</span>
    </button>
  )
}

/** Re-renders once a minute so the times beside conversations stay true. */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

interface ProjectProps {
  path: string
  sessions: SessionMeta[]
  open: boolean
  current: boolean
  chatId: string | null
  now: number
  onToggle(): void
}

/** One project: its name, then its conversations, most recent first. */
function Project({ path, sessions, open, current, chatId, now, onToggle }: ProjectProps) {
  const home = useApp((s) => s.app.home)
  const [all, setAll] = useState(false)
  const [menu, setMenu] = useState(false)
  const moreRef = useRef<HTMLButtonElement>(null)
  const name = baseName(path)
  const shown = all ? sessions : sessions.slice(0, SHOW)
  const listId = `hx-project-${path.replace(/[^\w-]/g, '_')}`
  return (
    <section className="hx-proj" data-current={current || undefined}>
      <div className="hx-proj-row">
        <button type="button" className="hx-proj-name" aria-expanded={open} aria-controls={listId} title={tildify(path, home)} onClick={onToggle}>
          <Icon icon={current ? FolderOpen : Folder} size={16} />
          <span className="n">{name}</span>
          <Icon icon={ChevronRight} size={14} className="hx-chev" />
        </button>
        <span className="acts">
          <button
            ref={moreRef}
            type="button"
            className="btn-ghost"
            aria-haspopup="menu"
            aria-expanded={menu}
            aria-label={t('project.more', { name })}
            title={t('project.more', { name })}
            onClick={() => setMenu((o) => !o)}
          >
            <Icon icon={Ellipsis} size={16} />
          </button>
          <button
            type="button"
            className="btn-ghost"
            aria-label={t('project.newChat', { name })}
            title={t('project.newChat', { name })}
            onClick={() => void actions.newChat(path)}
          >
            <Icon icon={Plus} size={16} />
          </button>
        </span>
      </div>
      <div className={`hx-disc ${open ? 'is-open' : ''}`} id={listId}>
        <div>
          <div className="hx-session-list">
            {sessions.length === 0 && <p className="hx-proj-empty">{t('project.empty')}</p>}
            {shown.map((meta) => (
              <SessionRow key={meta.id} meta={meta} current={meta.id === chatId} now={now} />
            ))}
            {sessions.length > SHOW && (
              <button type="button" className="hx-proj-more" onClick={() => setAll((a) => !a)}>
                {all ? t('project.less') : t('project.moreChats', { n: sessions.length - SHOW })}
              </button>
            )}
          </div>
        </div>
      </div>
      <Menu anchor={moreRef.current} open={menu} onClose={() => setMenu(false)} label={name} minWidth={200}>
        <MenuItem
          icon={<Icon icon={X} size={18} />}
          onSelect={() => {
            setMenu(false)
            void actions.removeProject(path)
          }}
        >
          {t('project.remove')}
        </MenuItem>
      </Menu>
    </section>
  )
}

export function Sidebar({ searchTick }: { searchTick: number }) {
  const workspace = useApp((s) => s.workspace)
  const sessions = useApp((s) => s.sessions)
  const activeAt = useApp((s) => s.activeAt)
  const chatId = useApp((s) => s.chatId)
  const view = useApp((s) => s.view)
  const saved = useApp((s) => s.settings.projects)
  const platform = useApp((s) => s.app.platform)
  const now = useMinute()

  const searchRef = useRef<HTMLInputElement>(null)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [folded, setFolded] = useState(readFolded)

  useEffect(() => {
    // The sidebar remounts after Settings; only a new shortcut press opens search.
    if (searchTick > handledSearchTick) {
      handledSearchTick = searchTick
      setSearching(true)
    }
  }, [searchTick])
  useEffect(() => {
    if (searching) searchRef.current?.focus()
  }, [searching, searchTick])

  const closeSearch = () => {
    setSearching(false)
    setQuery('')
  }

  const projects = useMemo(() => projectPaths(saved, workspace), [saved, workspace])

  const byProject = useMemo(() => {
    const map = new Map<string, SessionMeta[]>()
    const ordered = [...sessions].sort((a, b) => (activeAt[b.id] ?? b.updatedAt) - (activeAt[a.id] ?? a.updatedAt))
    for (const meta of ordered) map.set(meta.workspace, [...(map.get(meta.workspace) ?? []), meta])
    return map
  }, [sessions, activeAt])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    return [...sessions]
      .filter((s) => s.title.toLowerCase().includes(q) && projects.includes(s.workspace))
      .sort((a, b) => (activeAt[b.id] ?? b.updatedAt) - (activeAt[a.id] ?? a.updatedAt))
  }, [sessions, activeAt, query, projects])

  const toggle = (path: string) => {
    const next = folded.includes(path) ? folded.filter((p) => p !== path) : [...folded, path]
    setFolded(next)
    writeFolded(next)
  }

  const mod = modKey(platform)
  const currentChat = view === 'chat' ? chatId : null

  return (
    <nav className="oy-sidebar hx-sidebar" aria-label={t('sidebar.label')}>
      <div className="hx-side-bar">
        {platform === 'darwin' && (
          <button
            type="button"
            className="btn-ghost hx-icon-btn"
            aria-label={t('sidebar.hide')}
            title={`${t('sidebar.hide')} (${mod}B)`}
            onClick={() => actions.toggleSidebar()}
          >
            <Icon icon={PanelLeft} size={16} />
          </button>
        )}
      </div>
      <div className="hx-sidebar-top">
        <div className="hx-nav">
          <button
            type="button"
            className="oy-nav-item"
            aria-current={view === 'chat' && !chatId ? 'page' : undefined}
            onClick={() => (workspace ? void actions.newChat() : void actions.pickWorkspace())}
          >
            <Icon icon={SquarePen} />
            <span>{t('sidebar.new')}</span>
            <span className="hx-nav-trail">{t('shortcut.new', { mod })}</span>
          </button>
          {searching ? (
            <div className="hx-search">
              <Icon icon={Search} />
              <input
                ref={searchRef}
                type="search"
                value={query}
                placeholder={t('sidebar.searchPlaceholder')}
                aria-label={t('sidebar.search')}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    event.stopPropagation()
                    closeSearch()
                  }
                }}
                onBlur={() => {
                  if (!query) setSearching(false)
                }}
              />
              <button type="button" className="btn-ghost" aria-label={t('common.cancel')} onMouseDown={(event) => event.preventDefault()} onClick={closeSearch}>
                <Icon icon={X} size={16} />
              </button>
            </div>
          ) : (
            <button type="button" className="oy-nav-item" onClick={() => setSearching(true)}>
              <Icon icon={Search} />
              <span>{t('sidebar.search')}</span>
              <span className="hx-nav-trail">{t('shortcut.search', { mod })}</span>
            </button>
          )}
        </div>
      </div>

      <div className="hx-sessions">
        {results ? (
          <>
            <h2 className="hx-side-head">{t('sidebar.results')}</h2>
            {results.length === 0 && <p className="hx-side-note">{t('sidebar.noResults')}</p>}
            <div className="hx-session-list">
              {results.map((meta) => (
                <SessionRow key={meta.id} meta={meta} current={meta.id === currentChat} now={now} project={baseName(meta.workspace)} />
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="hx-side-head hx-projects-head">
              <h2>{t('sidebar.projects')}</h2>
              <button
                type="button"
                className="btn-ghost"
                aria-label={t('project.add')}
                title={t('project.add')}
                onClick={() => void actions.pickWorkspace()}
              >
                <Icon icon={FolderPlus} size={16} />
              </button>
            </div>
            {projects.length === 0 && (
              <button type="button" className="hx-proj-add" onClick={() => void actions.pickWorkspace()}>
                <Icon icon={FolderPlus} size={16} />
                {t('project.add')}
              </button>
            )}
            {projects.map((path) => (
              <Project
                key={path}
                path={path}
                sessions={byProject.get(path) ?? []}
                open={!folded.includes(path)}
                current={path === workspace?.path}
                chatId={currentChat}
                now={now}
                onToggle={() => toggle(path)}
              />
            ))}
          </>
        )}
      </div>

      <div className="hx-side-foot">
        <button type="button" className="oy-nav-item" onClick={() => actions.openSettings()}>
          <Icon icon={SettingsIcon} />
          <span>{t('sidebar.settings')}</span>
          <span className="hx-nav-trail">{`${mod},`}</span>
        </button>
      </div>
    </nav>
  )
}
