import { ArrowUpRight, ChevronLeft, Cpu, Eye, EyeOff, KeyRound, LoaderCircle, Shield, Sun, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { DEFAULT_SETTINGS, EFFORTS, MAX_STEPS_OPTIONS, MODELS, PERMISSION_MODES, type ConnectionResult, type Effort, type Locale, type PermissionMode, type ReplyStyle, type ThemePref } from '../../shared/types'
import { api } from '../api'
import { LOCALE_NAMES, t, type MessageKey } from '../i18n'
import { actions, lastSettingsSection, useApp, type SettingsSection } from '../store'
import { modelDesc, modelName } from '../models'
import { Icon } from './Icon'
import { Reserve } from './Reserve'
import { Segmented } from './Segmented'
import { Select } from './Select'

const SECTIONS: { id: SettingsSection; icon: LucideIcon; label: MessageKey }[] = [
  { id: 'connection', icon: KeyRound, label: 'settings.nav.connection' },
  { id: 'model', icon: Cpu, label: 'settings.nav.model' },
  { id: 'permissions', icon: Shield, label: 'settings.nav.permissions' },
  { id: 'appearance', icon: Sun, label: 'settings.nav.appearance' },
]

const KEYS_URL = 'https://platform.deepseek.com/api_keys'

const update = (patch: Parameters<typeof api.settings.update>[0]) => void api.settings.update(patch)

const TITLES: Record<SettingsSection, MessageKey> = {
  connection: 'settings.connection',
  model: 'settings.model',
  permissions: 'settings.permissions',
  appearance: 'settings.appearance',
}

export function SettingsView() {
  const asked = useApp((s) => s.settingsSection)
  // A section asked for by name wins; otherwise settings reopen where they were left.
  const [current, setCurrent] = useState<SettingsSection>(() => asked ?? lastSettingsSection())
  const [scrolled, setScrolled] = useState(false)
  const pageRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLDivElement>(null)
  const from = useApp((s) => s.settingsFrom)

  const goTo = (id: SettingsSection) => {
    setCurrent(id)
    actions.rememberSettingsSection(id)
    // Each section starts at its top, like a page of its own.
    pageRef.current?.scrollTo({ top: 0 })
    setScrolled(false)
  }

  useEffect(() => {
    if (asked && asked !== current) goTo(asked)
    // Only when another part of the app asks for a section.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        const target = event.target as HTMLElement
        if (target.tagName === 'INPUT' && (target as HTMLInputElement).value) return
        actions.closeSettings()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Up and down move through the list, the way a sidebar list does.
  const onNavKey = (event: ReactKeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const index = SECTIONS.findIndex((s) => s.id === current)
    const next = SECTIONS[(index + (event.key === 'ArrowDown' ? 1 : SECTIONS.length - 1)) % SECTIONS.length].id
    goTo(next)
    navRef.current?.querySelector<HTMLButtonElement>(`[data-section="${next}"]`)?.focus()
  }

  return (
    <>
      <nav className="oy-sidebar hx-sidebar" aria-label={t('settings.title')}>
        <div className="hx-drag" />
        <button type="button" className="hx-back" onClick={() => actions.closeSettings()}>
          <Icon icon={ChevronLeft} />
          {t(from === 'artifacts' ? 'settings.backToLibrary' : 'settings.back')}
        </button>
        <div ref={navRef} className="hx-settings-nav" onKeyDown={onNavKey}>
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              data-section={section.id}
              className="oy-nav-item"
              aria-current={current === section.id ? 'page' : undefined}
              onClick={() => goTo(section.id)}
            >
              <Icon icon={section.icon} />
              <span>{t(section.label)}</span>
            </button>
          ))}
        </div>
      </nav>
      <div ref={pageRef} className="hx-page" onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}>
        <header className={`hx-page-head ${scrolled ? 'is-scrolled' : ''}`}>
          <div className="in">
            <h1 id="settings-title">{t(TITLES[current])}</h1>
          </div>
        </header>
        <section className="hx-page-body" aria-labelledby="settings-title">
          {current === 'connection' && <Connection focusKey={asked === 'connection'} />}
          {current === 'model' && <ModelGroup />}
          {current === 'permissions' && <Permissions />}
          {current === 'appearance' && <Appearance />}
        </section>
      </div>
    </>
  )
}

function Row({ title, desc, children }: { title: string; desc?: string; children?: ReactNode }) {
  return (
    <div className="oy-row">
      <div className="text">
        <p className="title">{title}</p>
        {desc && <p className="desc">{desc}</p>}
      </div>
      {children}
    </div>
  )
}

function Connection({ focusKey }: { focusKey: boolean }) {
  const settings = useApp((s) => s.settings)
  const hasApiKey = useApp((s) => s.hasApiKey)
  const encrypted = useApp((s) => s.app.keyEncryption)
  const keyRef = useRef<HTMLInputElement>(null)
  const [key, setKey] = useState('')
  const [savedKey, setSavedKey] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl)
  const [urlInvalid, setUrlInvalid] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<ConnectionResult | null>(null)
  const [round, setRound] = useState(0)

  useEffect(() => {
    if (focusKey) keyRef.current?.focus({ preventScroll: true })
  }, [focusKey])
  useEffect(() => setBaseUrl(settings.baseUrl), [settings.baseUrl])
  useEffect(() => {
    if (!justSaved) return
    const timer = window.setTimeout(() => setJustSaved(false), 1600)
    return () => window.clearTimeout(timer)
  }, [justSaved])

  const dirty = key.trim().length > 0 && key.trim() !== savedKey
  const save = async () => {
    if (!dirty) return
    const value = key.trim()
    await api.settings.setApiKey(value)
    setSavedKey(value)
    setJustSaved(true)
    setResult(null)
  }
  const toggleReveal = async () => {
    if (revealed) {
      setRevealed(false)
      return
    }
    if (!key && hasApiKey) {
      const stored = (await api.settings.revealApiKey()) ?? ''
      setKey(stored)
      setSavedKey(stored)
    }
    setRevealed(true)
  }
  const remove = () => {
    void api.settings.clearApiKey()
    setKey('')
    setSavedKey('')
    setRevealed(false)
    setResult(null)
  }
  const commitBaseUrl = (value = baseUrl) => {
    const next = value.trim().replace(/\/+$/, '')
    if (!/^https?:\/\/\S+$/.test(next)) {
      setUrlInvalid(next.length > 0)
      if (!next) setBaseUrl(settings.baseUrl)
      return
    }
    setUrlInvalid(false)
    setBaseUrl(next)
    if (next !== settings.baseUrl) {
      update({ baseUrl: next })
      setResult(null)
    }
  }
  const test = async () => {
    setTesting(true)
    const started = performance.now()
    const outcome = await api.settings.testConnection()
    // Keep "testing" visible long enough to read, so the line does not flicker.
    const wait = 400 - (performance.now() - started)
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    setTesting(false)
    setResult(outcome)
    setRound((n) => n + 1)
  }

  const keyState = !hasApiKey ? t('settings.keyMissing') : encrypted ? t('settings.keyStored') : t('settings.keyPlain')
  const isDefaultUrl = settings.baseUrl === DEFAULT_SETTINGS.baseUrl

  return (
    <>
      <p className="hx-page-intro">{t('settings.connectionIntro')}</p>
      <div className="hx-form">
        <div className="hx-form-field">
          <div className="hx-form-label">
            <label className="oy-field-label" htmlFor="api-key">
              {t('settings.apiKey')}
            </label>
            <button type="button" className="hx-link" onClick={() => void api.openExternal(KEYS_URL)}>
              {t('settings.getKey')}
              <Icon icon={ArrowUpRight} size={14} />
            </button>
          </div>
          <div className="hx-form-line">
            <div className="hx-underline">
              <input
                ref={keyRef}
                id="api-key"
                type={revealed ? 'text' : 'password'}
                value={key}
                spellCheck={false}
                autoComplete="off"
                placeholder={hasApiKey ? t('settings.apiKeySet') : t('settings.apiKeyPlaceholder')}
                onChange={(event) => setKey(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void save()
                }}
              />
              <button
                type="button"
                className="btn-ghost hx-icon-btn"
                disabled={!hasApiKey && !key}
                aria-label={revealed ? t('settings.hide') : t('settings.show')}
                title={revealed ? t('settings.hide') : t('settings.show')}
                onClick={() => void toggleReveal()}
              >
                <Icon icon={revealed ? EyeOff : Eye} size={18} />
              </button>
            </div>
            <button type="button" className="btn-primary" disabled={!dirty} onClick={() => void save()}>
              <Reserve shown={justSaved && !dirty ? 1 : 0} forms={[t('settings.save'), t('settings.saved')]} />
            </button>
          </div>
          <div className="hx-form-hint">
            <p className="oy-field-hint">{keyState}</p>
            {hasApiKey && (
              <button type="button" className="hx-link is-danger" onClick={remove}>
                {t('settings.remove')}
              </button>
            )}
          </div>
        </div>

        <div className="hx-form-field">
          <div className="hx-form-label">
            <label className="oy-field-label" htmlFor="base-url">
              {t('settings.baseUrl')}
            </label>
          </div>
          <div className="hx-underline">
            <input
              id="base-url"
              type="url"
              value={baseUrl}
              spellCheck={false}
              aria-invalid={urlInvalid || undefined}
              onChange={(event) => {
                setBaseUrl(event.target.value)
                setUrlInvalid(false)
              }}
              onBlur={() => commitBaseUrl()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitBaseUrl()
              }}
            />
          </div>
          <div className="hx-form-hint">
            <p className={`oy-field-hint ${urlInvalid ? 'hx-danger' : ''}`}>
              {urlInvalid ? t('settings.baseUrlInvalid') : t('settings.baseUrlHint')}
            </p>
            {!isDefaultUrl && (
              <button type="button" className="hx-link" onClick={() => commitBaseUrl(DEFAULT_SETTINGS.baseUrl)}>
                {t('settings.baseUrlReset')}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="oy-section is-plain hx-settings-rows">
        <div className="oy-row">
          <div className="text">
            <p className="title">{t('settings.test')}</p>
            <p className="desc" aria-live="polite">
              {result ? (
                <span key={round} className={`hx-test-result ${testing ? 'is-stale' : ''}`}>
                  <span className={result.ok ? 'hx-positive' : 'hx-danger'}>
                    {result.ok ? t('settings.ok') : t(`error.${result.error ?? 'unknown'}.title` as MessageKey)}
                  </span>
                  {result.ok && result.latencyMs !== undefined && (
                    <span className="st">
                      <span>{t('settings.latency')}</span>
                      <span className="hx-tabular">
                        <CountUp value={result.latencyMs} /> ms
                      </span>
                    </span>
                  )}
                </span>
              ) : (
                t('settings.testDesc')
              )}
            </p>
          </div>
          <button type="button" className="btn-secondary" disabled={testing || !hasApiKey} onClick={() => void test()}>
            <Reserve
              shown={testing ? 1 : 0}
              forms={[
                t('settings.testShort'),
                <>
                  <Icon icon={LoaderCircle} size={16} className="hx-spin" />
                  {t('settings.testing')}
                </>,
              ]}
            />
          </button>
        </div>
      </div>
    </>
  )
}

/** Counts up to a number once, the way a reading settles; the width is held from the start. */
function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value)
      return
    }
    const start = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      const p = Math.min(1, (now - start) / 480)
      setShown(Math.round(value * (1 - (1 - p) ** 3)))
      if (p < 1) frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [value])
  return (
    <span className="hx-count" style={{ minWidth: `${String(value).length}ch` }}>
      {shown}
    </span>
  )
}

function ModelGroup() {
  const settings = useApp((s) => s.settings)
  return (
    <>
      <div className="oy-section is-plain hx-settings-rows">
        <Row title={t('settings.defaultModel')} desc={t('settings.defaultModel.desc')}>
          <Select
            className="hx-row-control"
            label={t('settings.defaultModel')}
            value={settings.model}
            options={MODELS.map((m) => ({ value: m, label: modelName(m), desc: modelDesc(m) }))}
            onChange={(model) => update({ model })}
          />
        </Row>
        <Row title={t('settings.defaultEffort')} desc={t('settings.defaultEffort.desc')}>
          <Segmented<Effort>
            label={t('settings.defaultEffort')}
            value={settings.effort}
            options={EFFORTS.map((e) => ({ value: e, label: t(`effort.${e}`) }))}
            onChange={(effort) => update({ effort })}
          />
        </Row>
        <Row title={t('settings.style')} desc={t('settings.style.desc')}>
          <Segmented<ReplyStyle>
            label={t('settings.style')}
            value={settings.replyStyle}
            options={(['precise', 'balanced', 'varied'] as const).map((v) => ({ value: v, label: t(`settings.style.${v}`) }))}
            onChange={(replyStyle) => update({ replyStyle })}
          />
        </Row>
        <Row title={t('settings.maxSteps')} desc={t('settings.maxSteps.desc')}>
          <Select
            className="hx-row-control"
            label={t('settings.maxSteps')}
            value={settings.maxSteps}
            options={MAX_STEPS_OPTIONS.map((n) => ({ value: n, label: t('settings.steps', { n }) }))}
            onChange={(maxSteps) => update({ maxSteps })}
          />
        </Row>
      </div>
    </>
  )
}

function Permissions() {
  const settings = useApp((s) => s.settings)
  const [adding, setAdding] = useState('')
  const add = () => {
    const prefix = adding.trim().replace(/\s+/g, ' ')
    if (!prefix || settings.allowedCommands.includes(prefix)) return
    update({ allowedCommands: [...settings.allowedCommands, prefix] })
    setAdding('')
  }
  return (
    <>
      <div className="oy-section is-plain hx-settings-rows">
        <Row title={t('settings.defaultMode')} desc={t(`mode.${settings.permissionMode}.desc`)}>
          <Select<PermissionMode>
            className="hx-row-control"
            label={t('settings.defaultMode')}
            value={settings.permissionMode}
            options={PERMISSION_MODES.map((m) => ({ value: m, label: t(`mode.${m}`), desc: t(`mode.${m}.desc`) }))}
            onChange={(permissionMode) => update({ permissionMode })}
          />
        </Row>
      </div>
      <h2 className="hx-settings-head">{t('settings.allowed')}</h2>
      <p className="hx-settings-desc">{t('settings.allowedDesc')}</p>
      <div className="hx-allowed">
        <div className="hx-allowed-list">
          {settings.allowedCommands.map((prefix) => (
            <div key={prefix} className="hx-allowed-item">
              <span className="hx-mono">{prefix}</span>
              <button
                type="button"
                className="btn-ghost hx-icon-btn"
                aria-label={t('settings.allowedRemove', { prefix })}
                title={t('settings.allowedRemove', { prefix })}
                onClick={() => update({ allowedCommands: settings.allowedCommands.filter((p) => p !== prefix) })}
              >
                <Icon icon={X} size={16} />
              </button>
            </div>
          ))}
        </div>
        <div className="hx-form-line">
          <div className="hx-underline">
            <input
              className="hx-mono"
              value={adding}
              spellCheck={false}
              placeholder={t('settings.allowedPlaceholder')}
              aria-label={t('settings.allowed')}
              onChange={(event) => setAdding(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') add()
              }}
            />
          </div>
          <button type="button" className="btn-secondary" disabled={!adding.trim()} onClick={add}>
            {t('settings.allowedAdd')}
          </button>
        </div>
      </div>
    </>
  )
}

function Appearance() {
  const settings = useApp((s) => s.settings)
  const version = useApp((s) => s.app.version)
  return (
    <>
      <div className="oy-section is-plain hx-settings-rows">
        <Row title={t('settings.theme')} desc={t('settings.theme.desc')}>
          <Segmented<ThemePref>
            label={t('settings.theme')}
            value={settings.theme}
            options={(['light', 'dark', 'system'] as const).map((v) => ({ value: v, label: t(`settings.theme.${v}`) }))}
            onChange={(theme) => update({ theme })}
          />
        </Row>
        <Row title={t('settings.language')} desc={t('settings.language.desc')}>
          <Select<Locale>
            className="hx-row-control"
            label={t('settings.language')}
            value={settings.locale}
            options={(Object.keys(LOCALE_NAMES) as Locale[]).map((l) => ({ value: l, label: LOCALE_NAMES[l] }))}
            onChange={(locale) => update({ locale })}
          />
        </Row>
      </div>
      <p className="hx-version">{`${t('app.name')} ${version}`}</p>
    </>
  )
}
