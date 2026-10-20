// Writing artifacts to disk when the person asks: into the open folder, or a temporary page for the browser.

import { constants } from 'node:fs'
import { access, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { SaveResult } from '../shared/types'

/** A plain file name with no folders in it, so a name can never point outside where it is written. */
export function safeFileName(name: unknown, fallback = 'artifact.txt'): string {
  const base = path.basename(String(name ?? '')).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '-').replace(/^\.+/, '').trim()
  return base.slice(0, 120) || fallback
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/** The first of name.ext, name-2.ext, name-3.ext ... that is free in the folder. */
export async function freeName(dir: string, name: string): Promise<string> {
  const ext = path.extname(name)
  const stem = name.slice(0, name.length - ext.length)
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? name : `${stem}-${n}${ext}`
    if (!(await exists(path.join(dir, candidate)))) return candidate
  }
  throw new Error('Too many files with this name already.')
}

/** Saves into the folder's top level without replacing anything already there. */
export async function saveToFolder(dir: string | null, name: unknown, content: unknown): Promise<SaveResult> {
  if (!dir) return { ok: false, error: 'No folder is open.' }
  try {
    const file = await freeName(dir, safeFileName(name))
    await writeFile(path.join(dir, file), String(content ?? ''), { encoding: 'utf8', flag: 'wx' })
    return { ok: true, path: file }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

// One private folder per run of the app (only this user can open it), made the first time it is needed.
const privateDirs = new Map<string, Promise<string>>()

async function privateDir(tempRoot: string, fresh = false): Promise<string> {
  let dir = privateDirs.get(tempRoot)
  if (!dir || fresh) {
    const made = mkdtemp(path.join(tempRoot, 'dsh-artifacts-'))
    privateDirs.set(tempRoot, made)
    // A failure is not kept, so the next open tries again.
    made.catch(() => privateDirs.get(tempRoot) === made && privateDirs.delete(tempRoot))
    dir = made
  }
  return dir
}

/**
 * Writes a page for the person's browser and returns its path. Each open gets a file of its own in a
 * private folder, so an earlier tab keeps its page and nobody else can swap the file.
 */
export async function writeTempPage(tempRoot: string, name: unknown, html: unknown): Promise<string> {
  const base = safeFileName(name, 'artifact.html').replace(/\.[^.]*$/, '') || 'artifact'
  for (const fresh of [false, true]) {
    try {
      const dir = await privateDir(tempRoot, fresh)
      const file = path.join(dir, await freeName(dir, `${base}.html`))
      await writeFile(file, String(html ?? ''), { encoding: 'utf8', flag: 'wx' })
      return file
    } catch (error) {
      // The folder can be cleared while the app runs; make a new one once.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || fresh) throw error
    }
  }
  throw new Error('Could not write the page.')
}
