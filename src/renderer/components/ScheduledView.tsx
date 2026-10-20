import { CirclePause, Clock, Ellipsis, Pencil, Play, Plus, Trash2 } from 'lucide-react'
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
  const [scrolled, setScrolled] = useState(false)
  const now = useNow()

  return (
    <main className="hx-page" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}>
      <PageHead title={t('scheduled.title')} scrolled={scrolled}>
        <button type="button" className="btn-secondary hx-page-btn" onClick={() => setEditing('new')}>
          <Icon icon={Plus} size={16} />
          {t('scheduled.new')}
        </button>
      </PageHead>
      <div className="hx-page-body">
        <p className="hx-page-intro">{t('scheduled.intro')}</p>
        {tasks && tasks.length === 0 && <p className="hx-page-empty">{t('scheduled.empty')}</p>}
        {tasks && tasks.length > 0 && (
          <ul className="hx-sched-list">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} now={now} onEdit={() => setEditing(task)} onRemove={() => setRemoving(task)} />
            ))}
          </ul>
        )}
        <p className="hx-page-foot">{t('scheduled.openOnly')}</p>
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

/** The last run in a few words; when it started a conversation, the words open it. */
function LastRun({ task, now }: { task: ScheduledTask; now: number }) {
  const locale = useApp((s) => s.settings.locale)
  const meta = useApp((s) => (task.lastRun?.sessionId ? s.sessions.find((m) => m.id === task.lastRun?.sessionId) : undefined))
  const run = task.lastRun
  if (!run) return <span className="last">{t('scheduled.never')}</span>
  const when = describeWhen(run.at, now, locale)
  if (run.error) {
    const reason = run.error === 'no-key' || run.error === 'no-folder' ? t(`scheduled.failed.${run.error}` as MessageKey) : t('scheduled.failed')
    return (
      <span className="last is-error" title={`${t('scheduled.last', { when })}\n${reason}`}>
        {t('scheduled.lastFailed')}
      </span>
    )
  }
  const label =
    meta?.status === 'running' ? t('scheduled.lastRunning') : meta?.status === 'waiting' ? t('scheduled.lastWaiting') : t('scheduled.lastDone')
  return (
    <button
      type="button"
      className={`last hx-last-link ${meta?.status === 'waiting' ? 'is-waiting' : ''}`}
      title={`${t('scheduled.last', { when })}\n${t('scheduled.open')}`}
      onClick={() => void actions.openSession(run.sessionId!)}
    >
      {label}
    </button>
  )
}

function TaskRow({ task, now, onEdit, onRemove }: { task: ScheduledTask; now: number; onEdit(): void; onRemove(): void }) {
  const locale = useApp((s) => s.settings.locale)
  const moreRef = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState(false)
  const next =
    task.schedule.kind === 'manual'
      ? t('scheduled.manualOnly')
      : !task.enabled
        ? t('scheduled.off')
        : task.nextRun
          ? describeWhen(task.nextRun, now, locale)
          : ''
  const item = (icon: typeof Play, label: string, run: () => void, danger = false) => (
    <MenuItem
      danger={danger}
      icon={<Icon icon={icon} size={16} />}
      onSelect={() => {
        setMenu(false)
        run()
      }}
    >
      {label}
    </MenuItem>
  )
  return (
    <li className="hx-sched" data-off={!task.enabled || undefined} data-menu={menu || undefined}>
      <button type="button" className="main" onClick={onEdit}>
        <Icon icon={task.enabled ? Clock : CirclePause} size={16} />
        <span className="text">
          <span className="name">{task.name}</span>
          <span className="sub">
            <span>{describeSchedule(task.schedule, locale)}</span>
            <span>{baseName(task.workspace)}</span>
          </span>
        </span>
      </button>
      <span className="side">
        <span className="next">{next}</span>
        <LastRun task={task} now={now} />
      </span>
      <button
        ref={moreRef}
        type="button"
        className="btn-ghost hx-icon-btn more"
        aria-haspopup="menu"
        aria-expanded={menu}
        aria-label={t('scheduled.more', { name: task.name })}
        title={t('scheduled.more', { name: task.name })}
        onClick={() => setMenu((o) => !o)}
      >
        <Icon icon={Ellipsis} size={16} />
      </button>
      <Menu anchor={moreRef.current} open={menu} onClose={() => setMenu(false)} label={task.name} align="end" minWidth={180}>
        {item(Play, t('scheduled.runNow'), () => void actions.runSchedule(task.id))}
        {item(Pencil, t('scheduled.edit'), onEdit)}
        {task.schedule.kind !== 'manual' &&
          item(task.enabled ? CirclePause : Clock, t(task.enabled ? 'scheduled.pause' : 'scheduled.resume'), () =>
            void actions.saveSchedule({ ...task, enabled: !task.enabled }),
          )}
        {item(Trash2, t('scheduled.remove'), onRemove, true)}
      </Menu>
    </li>
  )
}

const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5)
const HOURS = Array.from({ length: 24 }, (_, i) => i)

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
            <span className="oy-field-label">{t('scheduled.permission')}</span>
            <Select
              label={t('scheduled.permission')}
              value={draft.permissionMode}
              options={PERMISSION_MODES.map((m) => ({ value: m, label: t(`mode.${m}` as MessageKey), desc: t(`mode.${m}.desc` as MessageKey) }))}
              onChange={(value) => patch({ permissionMode: value })}
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
          {kind !== 'manual' && (
            <div>
              <span className="oy-field-label">{t('scheduled.time')}</span>
              <div className="hx-time">
                {kind === 'weekly' && (
                  <Select
                    label={t('scheduled.weekday')}
                    value={draft.schedule.weekday}
                    options={[1, 2, 3, 4, 5, 6, 0].map((d) => ({ value: d, label: weekdayName(d, locale) }))}
                    onChange={(value) => setSchedule({ weekday: value })}
                  />
                )}
                {kind !== 'hourly' && (
                  <Select
                    label={t('scheduled.hour')}
                    value={draft.schedule.hour}
                    options={HOURS.map((h) => ({ value: h, label: pad(h) }))}
                    onChange={(value) => setSchedule({ hour: value })}
                  />
                )}
                <Select
                  label={t('scheduled.minute')}
                  value={draft.schedule.minute}
                  options={minutes.map((m) => ({ value: m, label: kind === 'hourly' ? `:${pad(m)}` : pad(m) }))}
                  onChange={(value) => setSchedule({ minute: value })}
                />
              </div>
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
        </div>
        <p className="note">{t('scheduled.note')}</p>
      </div>
    </Modal>
  )
}
