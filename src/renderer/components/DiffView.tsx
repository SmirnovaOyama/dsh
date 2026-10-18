import { memo } from 'react'
import type { DiffLine } from '../../shared/types'

const MARK: Record<DiffLine['kind'], string> = { ctx: ' ', add: '+', del: '−', hunk: '' }
const LIMIT = 4000

export const DiffView = memo(function DiffView({ lines, label }: { lines: DiffLine[]; label: string }) {
  const shown = lines.length > LIMIT ? lines.slice(0, LIMIT) : lines
  return (
    <div className="hx-diff" role="table" aria-label={label}>
      {shown.map((line, i) => (
        <div key={i} className={`l ${line.kind === 'ctx' ? '' : line.kind}`} role="row">
          <span className="a" role="cell">
            {line.oldNo ?? ''}
          </span>
          <span className="b" role="cell">
            {line.newNo ?? ''}
          </span>
          <span className="m" role="cell">
            {MARK[line.kind]}
          </span>
          <span role="cell">{line.text}</span>
        </div>
      ))}
      {lines.length > LIMIT && (
        <div className="l hunk" role="row">
          <span />
          <span />
          <span />
          <span role="cell">{`+${lines.length - LIMIT}`}</span>
        </div>
      )}
    </div>
  )
})

export function DiffStatsText({ added, removed, showZero }: { added: number; removed: number; showZero?: boolean }) {
  return (
    <>
      {(added > 0 || showZero || removed === 0) && <span className="hx-plus">+{added}</span>}
      {removed > 0 && <span className="hx-minus">−{removed}</span>}
    </>
  )
}
