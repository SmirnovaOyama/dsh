import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Scheduler } from '../src/main/schedules'
import { cleanSchedule, nextRun } from '../src/shared/schedule'
import { DEFAULT_SETTINGS, type ScheduledTask, type Settings } from '../src/shared/types'

// Monday 19 October 2026, 08:00 local time.
const MONDAY_8 = new Date(2026, 9, 19, 8, 0, 0, 0).getTime()
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute, 0, 0).getTime()

describe('nextRun', () => {
  it('finds the next slot for each kind', () => {
    const base = { hour: 9, minute: 30, weekday: 1 }
    expect(nextRun({ ...base, kind: 'manual' }, MONDAY_8)).toBeNull()
    expect(nextRun({ ...base, kind: 'hourly' }, MONDAY_8)).toBe(at(19, 8, 30))
    expect(nextRun({ ...base, kind: 'daily' }, MONDAY_8)).toBe(at(19, 9, 30))
    expect(nextRun({ ...base, kind: 'daily' }, at(19, 9, 30))).toBe(at(20, 9, 30))
    // Friday after the slot skips the weekend.
    expect(nextRun({ ...base, kind: 'weekdays' }, at(23, 10))).toBe(at(26, 9, 30))
    expect(nextRun({ ...base, kind: 'weekly', weekday: 3 }, MONDAY_8)).toBe(at(21, 9, 30))
    expect(nextRun({ ...base, kind: 'weekly', weekday: 1 }, at(19, 10))).toBe(at(26, 9, 30))
  })

  it('cleans schedules from untrusted input', () => {
    expect(cleanSchedule({ kind: 'yearly' as never, hour: 30, minute: -4, weekday: 2.5 })).toEqual({ kind: 'daily', hour: 23, minute: 0, weekday: 1 })
  })
})

describe('Scheduler', () => {
  const setup = async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dsh-sched-'))
    let now = MONDAY_8
    const runs: ScheduledTask[] = []
    const settings: Settings = { ...DEFAULT_SETTINGS, projects: ['/p/one'] }
    let fail: string | null = null
    const scheduler = new Scheduler(dir, {
      settings: () => settings,
      emit: () => {},
      now: () => now,
      async run(task) {
        if (fail) throw new Error(fail)
        runs.push(task)
        return `session-${runs.length}`
      },
    })
    await scheduler.load()
    return { dir, scheduler, runs, setNow: (t: number) => (now = t), setFail: (f: string | null) => (fail = f) }
  }
  const input = { name: '', workspace: '/p/one', prompt: 'Run the tests\nand fix them', schedule: { kind: 'daily' as const, hour: 9, minute: 0, weekday: 1 }, enabled: true, model: 'deepseek-flash', effort: 'low' as const, permissionMode: 'ask' as const }

  it('saves, names from the prompt, and refuses unknown folders', async () => {
    const { scheduler, dir } = await setup()
    const task = await scheduler.save(input)
    expect(task?.name).toBe('Run the tests')
    expect(task?.nextRun).toBe(at(19, 9))
    expect(await scheduler.save({ ...input, workspace: '/elsewhere' })).toBeNull()
    expect(await scheduler.save({ ...input, prompt: '  ' })).toBeNull()
    const stored = JSON.parse(await readFile(path.join(dir, 'schedules.json'), 'utf8'))
    expect(stored).toHaveLength(1)
  })

  it('runs due tasks once and moves on to the next slot', async () => {
    const { scheduler, runs, setNow } = await setup()
    await scheduler.save(input)
    await scheduler.tick()
    expect(runs).toHaveLength(0)
    setNow(at(19, 9, 0) + 10_000)
    await scheduler.tick()
    await scheduler.tick()
    expect(runs).toHaveLength(1)
    const [task] = scheduler.list()
    expect(task.lastRun).toEqual({ at: at(19, 9, 0) + 10_000, sessionId: 'session-1' })
    expect(task.nextRun).toBe(at(20, 9))
  })

  it('skips disabled tasks, records failures, and runs manual tasks only by hand', async () => {
    const { scheduler, runs, setNow, setFail } = await setup()
    const off = await scheduler.save({ ...input, enabled: false })
    const manual = await scheduler.save({ ...input, schedule: { ...input.schedule, kind: 'manual' } })
    expect(off?.nextRun).toBeNull()
    expect(manual?.nextRun).toBeNull()
    setNow(at(25, 9))
    await scheduler.tick()
    expect(runs).toHaveLength(0)
    setFail('no-key')
    expect(await scheduler.runNow(manual!.id)).toBeNull()
    expect(scheduler.list().find((t) => t.id === manual!.id)?.lastRun).toEqual({ at: at(25, 9), sessionId: null, error: 'no-key' })
    setFail(null)
    expect(await scheduler.runNow(manual!.id)).toBe('session-1')
  })

  it('skips runs missed while the app was closed', async () => {
    const first = await setup()
    await first.scheduler.save(input)
    const later = new Scheduler(first.dir, { settings: () => DEFAULT_SETTINGS, emit: () => {}, now: () => at(22, 12), run: async () => 'x' })
    await later.load()
    expect(later.list()[0].nextRun).toBe(at(23, 9))
  })
})
