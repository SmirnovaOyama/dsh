// Turns two versions of a file into the numbered lines the diff views draw.

import { structuredPatch } from 'diff'
import type { DiffLine, DiffStats } from './types'

export interface FileDiff {
  lines: DiffLine[]
  stats: DiffStats
}

export function diffText(before: string, after: string, context = 3): FileDiff {
  const patch = structuredPatch('a', 'b', before, after, '', '', { context })
  const lines: DiffLine[] = []
  const stats: DiffStats = { added: 0, removed: 0 }
  for (const hunk of patch.hunks) {
    lines.push({
      kind: 'hunk',
      text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    })
    let oldNo = hunk.oldStart
    let newNo = hunk.newStart
    for (const raw of hunk.lines) {
      const marker = raw[0]
      const text = raw.slice(1)
      if (marker === '\\') continue
      if (marker === '+') {
        lines.push({ kind: 'add', newNo: newNo++, text })
        stats.added++
      } else if (marker === '-') {
        lines.push({ kind: 'del', oldNo: oldNo++, text })
        stats.removed++
      } else {
        lines.push({ kind: 'ctx', oldNo: oldNo++, newNo: newNo++, text })
      }
    }
  }
  return { lines, stats }
}

export function countLines(text: string): number {
  if (!text) return 0
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}
