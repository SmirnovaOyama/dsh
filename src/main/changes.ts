// Remembers each file as it was before the agent first touched it in a session,
// so the changes panel can show a diff and "Revert all" can put things back.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { FileChange } from '../shared/types'
import { diffText } from './diff'

export type Snapshots = Record<string, string | null>

async function readOrNull(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, 'utf8')
  } catch {
    return null
  }
}

export class ChangeTracker {
  private snapshots: Map<string, string | null>

  constructor(
    private readonly workspace: string,
    initial: Snapshots = {},
  ) {
    this.snapshots = new Map(Object.entries(initial))
  }

  /** Call before writing `rel`; only the first call per file keeps the original. */
  async remember(rel: string): Promise<void> {
    if (this.snapshots.has(rel)) return
    this.snapshots.set(rel, await readOrNull(this.abs(rel)))
  }

  async list(): Promise<FileChange[]> {
    const changes: FileChange[] = []
    for (const [rel, before] of this.snapshots) {
      const after = await readOrNull(this.abs(rel))
      if (before === after) continue
      const status = before === null ? 'added' : after === null ? 'deleted' : 'modified'
      const { lines, stats } = diffText(before ?? '', after ?? '')
      changes.push({ path: rel, status, stats, lines })
    }
    return changes.sort((a, b) => a.path.localeCompare(b.path))
  }

  async revertAll(): Promise<void> {
    for (const [rel, before] of this.snapshots) {
      const abs = this.abs(rel)
      if (before === null) {
        await rm(abs, { force: true })
      } else {
        await mkdir(path.dirname(abs), { recursive: true })
        await writeFile(abs, before, 'utf8')
      }
    }
    this.snapshots.clear()
  }

  /** Forget the originals, for example after the changes were committed. */
  clear(): void {
    this.snapshots.clear()
  }

  paths(): string[] {
    return [...this.snapshots.keys()]
  }

  toJSON(): Snapshots {
    return Object.fromEntries(this.snapshots)
  }

  private abs(rel: string): string {
    return path.join(this.workspace, ...rel.split('/'))
  }
}
