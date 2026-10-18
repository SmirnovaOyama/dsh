import { memo } from 'react'
import type { DiffLine } from '../../shared/types'

const MARK: Record<DiffLine['kind'], string> = { ctx: ' ', add: '+', del: '−', hunk: '' }
const LIMIT = 4000

export const DiffView = memo(function DiffView({ lines, label }: { lines: DiffLine[]; label: string }) {
  // A file that was created or deleted as a whole has only one side to number.
  const whole = isWhole(lines)
  const body = whole ? lines.filter((l) => l.kind !== 'hunk') : lines
  const shown = body.length > LIMIT ? body.slice(0, LIMIT) : body
  return (
    <div className={`hx-diff ${whole ? 'is-whole' : ''}`} role="table" aria-label={label}>
      {shown.map((line, i) =>
        whole ? (
          <div key={i} className="l" role="row">
            <span className="b" role="cell">
              {line.newNo ?? line.oldNo ?? ''}
            </span>
            <span role="cell">{line.text}</span>
          </div>
        ) : (
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
        ),
      )}
      {body.length > LIMIT && (
        <div className="l hunk" role="row">
          {!whole && <span />}
          {!whole && <span />}
          <span />
          <span role="cell">{`+${body.length - LIMIT}`}</span>
        </div>
      )}
    </div>
  )
})

function isWhole(lines: DiffLine[]): boolean {
  const body = lines.filter((l) => l.kind !== 'hunk')
  return body.length > 0 && (body.every((l) => l.kind === 'add') || body.every((l) => l.kind === 'del'))
}

export function DiffStatsText({ added, removed, showZero }: { added: number; removed: number; showZero?: boolean }) {
  return (
    <>
      {(added > 0 || showZero || removed === 0) && <span className="hx-plus">+{added}</span>}
      {removed > 0 && <span className="hx-minus">−{removed}</span>}
    </>
  )
}
