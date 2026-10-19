import { ChevronsUpDown, Folder, FolderOpen, Search, Settings as SettingsIcon, SquarePen, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { SessionMeta } from '../../shared/types'
import { dayGroup, modKey, sessionTime, tildify, type DayGroup } from '../format'
import { t } from '../i18n'
import { actions, useApp } from '../store'
import { Icon } from './Icon'
import { Menu, MenuItem, MenuSeparator } from './Menu'

const GROUPS: DayGroup[] = ['today', 'yesterday', 'week', 'earlier']
let handledSearchTick = 0
const GROUP_LABEL = { today: 'sidebar.today', yesterday: 'sidebar.yesterday', week: 'sidebar.week', earlier: 'sidebar.earlier' } as const

function SessionRow({ meta, current, now }: { meta: SessionMeta; current: boolean; now: number }) {
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
      <span className={`s ${meta.status === 'waiting' ? 'is-waiting' : meta.status === 'running' ? 'hx-shimmer' : ''}`}>{trail}</span>
    </button>
  )
}

/** Re-renders once a minute so "today" and "yesterday" stay true past midnight. */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

export function Sidebar({ searchTick }: { searchTick: number }) {
  const workspace = useApp((s) => s.workspace)
  const sessions = useApp((s) => s.sessions)
  const activeAt = useApp((s) => s.activeAt)
  const chatId = useApp((s) => s.chatId)
  const view = useApp((s) => s.view)
  const recent = useApp((s) => s.settings.recentWorkspaces)
  const home = useApp((s) => s.app.home)
  const platform = useApp((s) => s.app.platform)
  const now = useMinute()

  const projectRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [projectMenu, setProjectMenu] = useState(false)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')

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

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? sessions.filter((s) => s.title.toLowerCase().includes(q)) : sessions
    const byGroup = new Map<DayGroup, SessionMeta[]>()
    for (const meta of list) {
      const group = dayGroup(activeAt[meta.id] ?? meta.updatedAt, now)
      byGroup.set(group, [...(byGroup.get(group) ?? []), meta])
    }
    return GROUPS.filter((g) => byGroup.has(g)).map((g) => ({ group: g, items: byGroup.get(g)! }))
  }, [sessions, activeAt, query, now])

  const mod = modKey(platform)

  return (
    <nav className="oy-sidebar hx-sidebar" aria-label={t('sidebar.label')}>
      <div className="hx-drag" />
      <div className="hx-sidebar-top">
        <button
          ref={projectRef}
          type="button"
          className="hx-project"
          aria-haspopup="menu"
          aria-expanded={projectMenu}
          aria-label={workspace ? t('sidebar.project', { name: workspace.name }) : t('sidebar.noProject')}
          onClick={() => setProjectMenu((o) => !o)}
        >
          <Icon icon={Folder} />
          <span className="text">
            <span className="name">{workspace?.name ?? t('sidebar.noProject')}</span>
            <span className="path">{workspace ? tildify(workspace.path, home) : t('welcome.folderAction')}</span>
          </span>
          <Icon icon={ChevronsUpDown} size={16} />
        </button>

        <div className="hx-nav">
          <button type="button" className="oy-nav-item" aria-current={view === 'chat' && !chatId ? 'page' : undefined} onClick={() => actions.newChat()}>
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
        {groups.length === 0 && workspace && <p className="hx-side-note">{query ? t('sidebar.noResults') : t('sidebar.empty')}</p>}
        {groups.map(({ group, items }) => (
          <div key={group}>
            <h2 className="hx-side-head">{t(GROUP_LABEL[group])}</h2>
            <div className="hx-session-list">
              {items.map((meta) => (
                <SessionRow key={meta.id} meta={meta} current={view === 'chat' && meta.id === chatId} now={now} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="hx-side-foot">
        <button type="button" className="oy-nav-item" onClick={() => actions.openSettings()}>
          <Icon icon={SettingsIcon} />
          <span>{t('sidebar.settings')}</span>
          <span className="hx-nav-trail">{`${mod},`}</span>
        </button>
      </div>

      <Menu anchor={projectRef.current} open={projectMenu} onClose={() => setProjectMenu(false)} label={t('sidebar.recent')} matchWidth minWidth={236}>
        {recent.map((path) => (
          <MenuItem
            key={path}
            checked={path === workspace?.path}
            sub={tildify(path, home)}
            onSelect={() => {
              setProjectMenu(false)
              if (path !== workspace?.path) void actions.openWorkspace(path)
            }}
          >
            {path.split(/[\\/]/).filter(Boolean).pop() ?? path}
          </MenuItem>
        ))}
        {recent.length > 0 && <MenuSeparator />}
        <MenuItem
          icon={<Icon icon={FolderOpen} size={18} />}
          onSelect={() => {
            setProjectMenu(false)
            void actions.pickWorkspace()
          }}
        >
          {t('sidebar.openOther')}
        </MenuItem>
      </Menu>
    </nav>
  )
}
