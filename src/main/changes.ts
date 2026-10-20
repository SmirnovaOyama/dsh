// Remembers each file as it was before the agent first touched it in a session,
// so the changes panel can show a diff and "Revert all" can put things back.
// It also keeps a checkpoint per message of the person's: each file as it was before the agent
// first changed it after that message, which is what rewinding to the message puts back.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { FileChange } from '../shared/types'
import { diffText } from './diff'

export type Snapshots = Record<string, string | null>

export interface Checkpoint {
  /** The person's message this checkpoint starts at. */
  itemId: string
  files: Snapshots
}

async function readOrNull(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, 'utf8')
  } catch {
    return null
  }
}

export class ChangeTracker {
  private snapshots: Map<string, string | null>
  private checkpoints: Checkpoint[]

  constructor(
    private readonly workspace: string,
    initial: Snapshots = {},
    checkpoints: Checkpoint[] = [],
  ) {
    this.snapshots = new Map(Object.entries(initial))
    this.checkpoints = checkpoints
  }

  /** Call before writing `rel`; only the first call per file keeps the original. */
  async remember(rel: string): Promise<void> {
    const current = this.checkpoints[this.checkpoints.length - 1]
    const needsCheckpoint = current !== undefined && !(rel in current.files)
    if (this.snapshots.has(rel) && !needsCheckpoint) return
    const before = await readOrNull(this.abs(rel))
    if (!this.snapshots.has(rel)) this.snapshots.set(rel, before)
    if (needsCheckpoint) current.files[rel] = before
  }

  /** Starts a checkpoint for a message of the person's; later edits are remembered against it. */
  checkpoint(itemId: string): void {
    this.checkpoints.push({ itemId, files: {} })
  }

  hasCheckpoint(itemId: string): boolean {
    return this.checkpoints.some((c) => c.itemId === itemId)
  }

  /** Files the agent changed after this message, which rewinding the code would put back. */
  changedSince(itemId: string): string[] {
    const index = this.checkpoints.findIndex((c) => c.itemId === itemId)
    if (index === -1) return []
    return [...new Set(this.checkpoints.slice(index).flatMap((c) => Object.keys(c.files)))].sort()
  }

  /**
   * Puts every file the agent changed after this message back the way it was when the message was
   * sent, and forgets the checkpoints from there on. Returns how many files it wrote.
   */
  async rewindTo(itemId: string, keepCheckpoints = false): Promise<number> {
    const index = this.checkpoints.findIndex((c) => c.itemId === itemId)
    if (index === -1) return 0
    const later = this.checkpoints.slice(index)
    const restore = new Map<string, string | null>()
    for (const checkpoint of later) {
      for (const [rel, before] of Object.entries(checkpoint.files)) if (!restore.has(rel)) restore.set(rel, before)
    }
    for (const [rel, before] of restore) await this.write(rel, before)
    if (keepCheckpoints) for (const checkpoint of later) checkpoint.files = {}
    else this.checkpoints = this.checkpoints.slice(0, index)
    return restore.size
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
    for (const [rel, before] of this.snapshots) await this.write(rel, before)
    this.snapshots.clear()
    // The files are back where the conversation started, so there is nothing left to rewind.
    for (const checkpoint of this.checkpoints) checkpoint.files = {}
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

  /** Forgets the checkpoints from this message on, without touching any file. */
  dropFrom(itemId: string): void {
    const index = this.checkpoints.findIndex((c) => c.itemId === itemId)
    if (index !== -1) this.checkpoints = this.checkpoints.slice(0, index)
  }

  checkpointsJSON(): Checkpoint[] {
    return this.checkpoints.map((c) => ({ itemId: c.itemId, files: { ...c.files } }))
  }

  private async write(rel: string, content: string | null): Promise<void> {
    const abs = this.abs(rel)
    if (content === null) {
      await rm(abs, { force: true })
    } else {
      await mkdir(path.dirname(abs), { recursive: true })
      await writeFile(abs, content, 'utf8')
    }
  }

  private abs(rel: string): string {
    return path.join(this.workspace, ...rel.split('/'))
  }
}
