// Scheduled tasks: prompts that start a new conversation in a project on a schedule. They run only
// while dsh is open; a run missed while it was closed is skipped, not made up later.

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { cleanSchedule, nextRun } from '../shared/schedule'
import {
  currentModel,
  MODELS,
  PERMISSION_MODES,
  type ScheduledTask,
  type ScheduledTaskInput,
  type Settings,
} from '../shared/types'
import { writeJsonAtomic } from './store'

const TICK_MS = 30_000
const MAX_TASKS = 100
const MAX_PROMPT = 20_000

export interface SchedulerHost {
  settings(): Settings
  /** Starts a conversation for the task and returns its id; throws with a short reason when it cannot. */
  run(task: ScheduledTask): Promise<string>
  emit(tasks: ScheduledTask[]): void
  now?: () => number
}

export class Scheduler {
  private tasks: ScheduledTask[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly file: string
  private readonly now: () => number

  constructor(
    dir: string,
    private readonly host: SchedulerHost,
  ) {
    this.file = path.join(dir, 'schedules.json')
    this.now = host.now ?? Date.now
  }

  async load(): Promise<void> {
    let stored: unknown = null
    try {
      stored = JSON.parse(await readFile(this.file, 'utf8'))
    } catch {
      stored = null
    }
    const now = this.now()
    this.tasks = (Array.isArray(stored) ? (stored as ScheduledTask[]) : [])
      .filter((task) => task && typeof task.id === 'string' && typeof task.prompt === 'string')
      .map((task) => ({ ...task, schedule: cleanSchedule(task.schedule), nextRun: task.enabled ? nextRun(cleanSchedule(task.schedule), now) : null }))
  }

  list(): ScheduledTask[] {
    return this.tasks.map((task) => ({ ...task }))
  }

  start(): void {
    this.timer ??= setInterval(() => void this.tick(), TICK_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async save(input: ScheduledTaskInput): Promise<ScheduledTask | null> {
    const settings = this.host.settings()
    const prompt = typeof input?.prompt === 'string' ? input.prompt.trim().slice(0, MAX_PROMPT) : ''
    const workspace = typeof input?.workspace === 'string' ? input.workspace : ''
    if (!prompt || !settings.projects.includes(workspace)) return null
    const existing = this.tasks.find((task) => task.id === input.id)
    if (!existing && this.tasks.length >= MAX_TASKS) return null
    const schedule = cleanSchedule(input.schedule)
    const enabled = input.enabled !== false
    const name = (typeof input.name === 'string' ? input.name.trim() : '') || prompt.split('\n')[0].slice(0, 40)
    const model = (MODELS as readonly string[]).includes(input.model) ? input.model : settings.model
    const task: ScheduledTask = {
      id: existing?.id ?? randomUUID(),
      name: name.slice(0, 80),
      workspace,
      prompt,
      schedule,
      enabled,
      ...currentModel(model, input.effort),
      permissionMode: PERMISSION_MODES.includes(input.permissionMode) ? input.permissionMode : settings.permissionMode,
      createdAt: existing?.createdAt ?? this.now(),
      lastRun: existing?.lastRun ?? null,
      nextRun: enabled ? nextRun(schedule, this.now()) : null,
    }
    this.tasks = existing ? this.tasks.map((t) => (t.id === task.id ? task : t)) : [...this.tasks, task]
    await this.changed()
    return { ...task }
  }

  async remove(id: string): Promise<void> {
    const before = this.tasks.length
    this.tasks = this.tasks.filter((task) => task.id !== id)
    if (this.tasks.length !== before) await this.changed()
  }

  async runNow(id: string): Promise<string | null> {
    const task = this.tasks.find((t) => t.id === id)
    return task ? this.fire(task) : null
  }

  /** Starts every task that is due. Exposed for tests; the timer calls it twice a minute. */
  async tick(): Promise<void> {
    const now = this.now()
    const due = this.tasks.filter((task) => task.enabled && task.nextRun !== null && task.nextRun <= now)
    for (const task of due) {
      // Moved on before starting, so a slow start never runs the same slot twice.
      task.nextRun = nextRun(task.schedule, now)
      await this.fire(task)
    }
  }

  private async fire(task: ScheduledTask): Promise<string | null> {
    const at = this.now()
    let sessionId: string | null = null
    let error: string | undefined
    try {
      sessionId = await this.host.run({ ...task })
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure)
    }
    const current = this.tasks.find((t) => t.id === task.id)
    if (current) current.lastRun = { at, sessionId, ...(error ? { error } : {}) }
    await this.changed()
    return sessionId
  }

  private async changed(): Promise<void> {
    this.host.emit(this.list())
    await writeJsonAtomic(this.file, this.tasks)
  }
}
