import { CircleAlert } from 'lucide-react'
import { memo, useMemo } from 'react'
import type { FileChange, SessionData, TranscriptItem } from '../../shared/types'
import { clockTime } from '../format'
import { t, type MessageKey } from '../i18n'
import { actions, getState } from '../store'
import { Icon } from './Icon'
import { Markdown } from './Markdown'
import { Reasoning } from './Reasoning'
import { ToolRow, type ToolItem } from './ToolRow'

type Part = { type: 'item'; item: TranscriptItem } | { type: 'tools'; id: string; items: ToolItem[] }
type Block = { type: 'user'; item: Extract<TranscriptItem, { kind: 'user' }> } | { type: 'turn'; id: string; parts: Part[] }

/** User messages stand alone; everything the agent does after one forms a turn, with tool rows grouped. */
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
    if (item.kind === 'tool') {
      if (last?.type === 'tools') last.items.push(item)
      else turn.parts.push({ type: 'tools', id: item.id, items: [item] })
    } else {
      turn.parts.push({ type: 'item', item })
    }
  }
  return blocks
}

/** True when the agent is working but nothing on screen shows it yet. */
function needsPending(items: TranscriptItem[], status: SessionData['status']): boolean {
  if (status !== 'running') return false
  const last = items[items.length - 1]
  if (!last) return true
  if (last.kind === 'text') return !last.streaming
  if (last.kind === 'reasoning') return last.endedAt !== undefined
  if (last.kind === 'tool') return last.status !== 'running' && last.status !== 'waiting'
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

function ItemView({ item, isLast, session }: { item: TranscriptItem; isLast: boolean; session: SessionData }) {
  const idle = session.status === 'idle'
  switch (item.kind) {
    case 'reasoning':
      return <Reasoning item={item} live={!item.endedAt && !idle && isLast} />
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
              part.type === 'tools' ? (
                <div key={part.id} className="hx-tools">
                  {part.items.map((tool) => (
                    <ToolRow key={tool.id} item={tool} viewable={!!tool.path && changed.has(tool.path)} />
                  ))}
                </div>
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
