import { ChevronRight, CircleAlert, LoaderCircle } from 'lucide-react'
import { memo, useContext, useMemo, useState } from 'react'
import type { FileChange, SessionData, TranscriptItem } from '../../shared/types'
import { clockTime } from '../format'
import { t, type MessageKey } from '../i18n'
import { HoldScroll } from '../scroll'
import { actions, getState } from '../store'
import { Icon } from './Icon'
import { Markdown } from './Markdown'
import { ToolRow, nameFor, type ToolItem } from './ToolRow'

type ReasoningItem = Extract<TranscriptItem, { kind: 'reasoning' }>
type StepItem = ReasoningItem | ToolItem
type Part = { type: 'item'; item: TranscriptItem } | { type: 'steps'; id: string; items: StepItem[] }
type Block = { type: 'user'; item: Extract<TranscriptItem, { kind: 'user' }> } | { type: 'turn'; id: string; parts: Part[] }

/**
 * User messages stand alone; everything the agent does after one forms a turn. Thinking and tool
 * steps between two pieces of text fold into one line, so the answer is what stands out.
 */
function group(items: TranscriptItem[]): Block[] {
  const blocks: Block[] = []
  let turn: Extract<Block, { type: 'turn' }> | null = null
  for (const item of items) {
    if (item.kind === 'user') {
      blocks.push({ type: 'user', item })
      turn = null
      continue
    }
    if (!turn) {
      turn = { type: 'turn', id: item.id, parts: [] }
      blocks.push(turn)
    }
    const last = turn.parts[turn.parts.length - 1]
    if (item.kind === 'tool' || item.kind === 'reasoning') {
      if (last?.type === 'steps') last.items.push(item)
      else turn.parts.push({ type: 'steps', id: item.id, items: [item] })
    } else {
      turn.parts.push({ type: 'item', item })
    }
  }
  return blocks
}

function isLive(item: StepItem): boolean {
  return item.kind === 'reasoning' ? item.endedAt === undefined : item.status === 'running' || item.status === 'waiting'
}

/** True when the agent is working but nothing on screen shows it yet. */
function needsPending(items: TranscriptItem[], status: SessionData['status']): boolean {
  if (status !== 'running') return false
  const last = items[items.length - 1]
  if (!last) return true
  if (last.kind === 'text') return !last.streaming
  if (last.kind === 'reasoning') return last.endedAt !== undefined
  if (last.kind === 'tool') return last.status !== 'running' && last.status !== 'waiting'
  if (last.kind === 'compact') return true
  return last.kind === 'user'
}

const UserMessage = memo(function UserMessage({ item }: { item: Extract<TranscriptItem, { kind: 'user' }> }) {
  return (
    <div className="hx-user">
      <p className="body">{item.text}</p>
      <span className="time">{clockTime(item.at)}</span>
    </div>
  )
})

const SETTINGS_ERRORS = new Set(['no-key', 'auth', 'bad-request'])

function ErrorBlock({ item, active }: { item: Extract<TranscriptItem, { kind: 'error' }>; active: boolean }) {
  const code = item.code
  return (
    <div className="hx-error" role="alert">
      <Icon icon={CircleAlert} size={18} />
      <div className="text">
        <p className="title">{t(`error.${code}.title` as MessageKey)}</p>
        <p className="body">{t(`error.${code}.body` as MessageKey)}</p>
        {item.detail && code !== 'no-key' && <p className="detail">{item.detail}</p>}
        {active && (
          <div className="acts">
            {SETTINGS_ERRORS.has(code) && (
              <button type="button" className="btn-tonal" onClick={() => actions.openSettings('connection')}>
                {t(code === 'bad-request' ? 'error.checkSettings' : 'error.openSettings')}
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={() => actions.retry()}>
              {t('error.retry')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Notice({ item, active }: { item: Extract<TranscriptItem, { kind: 'notice' }>; active: boolean }) {
  if (item.code === 'stopped') return <p className="hx-notice">{t('notice.stopped')}</p>
  return (
    <div className="hx-notice">
      <span>{t('notice.max-steps', { n: getState().settings.maxSteps })}</span>
      {active && (
        <button type="button" className="btn-ghost is-accent" onClick={() => actions.retry()}>
          {t('notice.continue')}
        </button>
      )}
    </div>
  )
}

const READS = new Set(['read_file'])
const SEARCHES = new Set(['list_dir', 'find_files', 'search_files'])
const EDITS = new Set(['edit_file', 'write_file'])

function count(key: string, n: number): string | null {
  if (!n) return null
  return t((n === 1 ? `${key}.one` : key) as MessageKey, { n })
}

/** "執行了 2 個指令，改了 1 個檔案" for finished steps; the current step while they run. */
function stepsLabel(items: StepItem[]): string {
  const tools = items.filter((i): i is ToolItem => i.kind === 'tool')
  const parts = [
    count('steps.commands', tools.filter((i) => i.name === 'run_command').length),
    count('steps.edits', new Set(tools.filter((i) => EDITS.has(i.name)).map((i) => i.path ?? i.target)).size),
    count('steps.reads', tools.filter((i) => READS.has(i.name)).length),
    count('steps.searches', tools.filter((i) => SEARCHES.has(i.name)).length),
    count('steps.others', tools.filter((i) => !READS.has(i.name) && !SEARCHES.has(i.name) && !EDITS.has(i.name) && i.name !== 'run_command').length),
    count('steps.failed', tools.filter((i) => i.status === 'error').length),
  ].filter((p): p is string => p !== null)
  const joined = parts.join(t('steps.sep'))
  if (joined) return joined.charAt(0).toUpperCase() + joined.slice(1)
  const thought = items.reduce((ms, i) => (i.kind === 'reasoning' && i.endedAt ? ms + i.endedAt - i.startedAt : ms), 0)
  return t('reasoning.done', { s: Math.max(1, Math.round(thought / 1000)) })
}

function liveLabel(item: StepItem): string {
  if (item.kind === 'reasoning') return t('reasoning.live')
  if (item.status === 'waiting') return t('steps.waiting', { action: `${nameFor(item)} ${item.target}` })
  return `${nameFor(item)} ${item.target}`
}

const Steps = memo(function Steps({ items, live, changed }: { items: StepItem[]; live: boolean; changed: Set<string> }) {
  const [open, setOpen] = useState(false)
  const [rendered, setRendered] = useState(false)
  const hold = useContext(HoldScroll)
  const current = items[items.length - 1]
  const label = live ? liveLabel(current) : stepsLabel(items)
  const rows: Array<{ type: 'reasoning'; item: ReasoningItem } | { type: 'tools'; id: string; items: ToolItem[] }> = []
  for (const item of items) {
    const last = rows[rows.length - 1]
    if (item.kind === 'reasoning') rows.push({ type: 'reasoning', item })
    else if (last?.type === 'tools') last.items.push(item)
    else rows.push({ type: 'tools', id: item.id, items: [item] })
  }
  return (
    <div className="hx-steps">
      <button
        type="button"
        className="hx-disclose"
        aria-expanded={open}
        onClick={() => {
          hold()
          setRendered(true)
          setOpen((o) => !o)
        }}
      >
        <Icon icon={ChevronRight} size={16} className="hx-chev" />
        {live && current.kind === 'tool' && current.status === 'running' && <Icon icon={LoaderCircle} size={14} className="hx-spin" />}
        <span className={live ? 'label live' : 'label'}>{label}</span>
      </button>
      <div className={`hx-disc ${open ? 'is-open' : ''}`}>
        <div>
          {rendered && (
            <div className="hx-steps-body">
              {rows.map((row) =>
                row.type === 'reasoning' ? (
                  row.item.text && (
                    <p key={row.item.id} className="hx-step-thought">
                      {row.item.text}
                    </p>
                  )
                ) : (
                  <div key={row.id} className="hx-tools">
                    {row.items.map((tool) => (
                      <ToolRow key={tool.id} item={tool} viewable={!!tool.path && changed.has(tool.path)} />
                    ))}
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

function ItemView({ item, isLast, session }: { item: TranscriptItem; isLast: boolean; session: SessionData }) {
  const idle = session.status === 'idle'
  switch (item.kind) {
    case 'text':
      return item.text ? <Markdown text={item.text} streaming={item.streaming && !idle} /> : null
    case 'error':
      return <ErrorBlock item={item} active={isLast && idle} />
    case 'notice':
      return <Notice item={item} active={isLast && idle} />
    default:
      return null
  }
}

export function Transcript({ session, changes }: { session: SessionData; changes: FileChange[] }) {
  const blocks = useMemo(() => group(session.items), [session.items])
  const lastId = session.items[session.items.length - 1]?.id
  const changed = useMemo(() => new Set(changes.map((c) => c.path)), [changes])
  const pending = needsPending(session.items, session.status)
  const lastIsUser = blocks[blocks.length - 1]?.type === 'user' || blocks.length === 0

  return (
    <>
      {blocks.map((block, index) =>
        block.type === 'user' ? (
          <UserMessage key={block.item.id} item={block.item} />
        ) : (
          <section key={block.id} className="hx-turn" aria-label={t('turn.label')}>
            {block.parts.map((part) =>
              part.type === 'steps' ? (
                <Steps
                  key={part.id}
                  items={part.items}
                  live={session.status !== 'idle' && part.items[part.items.length - 1].id === lastId && isLive(part.items[part.items.length - 1])}
                  changed={changed}
                />
              ) : (
                <ItemView key={part.item.id} item={part.item} isLast={part.item.id === lastId} session={session} />
              ),
            )}
            {pending && index === blocks.length - 1 && <p className="hx-pending" aria-hidden="true" />}
          </section>
        ),
      )}
      {pending && lastIsUser && (
        <section className="hx-turn">
          <p className="hx-pending" aria-hidden="true" />
        </section>
      )}
    </>
  )
}
