import { ChevronRight } from 'lucide-react'
import { memo, useContext, useState } from 'react'
import type { TranscriptItem } from '../../shared/types'
import { formatSeconds } from '../format'
import { t } from '../i18n'
import { HoldScroll } from '../scroll'
import { Icon } from './Icon'

type ReasoningItem = Extract<TranscriptItem, { kind: 'reasoning' }>

export const Reasoning = memo(function Reasoning({ item, live }: { item: ReasoningItem; live: boolean }) {
  const [open, setOpen] = useState(false)
  const hold = useContext(HoldScroll)
  const label = live
    ? t('reasoning.live')
    : item.endedAt
      ? t('reasoning.done', { s: formatSeconds(Math.max(item.endedAt - item.startedAt, 1000)).replace(/\.\d$/, '') })
      : t('reasoning.doneShort')
  return (
    <div>
      <button
        type="button"
        className="hx-disclose"
        aria-expanded={open}
        onClick={() => {
          hold()
          setOpen((o) => !o)
        }}
      >
        <Icon icon={ChevronRight} size={16} className="hx-chev" />
        <span className={live ? 'live' : undefined}>{label}</span>
      </button>
      <div className={`hx-disc ${open ? 'is-open' : ''}`}>
        <div>
          <p className="hx-reason">{item.text}</p>
        </div>
      </div>
    </div>
  )
})
