import { Clock, Ellipsis, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { MODELS, PERMISSION_MODES, SCHEDULE_KINDS, type Locale, type Schedule, type ScheduledTask, type ScheduledTaskInput } from '../../shared/types'
import { clockTime } from '../format'
import { t, type MessageKey } from '../i18n'
import { modelName } from '../models'
import { actions, projectPaths, useApp } from '../store'
import { Icon } from './Icon'
import { Menu, MenuItem } from './Menu'
import { Modal } from './Modal'
import { PageHead } from './PageHead'
import { Select } from './Select'

const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path
const pad = (n: number) => String(n).padStart(2, '0')

function weekdayName(day: number, locale: Locale): string {
  // 2023-01-01 was a Sunday.
  return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2023, 0, 1 + day))
}

export function describeSchedule(schedule: Schedule, locale: Locale): string {
  const time = `${pad(schedule.hour)}:${pad(schedule.minute)}`
  return t(`schedule.desc.${schedule.kind}` as MessageKey, { time, minute: pad(schedule.minute), weekday: weekdayName(schedule.weekday, locale) })
}

/** "Today 09:00", "Tomorrow 09:00", or the date and time. */
export function describeWhen(ts: number, now: number, locale: Locale): string {
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)
  const start = day.getTime()
  const time = clockTime(ts)
  if (ts >= start && ts < start + 86_400_000) return t('when.today', { time })
  if (ts >= start + 86_400_000 && ts < start + 2 * 86_400_000) return t('when.tomorrow', { time })
  return `${new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' }).format(ts)} ${time}`
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

export function ScheduledView() {
  const tasks = useApp((s) => s.schedules)
  const [editing, setEditing] = useState<ScheduledTask | 'new' | null>(null)
  const [removing, setRemoving] = useState<ScheduledTask | null>(null)
  const now = useNow()

  return (
    <main className="hx-main">
      <PageHead title={t('scheduled.title')} sub={t('scheduled.intro')}>
        <button type="button" className="btn-secondary hx-page-btn" onClick={() => setEditing('new')}>
          <Icon icon={Plus} size={16} />
          {t('scheduled.new')}
        </button>
      </PageHead>
      <div className="hx-page-list">
        {tasks && tasks.length === 0 && (
          <div className="hx-page-empty">
            <Icon icon={Clock} size={20} />
            <p>{t('scheduled.empty')}</p>
          </div>
        )}
        {tasks && tasks.length > 0 && (
          <ul className="hx-sched-list">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} now={now} onEdit={() => setEditing(task)} onRemove={() => setRemoving(task)} />
            ))}
          </ul>
        )}
      </div>
      {editing && <TaskEditor task={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t('scheduled.removeTitle', { name: removing?.name ?? '' })}
        body={t('scheduled.removeBody')}
        actions={
          <>
            <button type="button" className="btn-secondary" data-autofocus onClick={() => setRemoving(null)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => {
                if (removing) void actions.removeSchedule(removing.id)
                setRemoving(null)
              }}
            >
              {t('scheduled.remove')}
            </button>
          </>
        }
      />
    </main>
  )
}

function LastRun({ task, now }: { task: ScheduledTask; now: number }) {
  const locale = useApp((s) => s.settings.locale)
  const meta = useApp((s) => (task.lastRun?.sessionId ? s.sessions.find((m) => m.id === task.lastRun?.sessionId) : undefined))
  const run = task.lastRun
  if (!run) return <span>{t('scheduled.never')}</span>
  const when = t('scheduled.last', { when: describeWhen(run.at, now, locale) })
  if (run.error) {
    const key = `scheduled.failed.${run.error}` as MessageKey
    const known = run.error === 'no-key' || run.error === 'no-folder'
    return (
      <span>
        {when} <span className="is-error">{known ? t(key) : t('scheduled.failed')}</span>
      </span>
    )
  }
  const status = meta?.status === 'running' ? t('scheduled.running') : meta?.status === 'waiting' ? t('scheduled.waiting') : t('scheduled.done')
  return (
    <span>
      {when} <span className={meta?.status === 'waiting' ? 'is-waiting' : undefined}>{status}</span>
      {run.sessionId && (
        <button type="button" className="hx-link" onClick={() => void actions.openSession(run.sessionId!)}>
          {t('scheduled.open')}
        </button>
      )}
    </span>
  )
}

function TaskRow({ task, now, onEdit, onRemove }: { task: ScheduledTask; now: number; onEdit(): void; onRemove(): void }) {
  const locale = useApp((s) => s.settings.locale)
  const moreRef = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState(false)
  const toggle = () => void actions.saveSchedule({ ...task, enabled: !task.enabled })
  const next =
    task.schedule.kind === 'manual'
      ? t('scheduled.manualOnly')
      : !task.enabled
        ? t('scheduled.off')
        : task.nextRun
          ? t('scheduled.next', { when: describeWhen(task.nextRun, now, locale) })
          : ''
  return (
    <li className="hx-sched" data-off={!task.enabled || undefined}>
      <button
        type="button"
        role="switch"
        className="oy-switch hx-switch"
        aria-checked={task.enabled}
        aria-label={t('scheduled.enabled', { name: task.name })}
        onClick={toggle}
      >
        <span className="switch-knob" />
      </button>
      <button type="button" className="main" onClick={onEdit}>
        <span className="line">
          <span className="name">{task.name}</span>
          <span className="when">{describeSchedule(task.schedule, locale)}</span>
        </span>
        <span className="prompt">{task.prompt}</span>
      </button>
      <span className="facts">
        <span className="proj">{baseName(task.workspace)}</span>
        <span className="next">{next}</span>
        <span className="last">
          <LastRun task={task} now={now} />
        </span>
      </span>
      <button
        ref={moreRef}
        type="button"
        className="btn-ghost hx-icon-btn"
        aria-haspopup="menu"
        aria-expanded={menu}
        aria-label={t('scheduled.more', { name: task.name })}
        title={t('scheduled.more', { name: task.name })}
        onClick={() => setMenu((o) => !o)}
      >
        <Icon icon={Ellipsis} size={16} />
      </button>
      <Menu anchor={moreRef.current} open={menu} onClose={() => setMenu(false)} label={task.name} align="end" minWidth={180}>
        <MenuItem
          icon={<Icon icon={Play} size={16} />}
          onSelect={() => {
            setMenu(false)
            void actions.runSchedule(task.id)
          }}
        >
          {t('scheduled.runNow')}
        </MenuItem>
        <MenuItem
          icon={<Icon icon={Pencil} size={16} />}
          onSelect={() => {
            setMenu(false)
            onEdit()
          }}
        >
          {t('scheduled.edit')}
        </MenuItem>
        <MenuItem
          danger
          icon={<Icon icon={Trash2} size={16} />}
          onSelect={() => {
            setMenu(false)
            onRemove()
          }}
        >
          {t('scheduled.remove')}
        </MenuItem>
      </Menu>
    </li>
  )
}

const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5)

function TaskEditor({ task, onClose }: { task: ScheduledTask | null; onClose(): void }) {
  const settings = useApp((s) => s.settings)
  const workspace = useApp((s) => s.workspace)
  const locale = settings.locale
  const projects = projectPaths(settings.projects, workspace)
  const [draft, setDraft] = useState<ScheduledTaskInput>(
    () =>
      task ?? {
        name: '',
        workspace: workspace?.path ?? projects[0] ?? '',
        prompt: '',
        schedule: { kind: 'daily', hour: 9, minute: 0, weekday: 1 },
        enabled: true,
        model: settings.model,
        effort: settings.effort,
        permissionMode: settings.permissionMode === 'plan' ? 'ask' : settings.permissionMode,
      },
  )
  const [busy, setBusy] = useState(false)
  const patch = (p: Partial<ScheduledTaskInput>) => setDraft((d) => ({ ...d, ...p }))
  const setSchedule = (p: Partial<Schedule>) => setDraft((d) => ({ ...d, schedule: { ...d.schedule, ...p } }))
  const kind = draft.schedule.kind
  const ready = draft.prompt.trim().length > 0 && projects.includes(draft.workspace) && !busy

  const save = async () => {
    if (!ready) return
    setBusy(true)
    const saved = await actions.saveSchedule({ ...draft, id: task?.id })
    setBusy(false)
    if (saved) onClose()
  }
  const minutes = MINUTES.includes(draft.schedule.minute) ? MINUTES : [...MINUTES, draft.schedule.minute].sort((a, b) => a - b)

  return (
    <Modal
      open
      onClose={onClose}
      title={task ? t('scheduled.edit') : t('scheduled.new')}
      actions={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn-primary" disabled={!ready} onClick={() => void save()}>
            {t('scheduled.save')}
          </button>
        </>
      }
    >
      <div className="hx-sched-form">
        <label className="oy-field-label" htmlFor="sched-name">
          {t('scheduled.name')}
        </label>
        <input
          id="sched-name"
          className="input-base"
          value={draft.name}
          placeholder={t('scheduled.namePlaceholder')}
          maxLength={80}
          onChange={(e) => patch({ name: e.target.value })}
        />
        <label className="oy-field-label" htmlFor="sched-prompt">
          {t('scheduled.prompt')}
        </label>
        <textarea
          id="sched-prompt"
          className="input-base"
          data-autofocus
          rows={4}
          value={draft.prompt}
          placeholder={t('scheduled.promptPlaceholder')}
          onChange={(e) => patch({ prompt: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save()
          }}
        />
        <div className="grid">
          <div>
            <span className="oy-field-label">{t('scheduled.project')}</span>
            <Select
              label={t('scheduled.project')}
              value={draft.workspace}
              options={projects.map((p) => ({ value: p, label: baseName(p) }))}
              onChange={(value) => patch({ workspace: value })}
            />
          </div>
          <div>
            <span className="oy-field-label">{t('scheduled.frequency')}</span>
            <Select
              label={t('scheduled.frequency')}
              value={kind}
              options={SCHEDULE_KINDS.map((k) => ({ value: k, label: t(`schedule.${k}` as MessageKey) }))}
              onChange={(value) => setSchedule({ kind: value })}
            />
          </div>
          {kind === 'weekly' && (
            <div>
              <span className="oy-field-label">{t('scheduled.weekday')}</span>
              <Select
                label={t('scheduled.weekday')}
                value={draft.schedule.weekday}
                options={[1, 2, 3, 4, 5, 6, 0].map((d) => ({ value: d, label: weekdayName(d, locale) }))}
                onChange={(value) => setSchedule({ weekday: value })}
              />
            </div>
          )}
          {kind === 'hourly' && (
            <div>
              <span className="oy-field-label">{t('scheduled.minute')}</span>
              <Select
                label={t('scheduled.minute')}
                value={draft.schedule.minute}
                options={minutes.map((m) => ({ value: m, label: `:${pad(m)}` }))}
                onChange={(value) => setSchedule({ minute: value })}
              />
            </div>
          )}
          {(kind === 'daily' || kind === 'weekdays' || kind === 'weekly') && (
            <div>
              <label className="oy-field-label" htmlFor="sched-time">
                {t('scheduled.time')}
              </label>
              <input
                id="sched-time"
                className="input-base hx-tabular"
                type="time"
                value={`${pad(draft.schedule.hour)}:${pad(draft.schedule.minute)}`}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(':').map(Number)
                  if (Number.isInteger(h) && Number.isInteger(m)) setSchedule({ hour: h, minute: m })
                }}
              />
            </div>
          )}
          <div>
            <span className="oy-field-label">{t('scheduled.model')}</span>
            <Select
              label={t('scheduled.model')}
              value={draft.model}
              options={MODELS.map((m) => ({ value: m as string, label: modelName(m) }))}
              onChange={(value) => patch({ model: value })}
            />
          </div>
          <div>
            <span className="oy-field-label">{t('scheduled.permission')}</span>
            <Select
              label={t('scheduled.permission')}
              value={draft.permissionMode}
              options={PERMISSION_MODES.map((m) => ({ value: m, label: t(`mode.${m}` as MessageKey), desc: t(`mode.${m}.desc` as MessageKey) }))}
              onChange={(value) => patch({ permissionMode: value })}
            />
          </div>
        </div>
        <p className="note">{t('scheduled.note')}</p>
      </div>
    </Modal>
  )
}
