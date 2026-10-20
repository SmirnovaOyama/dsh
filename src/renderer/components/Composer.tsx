import { ArrowDown, ArrowUp, ChevronDown, ClipboardList, FileText, Shield, Square, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { contextWindow, EFFORTS, MODELS, PERMISSION_MODES, type FileRef } from '../../shared/types'
import { formatTokens } from '../format'
import { t, type MessageKey } from '../i18n'
import { effortShort, modelDesc, modelName, modelShort } from '../models'
import { actions, useApp, type ChatState } from '../store'
import { filterCommands, filterFiles, findTrigger, type CommandEntry, type Trigger } from '../suggest'
import { Icon } from './Icon'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from './Menu'
import { PermissionPanel, permissionKey } from './PermissionPanel'
import { Queue } from './Queue'
import { Suggestions, type Suggestion } from './Suggestions'
import { TodoPanel } from './Todos'

const MODES = PERMISSION_MODES

/** The app's own commands, in the order the menu lists them. */
const BUILT_INS: Array<Omit<CommandEntry, 'description'>> = [
  { name: 'compact', kind: 'action' },
  { name: 'clear', kind: 'action' },
  { name: 'init', kind: 'prompt' },
  { name: 'review', kind: 'prompt' },
  { name: 'plan', kind: 'action' },
  { name: 'model', kind: 'action' },
  { name: 'rewind', kind: 'action' },
]

/** Two presses of Esc this close together on an empty composer open the rewind list. */
const DOUBLE_ESC_MS = 500

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

/** `/name rest` at the start of a message. */
const COMMAND = /^\/([\w.-]+)(?:\s+([\s\S]*))?$/

export function Composer({ chat, showJump, onJump, onSent }: ComposerProps) {
  const draft = useApp((s) => s.draft)
  const refs = useApp((s) => s.refs)
  const focusTick = useApp((s) => s.focusTick)
  const fill = useApp((s) => s.fill)
  const custom = useApp((s) => s.commands)
  const files = useApp((s) => s.files)
  const key = chat?.session.id ?? 'new'
  const [text, setText] = useState(() => drafts.get(key) ?? '')
  const textRef = useRef(text)
  textRef.current = text
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const modelRef = useRef<HTMLButtonElement>(null)
  const modeRef = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState<'model' | 'mode' | null>(null)
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)
  /** Where a suggestion list was closed with Esc, so it stays closed until the trigger changes. */
  const [dismissed, setDismissed] = useState<number | null>(null)
  const lastEsc = useRef(0)

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

  // Text handed over from elsewhere, such as a message taken back by rewinding or stopping.
  useEffect(() => {
    if (!fill) return
    const next = fill.append && textRef.current.trim() ? `${textRef.current.trimEnd()}\n\n${fill.text}` : fill.text
    setText(next)
    requestAnimationFrame(() => {
      const area = areaRef.current
      if (!area) return
      area.focus({ preventScroll: true })
      area.setSelectionRange(next.length, next.length)
      setCaret(next.length)
    })
  }, [fill])

  const permission = chat?.permission ?? null
  const status = chat?.session.status ?? 'idle'
  const busy = status === 'running' && !permission
  const model = chat?.session.model ?? draft.model
  const effort = chat?.session.effort ?? draft.effort
  const mode = chat?.session.permissionMode ?? draft.permissionMode
  const usage = chat?.session.usage
  const hasText = text.trim().length > 0
  const running = status !== 'idle'

  const commands = useMemo<CommandEntry[]>(
    () => [
      ...BUILT_INS.map((c) => ({
        ...c,
        description: t(`slash.${c.name}` as MessageKey),
      })),
      ...custom.map((c) => ({ ...c, kind: 'prompt' as const, custom: true })),
    ],
    [custom],
  )

  const trigger: Trigger | null = useMemo(() => {
    const found = findTrigger(text, caret)
    return found && found.start !== dismissed ? found : null
  }, [text, caret, dismissed])

  useEffect(() => {
    if (trigger?.kind === 'file') void actions.loadFiles()
  }, [trigger?.kind])

  const suggestions: Suggestion[] = useMemo(() => {
    if (!trigger) return []
    if (trigger.kind === 'slash') {
      return filterCommands(commands, trigger.query).map((c) => ({
        id: `/${c.name}`,
        label: `/${c.name}`,
        hint: c.hint,
        detail: c.description,
        tag: c.custom ? t('slash.custom') : undefined,
      }))
    }
    return filterFiles(files ?? [], trigger.query).map((path) => {
      const slash = path.lastIndexOf('/')
      return { id: path, label: path.slice(slash + 1), detail: slash > 0 ? path.slice(0, slash) : undefined, file: true }
    })
  }, [trigger, commands, files])

  const showSuggest = !!trigger && suggestions.length > 0 && !menu
  const activeIndex = Math.min(active, Math.max(suggestions.length - 1, 0))
  useEffect(() => setActive(0), [trigger?.kind, trigger?.query])

  const setTextAndCaret = (next: string, at: number) => {
    setText(next)
    setCaret(at)
    requestAnimationFrame(() => areaRef.current?.setSelectionRange(at, at))
  }

  /** Runs a slash command. Returns false when the text should be sent as a message instead. */
  const runCommand = (name: string, rest: string): boolean => {
    switch (name) {
      case 'compact':
        if (!chat || permission || running) return false
        void actions.compact(rest || undefined)
        return true
      case 'clear':
        actions.newChat()
        return true
      case 'model':
        setMenu('model')
        return true
      case 'rewind':
        if (!chat || running) return true
        actions.openRewind()
        return true
      case 'plan':
        void actions.configure({ permissionMode: 'plan' })
        if (rest) void actions.send(rest)
        return true
      default:
        return false
    }
  }

  const pick = (index: number, complete: boolean) => {
    const item = suggestions[index]
    if (!item || !trigger) return
    if (trigger.kind === 'file') {
      actions.addRef({ path: item.id })
      const before = text.slice(0, trigger.start)
      const after = text.slice(trigger.end).replace(/^ /, '')
      setTextAndCaret(before + after, before.length)
      return
    }
    const name = item.id.slice(1)
    const entry = commands.find((c) => c.name === name)
    if (complete || name === 'compact' || name === 'plan') {
      // Tab, and commands that take words after them, leave room to type those first.
      const next = `/${name} ${text.slice(trigger.end).trimStart()}`
      setTextAndCaret(next, name.length + 2)
      return
    }
    setText('')
    drafts.delete(key)
    if (entry?.kind === 'action') runCommand(name, '')
    else send(`/${name}`)
  }

  const send = (value: string) => {
    onSent()
    void actions.send(value)
  }

  // Covered by a page such as the library, the prompt is out of sight, so Enter and Esc leave it alone.
  const covered = useApp((s) => s.view !== 'chat')
  useEffect(() => {
    if (!permission || covered) return
    const onKey = (event: KeyboardEvent) => {
      if (!event.defaultPrevented && permissionKey(event, textRef.current.trim().length > 0)) event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [permission, covered])

  const submit = () => {
    const value = text.trim()
    if (!value) return
    const command = COMMAND.exec(value)
    if (command && BUILT_INS.some((c) => c.name === command[1] && c.kind === 'action')) {
      if (!runCommand(command[1], (command[2] ?? '').trim())) return
      setText('')
      drafts.delete(key)
      return
    }
    setText('')
    drafts.delete(key)
    send(value)
  }

  const cycleMode = () => {
    const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length]
    void actions.configure({ permissionMode: next })
  }

  const showStop = (busy && !hasText) || (!!permission && !hasText)
  const ModeIcon = mode === 'plan' ? ClipboardList : Shield

  return (
    <div className="hx-composer">
      <div className="hx-composer-inner">
        <button type="button" className="hx-jump" data-hidden={!showJump} tabIndex={showJump ? 0 : -1} onClick={onJump}>
          <Icon icon={ArrowDown} size={14} />
          {t('jump.latest')}
        </button>

        {chat?.session.todos && <TodoPanel todos={chat.session.todos} running={running} />}

        {permission && <PermissionPanel key={permission.id} request={permission} />}

        {chat && chat.queue.length > 0 && <Queue queue={chat.queue} />}

        <div className="hx-field">
          {showSuggest && (
            <Suggestions
              id="hx-suggest"
              label={t(trigger.kind === 'slash' ? 'slash.label' : 'mention.label')}
              items={suggestions}
              active={activeIndex}
              onHover={setActive}
              onPick={(i) => pick(i, false)}
            />
          )}
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
            role="combobox"
            aria-expanded={showSuggest}
            aria-controls={showSuggest ? 'hx-suggest' : undefined}
            aria-activedescendant={showSuggest ? `hx-suggest-${activeIndex}` : undefined}
            aria-autocomplete="list"
            placeholder={t(
              !chat
                ? 'composer.placeholderNew'
                : permission
                  ? 'composer.placeholderWaiting'
                  : busy
                    ? 'composer.placeholderBusy'
                    : 'composer.placeholder',
            )}
            onChange={(event) => {
              setText(event.target.value)
              setCaret(event.target.selectionStart)
              if (dismissed !== null && findTrigger(event.target.value, event.target.selectionStart)?.start !== dismissed) setDismissed(null)
            }}
            onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
            onBlur={() => setActive(0)}
            onKeyDown={(event) => {
              const composing = event.nativeEvent.isComposing || event.keyCode === 229
              if (showSuggest && !composing) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  const step = event.key === 'ArrowDown' ? 1 : -1
                  setActive((activeIndex + step + suggestions.length) % suggestions.length)
                  return
                }
                if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
                  event.preventDefault()
                  pick(activeIndex, event.key === 'Tab')
                  return
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  setDismissed(trigger.start)
                  return
                }
              }
              if (event.key === 'Tab' && event.shiftKey && !composing) {
                // Shift+Tab steps through the permission modes, as in Claude Code.
                event.preventDefault()
                cycleMode()
                return
              }
              if (event.key === 'Escape' && !busy && !permission && !text && chat && !running) {
                const now = performance.now()
                if (now - lastEsc.current < DOUBLE_ESC_MS) {
                  lastEsc.current = 0
                  actions.openRewind()
                } else lastEsc.current = now
                return
              }
              if (event.key === 'Enter' && !event.shiftKey && !composing) {
                // With a prompt open and nothing typed, Enter answers the prompt instead.
                if (permission && !hasText) return
                event.preventDefault()
                submit()
              } else if (event.key === 'Escape' && busy) {
                event.preventDefault()
                void actions.stop()
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
              title={t('composer.modeHint')}
              onClick={() => setMenu(menu === 'mode' ? null : 'mode')}
            >
              <Icon icon={ModeIcon} size={14} />
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
              onClick={showStop ? () => void actions.stop() : submit}
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
