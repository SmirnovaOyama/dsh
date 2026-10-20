// When a scheduled task runs next. Shared by the app and the browser demo.

import { SCHEDULE_KINDS, type Schedule } from './types'

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback

/** A schedule with every field in range, whatever was passed in. */
export function cleanSchedule(input: Partial<Schedule> | undefined): Schedule {
  return {
    kind: input?.kind && SCHEDULE_KINDS.includes(input.kind) ? input.kind : 'daily',
    hour: clamp(input?.hour, 0, 23, 9),
    minute: clamp(input?.minute, 0, 59, 0),
    weekday: clamp(input?.weekday, 0, 6, 1),
  }
}

/** The first run strictly after `after` (a timestamp), in local time, or null for manual tasks. */
export function nextRun(schedule: Schedule, after: number): number | null {
  if (schedule.kind === 'manual') return null
  if (schedule.kind === 'hourly') {
    const at = new Date(after)
    at.setMinutes(schedule.minute, 0, 0)
    if (at.getTime() <= after) at.setHours(at.getHours() + 1)
    return at.getTime()
  }
  const at = new Date(after)
  at.setHours(schedule.hour, schedule.minute, 0, 0)
  for (let day = 0; day < 8; day++) {
    const weekday = at.getDay()
    const fits =
      schedule.kind === 'daily' ||
      (schedule.kind === 'weekdays' && weekday !== 0 && weekday !== 6) ||
      (schedule.kind === 'weekly' && weekday === schedule.weekday)
    if (fits && at.getTime() > after) return at.getTime()
    at.setDate(at.getDate() + 1)
    at.setHours(schedule.hour, schedule.minute, 0, 0)
  }
  return null
}
