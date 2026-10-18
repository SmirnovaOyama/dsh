import {
  ChevronRight,
  FilePen,
  FilePlus,
  FileText,
  FolderSearch,
  List,
  LoaderCircle,
  Search,
  Terminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { memo, useContext, useState, type ReactNode } from 'react'
import type { TranscriptItem } from '../../shared/types'
import { formatSeconds } from '../format'
import { t, type MessageKey } from '../i18n'
import { HoldScroll } from '../scroll'
import { actions } from '../store'
import { OutputBlock } from './CodeBlock'
import { DiffStatsText } from './DiffView'
import { Icon } from './Icon'

export type ToolItem = Extract<TranscriptItem, { kind: 'tool' }>

const ICONS: Record<string, LucideIcon> = {
  read_file: FileText,
  list_dir: List,
  find_files: FolderSearch,
  search_files: Search,
  edit_file: FilePen,
  run_command: Terminal,
}

function iconFor(item: ToolItem): LucideIcon {
  if (item.name === 'write_file') return item.created ? FilePlus : FilePen
  return ICONS[item.name] ?? Wrench
}

export function nameFor(item: ToolItem): string {
  if (item.name === 'write_file') return t(item.created ? 'tool.write_file.create' : 'tool.write_file')
  const key = `tool.${item.name}` as MessageKey
  return ICONS[item.name] ? t(key) : t('tool.unknown')
}

const changesFile = (item: ToolItem) => item.name === 'edit_file' || item.name === 'write_file'

/** The short result at the end of the row, such as "142 行" or "+8 −3". */
function resultFor(item: ToolItem): ReactNode {
  const info = item.info ?? {}
  if (changesFile(item) && item.stats) return <DiffStatsText added={item.stats.added} removed={item.stats.removed} />
  switch (item.name) {
    case 'read_file':
      return info.lines !== undefined ? <span className="hx-muted">{t('tool.v.lines', { n: info.lines })}</span> : null
    case 'list_dir':
      return info.files !== undefined ? <span className="hx-muted">{t('tool.v.entries', { n: info.files })}</span> : null
    case 'find_files':
      return info.files !== undefined ? <span className="hx-muted">{t('tool.v.files', { n: info.files })}</span> : null
    case 'search_files':
      return info.matches !== undefined ? <span className="hx-muted">{t('tool.v.matches', { n: info.matches })}</span> : null
    default:
      return <span className="hx-muted">{t('tool.status.done')}</span>
  }
}

function StatusText({ item }: { item: ToolItem }) {
  switch (item.status) {
    case 'running':
      return (
        <span className="stat hx-muted">
          <Icon icon={LoaderCircle} size={16} className="hx-spin" />
          {t('tool.status.running')}
        </span>
      )
    case 'waiting':
      return <span className="stat is-waiting">{t('tool.status.waiting')}</span>
    case 'error':
      return <span className="stat hx-danger">{t('tool.status.error')}</span>
    case 'denied':
      return <span className="stat hx-muted">{t('tool.status.denied')}</span>
    case 'stopped':
      return <span className="stat hx-muted">{t('tool.status.stopped')}</span>
    default:
      return <span className="stat">{resultFor(item)}</span>
  }
}

const STATUS_CLASS: Record<ToolItem['status'], string> = {
  running: 'hx-muted',
  waiting: 'hx-warning',
  done: 'hx-positive',
  error: 'hx-danger',
  denied: 'hx-muted',
  stopped: 'hx-muted',
}

function Detail({ item }: { item: ToolItem }) {
  const info = item.info ?? {}
  const took = item.startedAt && item.endedAt ? item.endedAt - item.startedAt : null
  const output = item.name === 'read_file' ? '' : (item.output ?? '')
  return (
    <div className="hx-tool-detail">
      {item.error && <p className="hx-danger-line">{item.error}</p>}
      <p className="hx-kv">
        <span>
          <span className="k">{t('tool.k.status')}</span>
          <span className={STATUS_CLASS[item.status]}>{t(`tool.status.${item.status}` as MessageKey)}</span>
        </span>
        {info.lines !== undefined && item.name === 'read_file' && (
          <span>
            <span className="k">{t('tool.k.lines')}</span>
            <span className="hx-tabular">{t('tool.v.lines', { n: info.lines })}</span>
          </span>
        )}
        {(info.matches !== undefined || (info.files !== undefined && item.name !== 'read_file')) && (
          <span>
            <span className="k">{t('tool.k.found')}</span>
            <span className="hx-tabular">
              {info.matches !== undefined
                ? t('tool.v.matches', { n: info.matches })
                : t(item.name === 'list_dir' ? 'tool.v.entries' : 'tool.v.files', { n: info.files ?? 0 })}
            </span>
          </span>
        )}
        {info.exitCode !== undefined && info.exitCode !== null && (
          <span>
            <span className="k">{t('tool.k.exit')}</span>
            <span className="hx-tabular">{info.exitCode}</span>
          </span>
        )}
        {took !== null && (
          <span>
            <span className="k">{t('tool.k.time')}</span>
            <span className="hx-tabular">{t('tool.v.seconds', { s: formatSeconds(took) })}</span>
          </span>
        )}
      </p>
      {output && <OutputBlock text={output} />}
      {info.truncated && <p className="hx-kv hx-muted">{t('tool.v.truncated')}</p>}
    </div>
  )
}

export const ToolRow = memo(function ToolRow({ item, viewable }: { item: ToolItem; viewable: boolean }) {
  const [open, setOpen] = useState(false)
  // Details render once first opened, then stay so closing can animate.
  const [rendered, setRendered] = useState(false)
  const hold = useContext(HoldScroll)
  const row = (
    <>
      <Icon icon={iconFor(item)} size={16} />
      <span className="name">{nameFor(item)}</span>
      <span className="arg" title={item.target}>
        {item.target}
      </span>
      <StatusText item={item} />
    </>
  )

  // A finished edit opens the file in the changes panel instead of expanding.
  if (changesFile(item) && item.status === 'done' && item.path) {
    if (!viewable)
      return (
        <div className="hx-tool">
          {row}
          <span className="hx-chev-space" />
        </div>
      )
    return (
      <button type="button" className="hx-tool" aria-label={t('tool.view', { path: item.path })} onClick={() => actions.selectFile(item.path!)}>
        {row}
        <span className="hx-chev-space" />
      </button>
    )
  }

  const expandable = !(changesFile(item) && !item.error)
  if (!expandable)
    return (
      <div className="hx-tool">
        {row}
        <span className="hx-chev-space" />
      </div>
    )
  return (
    <>
      <button
        type="button"
        className="hx-tool"
        aria-expanded={open}
        onClick={() => {
          hold()
          setRendered(true)
          setOpen((o) => !o)
        }}
      >
        {row}
        <Icon icon={ChevronRight} size={16} className="hx-chev" />
      </button>
      <div className={`hx-disc ${open ? 'is-open' : ''}`}>
        <div>{rendered ? <Detail item={item} /> : null}</div>
      </div>
    </>
  )
})
