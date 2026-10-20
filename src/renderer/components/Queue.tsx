import { X } from 'lucide-react'
import type { QueuedMessage } from '../../shared/types'
import { t } from '../i18n'
import { actions } from '../store'
import { Icon } from './Icon'

/** Messages typed while the agent works. Each goes in at the agent's next step, or can be taken back. */
export function Queue({ queue }: { queue: QueuedMessage[] }) {
  return (
    <ul className="hx-queue" aria-label={t('queue.label')}>
      {queue.map((message) => (
        <li key={message.id}>
          <span className="when">{t('queue.next')}</span>
          <span className="text" title={message.text}>
            {message.text}
          </span>
          <button
            type="button"
            className="remove"
            aria-label={t('queue.remove')}
            title={t('queue.remove')}
            onClick={() => void actions.unqueue(message.id)}
          >
            <Icon icon={X} size={14} />
          </button>
        </li>
      ))}
    </ul>
  )
}
