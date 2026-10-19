import { Ellipsis, Folder, GitBranch, LayoutGrid, PanelRight, Trash2 } from 'lucide-react'
import { isArtifact } from '../artifacts'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { tildify } from '../format'
import { t } from '../i18n'
import { HoldScroll } from '../scroll'
import { actions, useApp } from '../store'
import { Composer } from './Composer'
import { NoteDoodle } from './Doodles'
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
  const draftModel = useApp((s) => s.draft.model)
  const showChanges = useApp((s) => s.showChanges)
  const hasArtifacts = useApp((s) => s.chat?.session.items.some(isArtifact) ?? false)
  const showingArtifacts = useApp((s) => s.showChanges && s.panelTab === 'artifacts')
  const moreRef = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState(false)
  const [confirm, setConfirm] = useState(false)

  const title = chat?.session.title || loadingTitle || t('header.newChat')
  const path = chat?.session.workspace ?? workspace?.path
  const model = chat?.session.model ?? draftModel

  return (
    <header className="hx-header">
      <div className="heading">
        <h1 className="title">{title}</h1>
        <p className="sub">
          {path && (
            <span>
              <Icon icon={Folder} size={14} />
              <span className="path">{tildify(path, home)}</span>
            </span>
          )}
          {workspace?.branch && (
            <span>
              <Icon icon={GitBranch} size={14} />
              {workspace.branch}
            </span>
          )}
          <span>{model}</span>
        </p>
      </div>
      <div className="actions">
        {hasArtifacts && (
          <button
            type="button"
            className="btn-ghost hx-icon-btn"
            aria-pressed={showingArtifacts}
            aria-label={t('artifact.all')}
            title={t('artifact.all')}
            onClick={() => (showingArtifacts ? actions.closeArtifacts() : actions.viewArtifact(null))}
          >
            <Icon icon={LayoutGrid} size={18} />
          </button>
        )}
        <button
          type="button"
          className="btn-ghost hx-icon-btn"
          aria-pressed={showChanges && !showingArtifacts}
          aria-label={t(showChanges ? 'header.hideChanges' : 'header.showChanges')}
          title={t(showChanges ? 'header.hideChanges' : 'header.showChanges')}
          onClick={() => actions.toggleChanges()}
        >
          <Icon icon={PanelRight} size={18} />
        </button>
        <button
          ref={moreRef}
          type="button"
          className="btn-ghost hx-icon-btn"
          aria-haspopup="menu"
          aria-expanded={menu}
          aria-label={t('header.more')}
          title={t('header.more')}
          disabled={!chatId}
          onClick={() => setMenu((o) => !o)}
        >
          <Icon icon={Ellipsis} size={18} />
        </button>
      </div>
      <Menu anchor={moreRef.current} open={menu} onClose={() => setMenu(false)} label={t('header.more')} align="end" minWidth={200}>
        <MenuItem
          danger
          icon={<Icon icon={Trash2} size={18} />}
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
    <div className="hx-empty">
      <NoteDoodle label={t('new.title')} />
      <h2>{t('new.title')}</h2>
      <p>{t('new.body')}</p>
    </div>
  )
}

export function ChatView() {
  const hasChat = useApp((s) => s.chat !== null || s.chatId !== null)
  const hasApiKey = useApp((s) => s.hasApiKey)
  const hasWorkspace = useApp((s) => s.workspace !== null)
  return (
    <main className="hx-main">{!hasChat && !hasApiKey ? <NoKey /> : !hasChat && !hasWorkspace ? <NoFolder /> : <Conversation />}</main>
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
      <div ref={contentRef} className="hx-scroll-content">
        <Header />
        <HoldScroll.Provider value={hold}>
          <div className="hx-column">{chat ? <Transcript session={chat.session} changes={chat.changes} /> : chatId ? null : <NewChat />}</div>
        </HoldScroll.Provider>
        <Composer chat={chat} showJump={showJump} onJump={() => toBottom(true)} onSent={() => toBottom()} />
      </div>
    </div>
  )
}
