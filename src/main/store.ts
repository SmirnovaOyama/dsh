// Settings and conversations on disk, under the app's user-data folder.

import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { currentModel, DEFAULT_SETTINGS, type SessionData, type SessionMeta, type Settings } from '../shared/types'
import type { Snapshots } from './changes'
import type { ChatMessage } from './deepseek'

/** Writes through a temporary file so a crash never leaves half a JSON file behind. */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  await writeFile(temp, JSON.stringify(value), 'utf8')
  await rename(temp, file)
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

export interface StoredSettings extends Settings {
  /** The API key, encrypted with the system keychain when available (base64). */
  apiKey?: { value: string; encrypted: boolean }
}

export interface KeyCipher {
  available(): boolean
  encrypt(plain: string): string
  decrypt(encoded: string): string
}

export class SettingsStore {
  private data: StoredSettings = { ...DEFAULT_SETTINGS }
  private readonly file: string

  constructor(
    dir: string,
    private readonly cipher: KeyCipher,
  ) {
    this.file = path.join(dir, 'settings.json')
  }

  async load(): Promise<void> {
    const stored = await readJson<Partial<StoredSettings>>(this.file)
    this.data = { ...DEFAULT_SETTINGS, ...stored }
    // Settings saved before the V4 models carry a retired model name and no effort.
    Object.assign(this.data, currentModel(this.data.model, stored?.effort))
  }

  get(): Settings {
    const { apiKey: _key, ...settings } = this.data
    return settings
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const { apiKey: _ignored, ...safe } = patch as Partial<StoredSettings>
    this.data = { ...this.data, ...safe }
    await this.save()
    return this.get()
  }

  hasApiKey(): boolean {
    return Boolean(this.data.apiKey?.value)
  }

  apiKey(): string | null {
    const stored = this.data.apiKey
    if (!stored?.value) return null
    try {
      return stored.encrypted ? this.cipher.decrypt(stored.value) : stored.value
    } catch {
      return null
    }
  }

  async setApiKey(key: string): Promise<void> {
    const trimmed = key.trim()
    if (!trimmed) return this.clearApiKey()
    this.data.apiKey = this.cipher.available()
      ? { value: this.cipher.encrypt(trimmed), encrypted: true }
      : { value: trimmed, encrypted: false }
    await this.save()
  }

  async clearApiKey(): Promise<void> {
    delete this.data.apiKey
    await this.save()
  }

  private save(): Promise<void> {
    return writeJsonAtomic(this.file, this.data)
  }
}

export interface StoredSession {
  version: 1
  data: SessionData
  messages: ChatMessage[]
  snapshots: Snapshots
  allowEdits: boolean
  allowedPrefixes: string[]
}

export class SessionStore {
  private readonly dir: string
  private index = new Map<string, SessionMeta>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private latest = new Map<string, StoredSession>()

  constructor(root: string) {
    this.dir = path.join(root, 'sessions')
  }

  async load(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const index = await readJson<SessionMeta[]>(path.join(this.dir, 'index.json'))
    if (index) {
      this.index = new Map(index.map((meta) => [meta.id, meta]))
      return
    }
    // No index yet (or it was lost): rebuild it from the session files.
    for (const name of await readdir(this.dir)) {
      if (!name.endsWith('.json') || name === 'index.json') continue
      const stored = await readJson<StoredSession>(path.join(this.dir, name))
      if (stored?.data) this.index.set(stored.data.id, metaOf(stored.data))
    }
  }

  /** Every conversation in every folder. */
  all(): SessionMeta[] {
    return [...this.index.values()]
  }

  list(workspace: string): SessionMeta[] {
    return [...this.index.values()].filter((meta) => meta.workspace === workspace).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async read(id: string): Promise<StoredSession | null> {
    const pending = this.latest.get(id)
    if (pending) return pending
    if (!/^[\w-]+$/.test(id)) return null
    return readJson<StoredSession>(path.join(this.dir, `${id}.json`))
  }

  /** Saves soon; repeated calls within half a second write once. */
  save(stored: StoredSession): void {
    const id = stored.data.id
    this.index.set(id, metaOf(stored.data))
    this.latest.set(id, stored)
    if (this.timers.has(id)) return
    this.timers.set(
      id,
      setTimeout(() => void this.write(id), 500),
    )
  }

  async flush(): Promise<void> {
    await Promise.all([...this.timers.keys()].map((id) => this.write(id)))
  }

  async remove(id: string): Promise<void> {
    clearTimeout(this.timers.get(id))
    this.timers.delete(id)
    this.latest.delete(id)
    this.index.delete(id)
    await rm(path.join(this.dir, `${id}.json`), { force: true })
    await this.writeIndex()
  }

  private async write(id: string): Promise<void> {
    clearTimeout(this.timers.get(id))
    this.timers.delete(id)
    const stored = this.latest.get(id)
    if (!stored) return
    this.latest.delete(id)
    await writeJsonAtomic(path.join(this.dir, `${id}.json`), stored)
    await this.writeIndex()
  }

  private writeIndex(): Promise<void> {
    return writeJsonAtomic(path.join(this.dir, 'index.json'), [...this.index.values()])
  }
}

export function metaOf(data: SessionData): SessionMeta {
  const { items: _items, usage: _usage, ...meta } = data
  return { ...meta, ...currentModel(meta.model, meta.effort) }
}
