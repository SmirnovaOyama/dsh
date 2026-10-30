import { ArrowUpRight, ChevronLeft, Cpu, Plug, Plus, Shield, Sun, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { DEFAULT_SETTINGS, EFFORTS, MAX_STEPS_OPTIONS, OPENCODE_PLANS, PERMISSION_MODES, type Effort, type Locale, type OpenCodePlan, type PermissionMode, type Provider, type ReplyStyle, type ThemePref } from '../../shared/types'
import { api } from '../api'
import { attemptStatus, keyActions, keyStatus, maskKey, type KeyCheck } from '../connection'
import { LOCALE_NAMES, t, type MessageKey } from '../i18n'
import { actions, getState, lastSettingsSection, useApp, type SettingsSection } from '../store'
import { modelGroups, modelOptions } from '../models'
import { Icon } from './Icon'
import { Segmented } from './Segmented'
import { Select } from './Select'

const SECTIONS: { id: SettingsSection; icon: LucideIcon; label: MessageKey }[] = [
  { id: 'connection', icon: Plug, label: 'settings.nav.connection' },
  { id: 'model', icon: Cpu, label: 'settings.nav.model' },
  { id: 'permissions', icon: Shield, label: 'settings.nav.permissions' },
  { id: 'appearance', icon: Sun, label: 'settings.nav.appearance' },
]

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

const KEY_URLS: Record<Provider, string> = { deepseek: 'https://platform.deepseek.com/api_keys', opencode: 'https://opencode.ai/auth' }

function Connection({ focusKey }: { focusKey: boolean }) {
  return (
    <>
      <p className="hx-page-intro">{t('settings.connectionIntro')}</p>
      <div className="oy-section is-plain hx-settings-rows">
        <ProviderRow provider="deepseek" focus={focusKey} />
        <BaseUrlRow />
      </div>
      <div className="oy-section is-plain hx-settings-rows">
        <ProviderRow provider="opencode" />
        <PlanRow />
      </div>
    </>
  )
}

/** True once `on` has held for `ms`, so a quick check never flashes its waiting words. */
function useLate(on: boolean, ms: number) {
  const [late, setLate] = useState(false)
  useEffect(() => {
    if (!on) {
      setLate(false)
      return
    }
    const timer = window.setTimeout(() => setLate(true), ms)
    return () => window.clearTimeout(timer)
  }, [on, ms])
  return late
}

/**
 * A provider as one row: its name, one sentence on how its key stands, and what can be done with it.
 * The key line appears in place only while a key is being added or replaced; pasting one checks it with
 * the provider and saves it. A saved key is checked whenever the page opens, so there is nothing to test by hand.
 */
function ProviderRow({ provider, focus = false }: { provider: Provider; focus?: boolean }) {
  const hasKey = useApp((s) => s.keys[provider])
  const encrypted = useApp((s) => s.app.keyEncryption)
  // What the key is checked against: a new plan or address means checking again.
  const target = useApp((s) => (provider === 'opencode' ? s.settings.opencodePlan : s.settings.baseUrl))
  const [mode, setMode] = useState<'view' | 'edit' | 'confirm'>(() => (focus && !getState().keys[provider] ? 'edit' : 'view'))
  const [draft, setDraft] = useState('')
  const [masked, setMasked] = useState<string | null>(null)
  // The saved key's last check, and the check of a key being pasted, kept apart so a turned-down key never hides a working one.
  const [check, setCheck] = useState<KeyCheck>({ state: 'idle' })
  const [attempt, setAttempt] = useState<KeyCheck>({ state: 'idle' })
  // Only the latest check may speak; one that comes back after another started is dropped.
  const round = useRef(0)
  const slow = useLate(check.state === 'checking', 300)
  const attemptSlow = useLate(attempt.state === 'checking', 300)
  const name = t(`provider.${provider}`)

  useEffect(() => {
    if (!hasKey) {
      setMasked(null)
      return
    }
    let live = true
    void api.settings.revealApiKey(provider).then((key) => {
      if (live) setMasked(key ? maskKey(key) : null)
    })
    return () => {
      live = false
    }
  }, [hasKey, provider])

  const recheck = async () => {
    const mine = ++round.current
    setCheck({ state: 'checking' })
    const result = await api.settings.testConnection(provider)
    if (mine === round.current) setCheck({ state: 'done', result, rejected: false })
  }

  useEffect(() => {
    if (getState().keys[provider]) void recheck()
    // Checked on opening and when the plan or address changes, not when a save has just answered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  const edit = () => {
    setDraft('')
    setAttempt({ state: 'idle' })
    setMode('edit')
  }

  const save = async (value = draft) => {
    const key = value.trim()
    if (!key || attempt.state === 'checking') return
    const mine = ++round.current
    setAttempt({ state: 'checking' })
    const result = await api.settings.setApiKey(key, provider)
    if (mine !== round.current) return
    if (!result.saved) {
      setAttempt({ state: 'done', result, rejected: true })
      return
    }
    setMasked(maskKey(key))
    setCheck({ state: 'done', result, rejected: false })
    setAttempt({ state: 'idle' })
    setDraft('')
    setMode('view')
  }

  const remove = () => {
    round.current++
    setCheck({ state: 'idle' })
    setMode('view')
    void api.settings.clearApiKey(provider)
  }

  const status = keyStatus(provider, hasKey, check, { slow, encrypted, key: masked })
  const pasting = attemptStatus(provider, attempt, { slow: attemptSlow })

  return (
    <div className="oy-row">
      <div className="text">
        <p className="title">{name}</p>
        {mode === 'edit' ? (
          <>
            <div className="hx-underline hx-row-field">
              <input
                type="password"
                value={draft}
                spellCheck={false}
                autoComplete="off"
                autoFocus
                aria-label={t('settings.keyPlaceholder', { provider: name })}
                placeholder={t('settings.keyPlaceholder', { provider: name })}
                aria-invalid={pasting?.problem || undefined}
                onChange={(event) => setDraft(event.target.value)}
                onPaste={(event) => {
                  // A whole key pasted into an empty line is checked and saved at once.
                  const pasted = event.clipboardData.getData('text').trim()
                  if (!pasted || draft) return
                  event.preventDefault()
                  setDraft(pasted)
                  void save(pasted)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void save()
                  else if (event.key === 'Escape') {
                    // Leaves the line, not Settings.
                    event.preventDefault()
                    setMode('view')
                  }
                }}
              />
              {draft.trim() && attempt.state !== 'checking' && (
                <button type="button" className="hx-link" onClick={() => void save()}>
                  {t('settings.save')}
                </button>
              )}
            </div>
            <p className={`desc ${pasting?.problem ? 'hx-danger' : ''}`} aria-live="polite">
              {pasting ? (
                pasting.text
              ) : (
                <button type="button" className="hx-link" onClick={() => void api.openExternal(KEY_URLS[provider])}>
                  {t('settings.getKey')}
                  <Icon icon={ArrowUpRight} size={14} />
                </button>
              )}
            </p>
          </>
        ) : (
          <p className={`desc ${status.problem && mode === 'view' ? 'hx-danger' : ''}`} aria-live="polite">
            {mode === 'confirm' ? t('settings.removeAsk', { provider: name }) : status.text}
          </p>
        )}
      </div>
      <span className="trail hx-row-acts">
        {mode === 'edit' ? (
          <button type="button" className="hx-link" onClick={() => setMode('view')}>
            {t('common.cancel')}
          </button>
        ) : mode === 'confirm' ? (
          <>
            <button type="button" className="hx-link" onClick={() => setMode('view')}>
              {t('settings.keep')}
            </button>
            <button type="button" className="hx-link is-danger" onClick={remove}>
              {t('settings.remove')}
            </button>
          </>
        ) : (
          keyActions(hasKey, check).map((action) => (
            <button
              key={action}
              type="button"
              className="hx-link"
              onClick={action === 'retry' ? () => void recheck() : action === 'remove' ? () => setMode('confirm') : edit}
            >
              {action === 'add' && <Icon icon={Plus} size={14} />}
              {t(`settings.${action === 'add' ? 'addKey' : action}`)}
            </button>
          ))
        )}
      </span>
    </div>
  )
}

/** DeepSeek's address, changed in place on the rare day it needs to be. */
function BaseUrlRow() {
  const baseUrl = useApp((s) => s.settings.baseUrl)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(baseUrl)
  const [invalid, setInvalid] = useState(false)
  // Esc leaves the line without saving, even though leaving it also blurs it.
  const cancelled = useRef(false)
  const isDefault = baseUrl === DEFAULT_SETTINGS.baseUrl

  const start = () => {
    cancelled.current = false
    setValue(baseUrl)
    setInvalid(false)
    setEditing(true)
  }
  const commit = () => {
    if (cancelled.current) return
    const next = value.trim().replace(/\/+$/, '')
    if (next && !/^https?:\/\/\S+$/.test(next)) {
      setInvalid(true)
      return
    }
    setEditing(false)
    if (next && next !== baseUrl) update({ baseUrl: next })
  }
  const cancel = () => {
    cancelled.current = true
    setInvalid(false)
    setEditing(false)
  }

  return (
    <div className="oy-row">
      <div className="text">
        <p className="title">{t('settings.baseUrl')}</p>
        {editing ? (
          <div className="hx-underline hx-row-field">
            <input
              type="url"
              value={value}
              spellCheck={false}
              autoFocus
              aria-label={t('settings.baseUrl')}
              aria-invalid={invalid || undefined}
              onChange={(event) => {
                setValue(event.target.value)
                setInvalid(false)
              }}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commit()
                else if (event.key === 'Escape') {
                  event.preventDefault()
                  cancel()
                }
              }}
            />
          </div>
        ) : (
          <p className="desc">{isDefault ? t('settings.baseUrlHint') : baseUrl}</p>
        )}
        {invalid && <p className="desc hx-danger">{t('settings.baseUrlInvalid')}</p>}
      </div>
      {!editing && (
        <span className="trail hx-row-acts">
          {!isDefault && (
            <button type="button" className="hx-link" onClick={() => update({ baseUrl: DEFAULT_SETTINGS.baseUrl })}>
              {t('settings.baseUrlReset')}
            </button>
          )}
          <button type="button" className="hx-link" onClick={start}>
            {t('settings.baseUrlEdit')}
          </button>
        </span>
      )}
    </div>
  )
}

/** OpenCode's plan, which decides its address and its models. */
function PlanRow() {
  const plan = useApp((s) => s.settings.opencodePlan)
  return (
    <Row title={t('settings.opencodePlan')} desc={t(`settings.opencodePlan.${plan}.desc`)}>
      <Segmented<OpenCodePlan>
        label={t('settings.opencodePlan')}
        value={plan}
        options={OPENCODE_PLANS.map((p) => ({ value: p, label: t(`settings.opencodePlan.${p}`) }))}
        onChange={(opencodePlan) => update({ opencodePlan })}
      />
    </Row>
  )
}

function ModelGroup() {
  const settings = useApp((s) => s.settings)
  const keys = useApp((s) => s.keys)
  return (
    <>
      <div className="oy-section is-plain hx-settings-rows">
        <Row title={t('settings.defaultModel')} desc={t('settings.defaultModel.desc')}>
          <Select
            className="hx-row-control"
            label={t('settings.defaultModel')}
            value={settings.model}
            options={modelOptions(modelGroups(settings, keys, settings.model), true)}
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
