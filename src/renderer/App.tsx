import { useEffect, useState } from 'react'
import { ChangesPanel } from './components/ChangesPanel'
import { Resizer } from './components/Resizer'
import { ChatView } from './components/ChatView'
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

export function App() {
  const ready = useApp((s) => s.ready)
  const view = useApp((s) => s.view)
  const locale = useApp((s) => s.settings.locale)
  const platform = useApp((s) => s.app.platform)
  const title = useApp((s) => s.chat?.session.title)
  const panel = useApp((s) => s.showChanges && (s.chatId !== null || (s.hasApiKey && s.workspace !== null)))
  const chat = useApp((s) => s.chat)
  const [searchTick, setSearchTick] = useState(0)

  setLocale(locale)
  useTheme()
  useShortcuts(() => setSearchTick((n) => n + 1))

  useEffect(() => {
    document.documentElement.dataset.platform = platform
  }, [platform])
  useEffect(() => {
    document.title = title ? `${title} - ${t('app.name')}` : t('app.name')
  }, [title, locale])

  // Nothing renders until the saved state is in, so the first frame is already the right one.
  if (!ready) return null

  if (view === 'settings') {
    return (
      <div className="hx-app">
        <SettingsView />
      </div>
    )
  }
  return (
    <div className="hx-app">
      <Sidebar searchTick={searchTick} />
      <Resizer pane="sidebar" />
      <ChatView />
      {panel && <Resizer pane="changes" />}
      {panel && <ChangesPanel chat={chat} />}
    </div>
  )
}
