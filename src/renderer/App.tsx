import { useEffect, useRef, useState } from 'react'
import { ChangesPanel } from './components/ChangesPanel'
import { Resizer } from './components/Resizer'
import { ChatView } from './components/ChatView'
import { LibraryView } from './components/LibraryView'
import { SettingsView } from './components/SettingsView'
import { Sidebar } from './components/Sidebar'
import { setLocale, t } from './i18n'
import { actions, getState, useApp } from './store'

function useTheme() {
  const pref = useApp((s) => s.settings.theme)
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const theme = pref === 'system' ? (media.matches ? 'dark' : 'light') : pref
      document.documentElement.dataset.theme = theme
      try {
        localStorage.setItem('dsh.theme', theme)
      } catch {
        // Without storage the window may flash its default colour once at launch; nothing else changes.
      }
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [pref])
}

function useShortcuts(onSearch: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = getState().app.platform === 'darwin' ? event.metaKey : event.ctrlKey
      if (!mod || event.altKey || event.shiftKey) return
      const key = event.key.toLowerCase()
      if (key === 'n') {
        event.preventDefault()
        actions.newChat()
      } else if (key === 'k') {
        event.preventDefault()
        if (getState().view === 'settings') actions.closeSettings()
        onSearch()
      } else if (key === ',') {
        event.preventDefault()
        actions.openSettings()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSearch])
}

export type Motion = 'still' | 'in' | 'out'

/**
 * Keeps a pane mounted while it animates closed. A pane that is already open at launch stays still;
 * one opened later slides in.
 */
function usePresence(shown: boolean, ms: number): Motion | null {
  const first = useRef(true)
  const [motion, setMotion] = useState<Motion | null>(shown ? 'still' : null)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (shown) {
      setMotion('in')
      // Once open, the pane settles, so it never plays the opening again when it is drawn anew.
      const timer = setTimeout(() => setMotion('still'), 400)
      return () => clearTimeout(timer)
    }
    setMotion((m) => (m === null ? null : 'out'))
    const timer = setTimeout(() => setMotion(null), ms)
    return () => clearTimeout(timer)
  }, [shown, ms])
  return motion
}

export function App() {
  const ready = useApp((s) => s.ready)
  const view = useApp((s) => s.view)
  const locale = useApp((s) => s.settings.locale)
  const platform = useApp((s) => s.app.platform)
  const title = useApp((s) => s.chat?.session.title)
  const panel = useApp((s) => s.showChanges && (s.chatId !== null || (s.hasApiKey && s.workspace !== null)))
  const chat = useApp((s) => s.chat)
  const panelMotion = usePresence(panel, 220)
  const panelPane = useApp((s) => (s.panelTab === 'artifacts' ? 'artifacts' : 'changes'))
  const switching = useApp((s) => s.switching)
  const [searchTick, setSearchTick] = useState(0)

  setLocale(locale)
  useTheme()
  useShortcuts(() => setSearchTick((n) => n + 1))

  useEffect(() => {
    document.documentElement.dataset.platform = platform
  }, [platform])
  useEffect(() => {
    const name = view === 'artifacts' ? t('library.title') : title
    document.title = name ? `${name} - ${t('app.name')}` : t('app.name')
  }, [title, view, locale])

  // Nothing renders until the saved state is in, so the first frame is already the right one.
  if (!ready) return null

  if (view === 'settings') {
    return (
      <div className="hx-app">
        <SettingsView />
      </div>
    )
  }
  // The library covers the conversation rather than replacing it, so coming back finds the conversation,
  // its scroll and its running pages as they were.
  const library = view === 'artifacts'
  return (
    <div className="hx-app" aria-busy={switching || undefined}>
      <Sidebar searchTick={searchTick} />
      <Resizer pane="sidebar" />
      <ChatView />
      {panelMotion && panelMotion !== 'out' && !library && <Resizer key={panelPane} pane={panelPane} />}
      {panelMotion && <ChangesPanel chat={chat} motion={panelMotion} />}
      {library && <LibraryView />}
    </div>
  )
}
