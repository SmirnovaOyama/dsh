import { ChevronLeft, Cpu, KeyRound, LoaderCircle, Shield, Sun, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { EFFORTS, MAX_STEPS_OPTIONS, MODELS, type ConnectionResult, type Effort, type Locale, type PermissionMode, type ReplyStyle, type ThemePref } from '../../shared/types'
import { api } from '../api'
import { LOCALE_NAMES, t, type MessageKey } from '../i18n'
import { actions, useApp, type SettingsSection } from '../store'
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

const update = (patch: Parameters<typeof api.settings.update>[0]) => void api.settings.update(patch)

export function SettingsView() {
  const initial = useApp((s) => s.settingsSection)
  const [current, setCurrent] = useState<SettingsSection>(initial ?? 'connection')
  const [scrolled, setScrolled] = useState(false)
  const pageRef = useRef<HTMLDivElement>(null)
  const from = useApp((s) => s.settingsFrom)

  const goTo = (id: SettingsSection, smooth = true) => {
    setCurrent(id)
    document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant', block: 'start' })
  }

  useEffect(() => {
    if (initial) goTo(initial, false)
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const onScroll = () => {
    const page = pageRef.current
    if (!page) return
    setScrolled(page.scrollTop > 0)
    // The section whose heading passed the sticky title is the current one.
    let active: SettingsSection = SECTIONS[0].id
    for (const section of SECTIONS) {
      const el = document.getElementById(`settings-${section.id}`)
      if (el && el.getBoundingClientRect().top - page.getBoundingClientRect().top < 120) active = section.id
    }
    if (page.scrollTop + page.clientHeight >= page.scrollHeight - 4) active = SECTIONS[SECTIONS.length - 1].id
    setCurrent(active)
  }

  return (
    <>
      <nav className="oy-sidebar hx-sidebar" aria-label={t('settings.title')}>
        <div className="hx-drag" />
        <button type="button" className="hx-back" onClick={() => actions.closeSettings()}>
          <Icon icon={ChevronLeft} />
          {t(from === 'artifacts' ? 'settings.backToLibrary' : 'settings.back')}
        </button>
        <div className="hx-settings-nav">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
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
      <div ref={pageRef} className="hx-page" onScroll={onScroll}>
        <header className={`hx-page-head ${scrolled ? 'is-scrolled' : ''}`}>
          <div className="in">
            <h1>{t('settings.title')}</h1>
          </div>
        </header>
        <div className="hx-page-body">
          <Connection focusKey={initial === 'connection'} />
          <ModelGroup />
          <Permissions />
          <Appearance />
        </div>
      </div>
    </>
  )
}

function Group({ id, title, children }: { id: SettingsSection; title: string; children: ReactNode }) {
  return (
    <section className="hx-group" id={`settings-${id}`} aria-labelledby={`settings-${id}-title`}>
      <h2 className="hx-group-head" id={`settings-${id}-title`}>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Row({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="oy-row">
      <div className="text">
        <p className="title">{title}</p>
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
  const commitBaseUrl = () => {
    const value = baseUrl.trim().replace(/\/+$/, '')
    if (/^https?:\/\/\S+$/.test(value) && value !== settings.baseUrl) update({ baseUrl: value })
    else setBaseUrl(settings.baseUrl)
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

  return (
    <Group id="connection" title={t('settings.connection')}>
      <div className="hx-fieldset">
        <div>
          <label className="oy-field-label" htmlFor="api-key">
            {t('settings.apiKey')}
          </label>
          <div className="hx-field-row">
            <input
              ref={keyRef}
              className="input-base"
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
            <button type="button" className="btn-secondary" disabled={!hasApiKey && !key} onClick={() => void toggleReveal()}>
              <Reserve shown={revealed ? 1 : 0} forms={[t('settings.show'), t('settings.hide')]} />
            </button>
            <button type="button" className="btn-primary" disabled={!dirty} onClick={() => void save()}>
              <Reserve shown={justSaved && !dirty ? 1 : 0} forms={[t('settings.save'), t('settings.saved')]} />
            </button>
          </div>
          <div className="hx-field-hint-row">
            {/* Only said when the key is not encrypted, since that is worth knowing. */}
            {!encrypted && <p className="oy-field-hint">{t('settings.keyPlain')}</p>}
            {hasApiKey && (
              <button
                type="button"
                className="hx-text-btn"
                onClick={() => {
                  void api.settings.clearApiKey()
                  setKey('')
                  setSavedKey('')
                  setRevealed(false)
                  setResult(null)
                }}
              >
                {t('settings.remove')}
              </button>
            )}
          </div>
        </div>
        <div>
          <label className="oy-field-label" htmlFor="base-url">
            {t('settings.baseUrl')}
          </label>
          <input
            className="input-base"
            id="base-url"
            type="url"
            value={baseUrl}
            spellCheck={false}
            onChange={(event) => setBaseUrl(event.target.value)}
            onBlur={commitBaseUrl}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitBaseUrl()
            }}
          />
        </div>
        <div className="hx-test-line" aria-live="polite">
          <button type="button" className="btn-secondary" disabled={testing || !hasApiKey} onClick={() => void test()}>
            <Reserve
              shown={testing ? 1 : 0}
              forms={[
                t('settings.test'),
                <>
                  <Icon icon={LoaderCircle} size={14} className="hx-spin" />
                  {t('settings.testing')}
                </>,
              ]}
            />
          </button>
          {result && (
            <span key={round} className={`hx-test-result ${testing ? 'is-stale' : ''}`}>
              <span className="st">
                <span className="hx-muted">{t('settings.status')}</span>
                <span className={result.ok ? 'hx-positive' : 'hx-danger'}>
                  {result.ok ? t('settings.ok') : t(`error.${result.error ?? 'unknown'}.title` as MessageKey)}
                </span>
              </span>
              {result.ok && result.latencyMs !== undefined && (
                <span className="st">
                  <span className="hx-muted">{t('settings.latency')}</span>
                  <span className="hx-tabular">
                    <CountUp value={result.latencyMs} /> ms
                  </span>
                </span>
              )}
            </span>
          )}
        </div>
      </div>
    </Group>
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
    <Group id="model" title={t('settings.model')}>
      <div className="oy-section is-plain">
        <Row title={t('settings.defaultModel')}>
          <Select
            className="hx-row-control"
            label={t('settings.defaultModel')}
            value={settings.model}
            options={MODELS.map((m) => ({ value: m, label: modelName(m), desc: modelDesc(m) }))}
            onChange={(model) => update({ model })}
          />
        </Row>
        <Row title={t('settings.defaultEffort')}>
          <Segmented<Effort>
            label={t('settings.defaultEffort')}
            value={settings.effort}
            options={EFFORTS.map((e) => ({ value: e, label: t(`effort.${e}`) }))}
            onChange={(effort) => update({ effort })}
          />
        </Row>
        <Row title={t('settings.style')}>
          <Segmented<ReplyStyle>
            label={t('settings.style')}
            value={settings.replyStyle}
            options={(['precise', 'balanced', 'varied'] as const).map((v) => ({ value: v, label: t(`settings.style.${v}`) }))}
            onChange={(replyStyle) => update({ replyStyle })}
          />
        </Row>
        <Row title={t('settings.maxSteps')}>
          <Select
            className="hx-row-control"
            label={t('settings.maxSteps')}
            value={settings.maxSteps}
            options={MAX_STEPS_OPTIONS.map((n) => ({ value: n, label: t('settings.steps', { n }) }))}
            onChange={(maxSteps) => update({ maxSteps })}
          />
        </Row>
      </div>
    </Group>
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
    <Group id="permissions" title={t('settings.permissions')}>
      <div className="hx-card">
        <div className="oy-section is-plain">
          <Row title={t('settings.defaultMode')}>
            <Select<PermissionMode>
              className="hx-row-control"
              label={t('settings.defaultMode')}
              value={settings.permissionMode}
              options={(['ask', 'acceptEdits', 'auto'] as const).map((m) => ({ value: m, label: t(`mode.${m}`), desc: t(`mode.${m}.desc`) }))}
              onChange={(permissionMode) => update({ permissionMode })}
            />
          </Row>
          <Row title={t('settings.allowed')} />
        </div>
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
                  <Icon icon={X} size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="hx-allowed-add">
            <input
              className="input-base"
              value={adding}
              spellCheck={false}
              placeholder={t('settings.allowedPlaceholder')}
              aria-label={t('settings.allowed')}
              onChange={(event) => setAdding(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') add()
              }}
            />
            <button type="button" className="btn-secondary" disabled={!adding.trim()} onClick={add}>
              {t('settings.allowedAdd')}
            </button>
          </div>
        </div>
      </div>
    </Group>
  )
}

function Appearance() {
  const settings = useApp((s) => s.settings)
  const version = useApp((s) => s.app.version)
  return (
    <Group id="appearance" title={t('settings.appearance')}>
      <div className="oy-section is-plain">
        <Row title={t('settings.theme')}>
          <Segmented<ThemePref>
            label={t('settings.theme')}
            value={settings.theme}
            options={(['light', 'dark', 'system'] as const).map((v) => ({ value: v, label: t(`settings.theme.${v}`) }))}
            onChange={(theme) => update({ theme })}
          />
        </Row>
        <Row title={t('settings.language')}>
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
    </Group>
  )
}
