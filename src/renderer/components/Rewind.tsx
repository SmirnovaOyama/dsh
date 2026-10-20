import { useEffect, useState } from 'react'
import type { RewindMode, TranscriptItem } from '../../shared/types'
import { clockTime } from '../format'
import { t, type MessageKey } from '../i18n'
import { actions, useApp } from '../store'
import { Modal } from './Modal'

type UserItem = Extract<TranscriptItem, { kind: 'user' }>

const MODES: RewindMode[] = ['both', 'conversation', 'code']

/**
 * Goes back to just before one of the person's messages, as Claude Code's rewind does: the
 * conversation, the files the agent changed since, or both. Opened from a message, from /rewind,
 * or with Esc twice in an empty composer, which first lists the messages to pick from.
 */
export function RewindDialog() {
  const rewindFor = useApp((s) => s.rewindFor)
  const items = useApp((s) => s.chat?.session.items)
  const [picked, setPicked] = useState<string | null>(null)
  const [mode, setMode] = useState<RewindMode>('both')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setPicked(rewindFor || null)
    setMode('both')
    setError(null)
  }, [rewindFor])

  const users = (items ?? []).filter((item): item is UserItem => item.kind === 'user')
  const target = users.find((item) => item.id === picked)
  const conversationLocked = !!target?.compacted
  const chosen = conversationLocked ? 'code' : mode
  const open = rewindFor !== null && (target !== undefined || (!picked && users.length > 0))

  const confirm = async () => {
    if (!target) return
    setBusy(true)
    const result = await actions.rewind(target.id, chosen)
    setBusy(false)
    if (result.ok) actions.closeRewind()
    else setError(t(result.error === 'compacted' ? 'rewind.errorCompacted' : 'rewind.error'))
  }

  if (!open) return null
  if (!target) {
    return (
      <Modal
        open
        onClose={() => actions.closeRewind()}
        title={t('rewind.pickTitle')}
        body={t('rewind.pickBody')}
        actions={
          <button type="button" className="btn-secondary" onClick={() => actions.closeRewind()}>
            {t('common.cancel')}
          </button>
        }
      >
        <ul className="hx-rewind-list">
          {[...users].reverse().map((item, i) => (
            <li key={item.id}>
              <button type="button" data-autofocus={i === 0 ? true : undefined} onClick={() => setPicked(item.id)}>
                <span className="text">{item.text}</span>
                <span className="time">{clockTime(item.at)}</span>
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    )
  }

  return (
    <Modal
      open
      onClose={() => actions.closeRewind()}
      title={t('rewind.title')}
      actions={
        <>
          <button type="button" className="btn-secondary" onClick={() => actions.closeRewind()}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn-primary" data-autofocus disabled={busy} onClick={() => void confirm()}>
            {t('rewind.confirm')}
          </button>
        </>
      }
    >
      <blockquote className="hx-rewind-quote">{target.text}</blockquote>
      <div className="hx-rewind-modes" role="radiogroup" aria-label={t('rewind.what')}>
        {MODES.map((m) => {
          const disabled = conversationLocked && m !== 'code'
          return (
            <label key={m} className={disabled ? 'is-disabled' : undefined}>
              <input type="radio" name="rewind-mode" value={m} checked={chosen === m} disabled={disabled} onChange={() => setMode(m)} />
              <span className="text">
                <span className="name">{t(`rewind.${m}` as MessageKey)}</span>
                <span className="desc">{t(`rewind.${m}.desc` as MessageKey)}</span>
              </span>
            </label>
          )
        })}
      </div>
      {conversationLocked && <p className="hx-rewind-note">{t('rewind.compacted')}</p>}
      <p className="hx-rewind-note">{t('rewind.commandsNote')}</p>
      {error && <p className="hx-rewind-note hx-danger">{error}</p>}
    </Modal>
  )
}
