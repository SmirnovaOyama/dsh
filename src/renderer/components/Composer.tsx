import { ArrowDown, ArrowUp, ChevronDown, FileText, Shield, Square, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { contextWindow, EFFORTS, MODELS, type FileRef, type PermissionMode } from '../../shared/types'
import { formatTokens } from '../format'
import { t } from '../i18n'
import { effortShort, modelDesc, modelName, modelShort } from '../models'
import { actions, useApp, type ChatState } from '../store'
import { Icon } from './Icon'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from './Menu'
import { PermissionPanel, permissionKey } from './PermissionPanel'

const MODES: PermissionMode[] = ['ask', 'acceptEdits', 'auto']

/** "session.ts 第 12–20 行": the file name, then the lines in a quieter tone. */
export function RefLabel({ fileRef: ref }: { fileRef: FileRef }) {
  const name = ref.path.slice(ref.path.lastIndexOf('/') + 1)
  const lines = !ref.start ? null : ref.start === ref.end ? t('ref.line', { a: ref.start }) : t('ref.lines', { a: ref.start, b: ref.end ?? ref.start })
  return (
    <>
      <bdi className="name">{name}</bdi>
      {lines && <span className="lines">{lines}</span>}
    </>
  )
}

/** How full the context is, as a small ring beside the model, like Claude Code's usage ring. Numbers on hover. */
function UsageRing({ used, total, spent }: { used: number; total: number; spent: number }) {
  const r = 6
  const length = 2 * Math.PI * r
  const share = total > 0 ? Math.min(1, used / total) : 0
  const label = `${t('composer.context')} ${formatTokens(used)} / ${formatTokens(total)} ${t('composer.tokens')}\n${t('composer.total')} ${formatTokens(spent)} ${t('composer.tokens')}`
  return (
    <span className="hx-usage" role="img" aria-label={label} title={label}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <circle cx="8" cy="8" r={r} className="track" />
        <circle cx="8" cy="8" r={r} className="fill" strokeDasharray={`${share * length} ${length}`} transform="rotate(-90 8 8)" />
      </svg>
    </span>
  )
}

/** Unsent text per conversation, so switching away and back keeps it. */
const drafts = new Map<string, string>()

interface ComposerProps {
  chat: ChatState | null
  showJump: boolean
  onJump(): void
  onSent(): void
}

/** `/compact` with an optional focus summarises the conversation instead of sending a message. */
const COMPACT = /^\/compact(?:\s+([\s\S]*))?$/

export function Composer({ chat, showJump, onJump, onSent }: ComposerProps) {
  const draft = useApp((s) => s.draft)
  const refs = useApp((s) => s.refs)
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
  const effort = chat?.session.effort ?? draft.effort
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
    const compact = COMPACT.exec(value)
    if (compact && chat && !permission) void actions.compact(compact[1])
    else void actions.send(value)
  }

  const showStop = busy || (!!permission && !hasText)

  return (
    <div className="hx-composer">
      <div className="hx-composer-inner">
        <button type="button" className="hx-jump" data-hidden={!showJump} tabIndex={showJump ? 0 : -1} onClick={onJump}>
          <Icon icon={ArrowDown} size={14} />
          {t('jump.latest')}
        </button>

        {permission && <PermissionPanel key={permission.id} request={permission} />}

        <div className="hx-field">
          {refs.length > 0 && (
            <ul className="hx-refs" aria-label={t('ref.label')}>
              {refs.map((ref, i) => (
                <li key={`${ref.path}:${ref.start ?? ''}-${ref.end ?? ''}`} className="hx-ref">
                  <button type="button" className="open" title={ref.path} onClick={() => actions.viewFile(ref.path)}>
                    <Icon icon={FileText} size={14} />
                    <RefLabel fileRef={ref} />
                  </button>
                  <button
                    type="button"
                    className="remove"
                    aria-label={t('ref.remove', { name: ref.path })}
                    title={t('ref.remove', { name: ref.path })}
                    onClick={() => actions.removeRef(i)}
                  >
                    <Icon icon={X} size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
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
              ref={modeRef}
              type="button"
              className="btn-ghost"
              aria-haspopup="menu"
              aria-expanded={menu === 'mode'}
              aria-label={t('composer.mode', { mode: t(`mode.${mode}`) })}
              onClick={() => setMenu(menu === 'mode' ? null : 'mode')}
            >
              <Icon icon={Shield} size={14} />
              <span className="label">{t(`mode.${mode}`)}</span>
              <Icon icon={ChevronDown} size={14} />
            </button>
            <span className="grow" />
            <button
              ref={modelRef}
              type="button"
              className="btn-ghost"
              aria-haspopup="menu"
              aria-expanded={menu === 'model'}
              aria-label={t('composer.model', { model: `${modelName(model)}, ${effortShort(effort)}` })}
              onClick={() => setMenu(menu === 'model' ? null : 'model')}
            >
              <span className="label">{modelShort(model)}</span>
              <span className="label hx-quiet">{effortShort(effort)}</span>
              <Icon icon={ChevronDown} size={14} />
            </button>
            {chat && <UsageRing used={usage?.contextTokens ?? 0} total={contextWindow(model)} spent={(usage?.promptTokens ?? 0) + (usage?.completionTokens ?? 0)} />}
            <button
              type="button"
              className={`hx-send ${showStop && permission ? 'btn-secondary' : 'btn-primary'}`}
              disabled={!showStop && !hasText}
              aria-label={t(showStop ? 'composer.stop' : 'composer.send')}
              title={t(showStop ? 'composer.stop' : 'composer.send')}
              onClick={showStop ? () => actions.stop() : submit}
            >
              {showStop ? <Icon icon={Square} size={14} className="hx-fill" /> : <Icon icon={ArrowUp} />}
            </button>
          </div>
        </div>
      </div>

      <Menu anchor={modelRef.current} open={menu === 'model'} onClose={() => setMenu(null)} label={t('settings.model')} side="top" minWidth={280}>
        {MODELS.map((m) => (
          <MenuItem
            key={m}
            checked={m === model}
            desc={modelDesc(m)}
            onSelect={() => {
              setMenu(null)
              void actions.configure({ model: m })
              areaRef.current?.focus()
            }}
          >
            {modelName(m)}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuLabel>{t('effort.label')}</MenuLabel>
        {EFFORTS.map((e) => (
          <MenuItem
            key={e}
            checked={e === effort}
            onSelect={() => {
              setMenu(null)
              void actions.configure({ effort: e })
              areaRef.current?.focus()
            }}
          >
            {t(`effort.${e}`)}
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
