// The artifacts library: every finished artifact, gathered from all conversations in all folders.

import type { LibraryArtifact, SessionData } from './types'

/** The newest finished version of each artifact in one conversation. */
export function artifactsIn(data: SessionData): LibraryArtifact[] {
  const newest = new Map<string, LibraryArtifact>()
  for (const item of data.items) {
    if (item.kind !== 'tool' || !item.artifact || item.status !== 'done') continue
    const key = item.artifact.id || item.id
    const seen = newest.get(key)
    if (seen && seen.artifact.version > item.artifact.version) continue
    newest.set(key, {
      sessionId: data.id,
      sessionTitle: data.title,
      workspace: data.workspace,
      itemId: item.id,
      artifact: item.artifact,
      updatedAt: item.endedAt ?? item.startedAt ?? data.updatedAt,
    })
  }
  return [...newest.values()]
}

/** Newest first, so the library opens on what was made last. */
export const byNewest = (a: LibraryArtifact, b: LibraryArtifact) => b.updatedAt - a.updatedAt
