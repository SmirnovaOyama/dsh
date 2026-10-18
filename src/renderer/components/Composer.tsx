import { ArrowDown, ArrowUp, ChevronDown, Shield, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { CONTEXT_WINDOW, MODELS, type PermissionMode } from '../../shared/types'
import { formatTokens } from '../format'
import { t, type MessageKey } from '../i18n'
import { actions, useApp, type ChatState } from '../store'
import { Icon } from './Icon'
import { Menu, MenuItem } from './Menu'
import { PermissionPanel, permissionKey } from './PermissionPanel'
import { Reserve } from './Reserve'

const MODES: PermissionMode[] = ['ask', 'acceptEdits', 'auto']

/** Unsent text per conversation, so switching away and back keeps it. */
const drafts = new Map<string, string>()

interface ComposerProps {
  chat: ChatState | null
  showJump: boolean
  onJump(): void
  onSent(): void
}

export function Composer({ chat, showJump, onJump, onSent }: ComposerProps) {
  const draft = useApp((s) => s.draft)
  const focusTick = useApp((s) => s.focusTick)
  const key = chat?.session.id ?? 'new'
  const [text, setText] = useState(() => drafts.get(key) ?? '')
  const textRef = useRef(text)
  textRef.current = text
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const modelRef = useRef<HTMLButtonElement>(null)
  const modeRef = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState<'model' | 'mode' | null>(null)

  // Swap drafts when the conversation changes.
  const keyRef = useRef(key)
  useEffect(() => {
    if (keyRef.current === key) return
    drafts.set(keyRef.current, textRef.current)
    keyRef.current = key
    setText(drafts.get(key) ?? '')
  }, [key])

  useEffect(() => {
    areaRef.current?.focus({ preventScroll: true })
  }, [focusTick])

  const permission = chat?.permission ?? null
  const status = chat?.session.status ?? 'idle'
  const busy = status === 'running' && !permission
  const model = chat?.session.model ?? draft.model
  const mode = chat?.session.permissionMode ?? draft.permissionMode
  const usage = chat?.session.usage
  const hasText = text.trim().length > 0

  useEffect(() => {
    if (!permission) return
    const onKey = (event: KeyboardEvent) => {
      if (!event.defaultPrevented && permissionKey(event, textRef.current.trim().length > 0)) event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [permission])

  const submit = () => {
    const value = text.trim()
    if (!value || busy) return
    setText('')
    drafts.delete(key)
    onSent()
    void actions.send(value)
  }

  const showStop = busy || (!!permission && !hasText)

  return (
    <div className="hx-composer">
      <div className="hx-composer-inner">
        <button type="button" className="hx-jump" data-hidden={!showJump} tabIndex={showJump ? 0 : -1} onClick={onJump}>
          <Icon icon={ArrowDown} size={16} />
          {t('jump.latest')}
        </button>

        {permission && <PermissionPanel key={permission.id} request={permission} />}

        <div className="hx-field">
          <label htmlFor="hx-prompt" className="hx-sr">
            {t('composer.label')}
          </label>
          <textarea
            id="hx-prompt"
            ref={areaRef}
            rows={1}
            value={text}
            placeholder={t(chat ? (permission ? 'composer.placeholderWaiting' : 'composer.placeholder') : 'composer.placeholderNew')}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              const composing = event.nativeEvent.isComposing || event.keyCode === 229
              if (event.key === 'Enter' && !event.shiftKey && !composing) {
                // With a prompt open and nothing typed, Enter answers the prompt instead.
                if (permission && !hasText) return
                event.preventDefault()
                submit()
              } else if (event.key === 'Escape' && busy) {
                event.preventDefault()
                actions.stop()
              }
            }}
          />
          <div className="bar">
            <button
              ref={modelRef}
              type="button"
              className="btn-ghost"
              aria-haspopup="menu"
              aria-expanded={menu === 'model'}
              aria-label={t('composer.model', { model })}
              onClick={() => setMenu(menu === 'model' ? null : 'model')}
            >
              <span className="label">{model}</span>
              <Icon icon={ChevronDown} size={16} />
            </button>
            <button
              ref={modeRef}
              type="button"
              className="btn-ghost"
              aria-haspopup="menu"
              aria-expanded={menu === 'mode'}
              aria-label={t('composer.mode', { mode: t(`mode.${mode}`) })}
              onClick={() => setMenu(menu === 'mode' ? null : 'mode')}
            >
              <Icon icon={Shield} size={16} />
              <span className="label">{t(`mode.${mode}`)}</span>
              <Icon icon={ChevronDown} size={16} />
            </button>
            <span className="grow" />
            <span className="hx-hint">
              <span>{t('composer.hintSend')}</span>
              <span>{t('composer.hintLine')}</span>
            </span>
            <button
              type="button"
              className={`hx-send ${showStop && permission ? 'btn-secondary' : 'btn-primary'}`}
              disabled={!showStop && !hasText}
              onClick={showStop ? () => actions.stop() : submit}
            >
              <Reserve
                shown={showStop ? 1 : 0}
                forms={[
                  <>
                    <Icon icon={ArrowUp} size={16} />
                    {t('composer.send')}
                  </>,
                  <>
                    <Icon icon={Square} size={16} className="hx-fill" />
                    {t('composer.stop')}
                  </>,
                ]}
              />
            </button>
          </div>
        </div>

        <p className="hx-meta">
          <span>
            {t('composer.context')} <b>{formatTokens(usage?.contextTokens ?? 0)}</b> / {formatTokens(CONTEXT_WINDOW)} {t('composer.tokens')}
          </span>
          <span>
            {t('composer.total')} <b>{formatTokens((usage?.promptTokens ?? 0) + (usage?.completionTokens ?? 0))}</b> {t('composer.tokens')}
          </span>
        </p>
      </div>

      <Menu anchor={modelRef.current} open={menu === 'model'} onClose={() => setMenu(null)} label={t('settings.model')} side="top" minWidth={280}>
        {MODELS.map((m) => (
          <MenuItem
            key={m}
            checked={m === model}
            desc={t(`model.${m}` as MessageKey)}
            onSelect={() => {
              setMenu(null)
              void actions.configure({ model: m })
              areaRef.current?.focus()
            }}
          >
            {m}
          </MenuItem>
        ))}
      </Menu>
      <Menu anchor={modeRef.current} open={menu === 'mode'} onClose={() => setMenu(null)} label={t('settings.permissions')} side="top" minWidth={280}>
        {MODES.map((m) => (
          <MenuItem
            key={m}
            checked={m === mode}
            desc={t(`mode.${m}.desc`)}
            onSelect={() => {
              setMenu(null)
              void actions.configure({ permissionMode: m })
              areaRef.current?.focus()
            }}
          >
            {t(`mode.${m}`)}
          </MenuItem>
        ))}
      </Menu>
    </div>
  )
}
