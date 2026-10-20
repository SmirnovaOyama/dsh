import { ChevronDown, Folder, GitBranch, PanelRight, Trash2 } from 'lucide-react'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { tildify } from '../format'
import { t } from '../i18n'
import { HoldScroll } from '../scroll'
import { actions, useApp } from '../store'
import { Composer } from './Composer'
import { DiffStatsText } from './DiffView'
import { Icon } from './Icon'
import { Menu, MenuItem } from './Menu'
import { Modal } from './Modal'
import { Transcript } from './Transcript'
import { NoFolder, NoKey } from './Welcome'

/** How close to the bottom still counts as "following along". */
const PIN_DISTANCE = 48
const JUMP_DISTANCE = 240

function Header() {
  const chat = useApp((s) => s.chat)
  const chatId = useApp((s) => s.chatId)
  const loadingTitle = useApp((s) => s.sessions.find((m) => m.id === s.chatId)?.title)
  const workspace = useApp((s) => s.workspace)
  const home = useApp((s) => s.app.home)
  // While artifacts fill the panel, this button brings back changes and files rather than hiding it.
  const showingChanges = useApp((s) => s.showChanges && s.panelTab !== 'artifacts')
  const moreRef = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState(false)
  const [confirm, setConfirm] = useState(false)

  const title = chat?.session.title || loadingTitle || t('header.newChat')
  const path = chat?.session.workspace ?? workspace?.path

  const changes = chat?.changes ?? []
  const added = changes.reduce((n, c) => n + c.stats.added, 0)
  const removed = changes.reduce((n, c) => n + c.stats.removed, 0)

  return (
    <header className="hx-header">
      <div className="heading">
        {/* The title opens the conversation's menu, the way Claude Code's caret beside the title does. */}
        <button
          ref={moreRef}
          type="button"
          className="hx-title"
          aria-haspopup="menu"
          aria-expanded={menu}
          title={t('header.more')}
          disabled={!chatId}
          onClick={() => setMenu((o) => !o)}
        >
          <h1>{title}</h1>
          {chatId && <Icon icon={ChevronDown} size={14} />}
        </button>
        {path && (
          <span className="sub" title={path}>
            <Icon icon={Folder} size={14} />
            <span className="path">{tildify(path, home)}</span>
          </span>
        )}
        {workspace?.branch && (
          <span className="sub">
            <Icon icon={GitBranch} size={14} />
            <span className="path">{workspace.branch}</span>
          </span>
        )}
      </div>
      <div className="actions">
        <button
          type="button"
          className="btn-ghost hx-pane-btn"
          aria-pressed={showingChanges}
          aria-label={t(showingChanges ? 'header.hideChanges' : 'header.showChanges')}
          title={t(showingChanges ? 'header.hideChanges' : 'header.showChanges')}
          onClick={() => actions.toggleChanges()}
        >
          <Icon icon={PanelRight} />
          <span>{t('panel.changes')}</span>
          {changes.length > 0 && (
            <span className="stats">
              <DiffStatsText added={added} removed={removed} />
            </span>
          )}
        </button>
      </div>
      <Menu anchor={moreRef.current} open={menu} onClose={() => setMenu(false)} label={t('header.more')} minWidth={200}>
        <MenuItem
          danger
          icon={<Icon icon={Trash2} />}
          onSelect={() => {
            setMenu(false)
            setConfirm(true)
          }}
        >
          {t('header.delete')}
        </MenuItem>
      </Menu>
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t('delete.title')}
        body={t('delete.body')}
        actions={
          <>
            <button type="button" className="btn-secondary" data-autofocus onClick={() => setConfirm(false)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => {
                setConfirm(false)
                if (chatId) void actions.removeSession(chatId)
              }}
            >
              {t('delete.confirm')}
            </button>
          </>
        }
      />
    </header>
  )
}

function NewChat() {
  return (
    <div className="hx-greeting">
      <h2>{t('new.title')}</h2>
      <p>{t('new.body')}</p>
    </div>
  )
}

export function ChatView() {
  const hasChat = useApp((s) => s.chat !== null || s.chatId !== null)
  const hasApiKey = useApp((s) => s.hasApiKey)
  const hasWorkspace = useApp((s) => s.workspace !== null)
  const covered = useApp((s) => s.view === 'artifacts')
  return (
    <main className="hx-main" inert={covered}>{!hasChat && !hasApiKey ? <NoKey /> : !hasChat && !hasWorkspace ? <NoFolder /> : <Conversation />}</main>
  )
}

function Conversation() {
  const chat = useApp((s) => s.chat)
  const chatId = useApp((s) => s.chatId)

  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const holdUntil = useRef(0)
  const [showJump, setShowJump] = useState(false)

  const measure = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    pinned.current = distance < PIN_DISTANCE
    // The header shows its hairline only once text passes under it.
    el.toggleAttribute('data-scrolled', el.scrollTop > 0)
    setShowJump(distance > JUMP_DISTANCE)
  }, [])

  const toBottom = useCallback((smooth = false) => {
    const el = scrollRef.current
    if (!el) return
    pinned.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'instant' })
    setShowJump(false)
  }, [])

  // Follow new output while the reader is at the bottom; leave them alone when they scrolled up.
  useLayoutEffect(() => {
    const el = scrollRef.current
    const content = contentRef.current
    if (!el || !content) return
    const observer = new ResizeObserver(() => {
      if (pinned.current && performance.now() > holdUntil.current) el.scrollTop = el.scrollHeight
      else measure()
    })
    observer.observe(content)
    observer.observe(el)
    return () => observer.disconnect()
  }, [measure])

  // A newly opened conversation starts at its latest message.
  const loaded = chat?.session.id ?? null
  useLayoutEffect(() => {
    toBottom()
  }, [loaded, toBottom])

  const hold = useCallback(() => {
    // Covers the disclosure animation, so the row that was clicked stays under the pointer.
    holdUntil.current = performance.now() + 400
    window.setTimeout(measure, 420)
  }, [measure])

  return (
    <div ref={scrollRef} className="hx-scroll" onScroll={measure}>
      <div ref={contentRef} className={`hx-scroll-content ${!chat && !chatId ? 'is-new' : ''}`}>
        <Header />
        <HoldScroll.Provider value={hold}>
          <div className="hx-column">{chat ? <Transcript session={chat.session} changes={chat.changes} /> : chatId ? null : <NewChat />}</div>
        </HoldScroll.Provider>
        <Composer chat={chat} showJump={showJump} onJump={() => toBottom(true)} onSent={() => toBottom()} />
      </div>
    </div>
  )
}
