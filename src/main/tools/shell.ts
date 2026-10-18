// Runs one shell command in the workspace, streaming its output and keeping the head and tail.

import { spawn } from 'node:child_process'

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000
const HEAD_CHARS = 8_000
const TAIL_CHARS = 22_000

export interface CommandResult {
  exitCode: number | null
  output: string
  timedOut: boolean
  aborted: boolean
  truncated: boolean
  durationMs: number
}

export interface CommandOptions {
  cwd: string
  timeoutMs?: number
  signal?: AbortSignal
  onOutput?(text: string): void
  env?: NodeJS.ProcessEnv
}

export function shellFor(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env) {
  if (platform === 'win32') {
    return { file: 'powershell.exe', args: (command: string) => ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command] }
  }
  // A login shell picks up the PATH people set in their profile, which apps started from the Dock do not inherit.
  const file = env.SHELL || '/bin/bash'
  return { file, args: (command: string) => ['-l', '-c', command] }
}

/** Keeps the start and the end of long output, which is where errors and summaries usually are. */
export class OutputBuffer {
  private head = ''
  private tail = ''
  private dropped = 0

  push(text: string) {
    if (this.head.length < HEAD_CHARS) {
      const room = HEAD_CHARS - this.head.length
      this.head += text.slice(0, room)
      text = text.slice(room)
    }
    if (!text) return
    this.tail += text
    if (this.tail.length > TAIL_CHARS) {
      this.dropped += this.tail.length - TAIL_CHARS
      this.tail = this.tail.slice(-TAIL_CHARS)
    }
  }

  get truncated() {
    return this.dropped > 0
  }

  toString() {
    if (!this.dropped) return this.head + this.tail
    return `${this.head}\n\n[${this.dropped} characters of output omitted]\n\n${this.tail}`
  }
}

export function clampTimeout(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_MS
  return Math.min(MAX_TIMEOUT_MS, Math.max(1_000, Math.floor(n)))
}

export function runCommand(command: string, options: CommandOptions): Promise<CommandResult> {
  const started = Date.now()
  const shell = shellFor()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const buffer = new OutputBuffer()

  return new Promise((resolve) => {
    const child = spawn(shell.file, shell.args(command), {
      cwd: options.cwd,
      env: { ...process.env, ...options.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1', GIT_PAGER: 'cat', PAGER: 'cat' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    })

    let timedOut = false
    let aborted = false
    let settled = false

    const kill = () => {
      if (child.exitCode !== null || child.pid === undefined) return
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
      } else {
        try {
          process.kill(-child.pid, 'SIGTERM')
        } catch {
          child.kill('SIGTERM')
        }
        setTimeout(() => {
          try {
            if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL')
          } catch {
            // Already gone.
          }
        }, 2_000).unref()
      }
    }

    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, timeoutMs)

    const onAbort = () => {
      aborted = true
      kill()
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    const onData = (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      buffer.push(text)
      options.onOutput?.(text)
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)

    const finish = (exitCode: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      resolve({
        exitCode,
        output: buffer.toString(),
        timedOut,
        aborted,
        truncated: buffer.truncated,
        durationMs: Date.now() - started,
      })
    }

    child.on('error', (error) => {
      buffer.push(`\n${error.message}\n`)
      finish(null)
    })
    child.on('close', (code) => finish(code))
  })
}

/** The first one or two words of a command, offered as "always allow" (`npm install`, `git status`). */
export function commandPrefix(command: string): string {
  const words = command.trim().split(/\s+/)
  const first = words[0] ?? ''
  const second = words[1]
  const takesSubcommand = /^(npm|pnpm|yarn|bun|npx|git|cargo|go|pip|pip3|python|python3|uv|poetry|make|docker|deno|dotnet|gradle|mvn|swift|flutter)$/.test(first)
  if (takesSubcommand && second && /^[\w:.-]+$/.test(second)) return `${first} ${second}`
  return first
}

/** True when the whole command is covered by an allowed prefix and does not chain or redirect into something else. */
export function isCommandAllowed(command: string, allowed: string[]): boolean {
  const trimmed = command.trim()
  if (!trimmed || /[;&|`<>]|\$\(/.test(trimmed)) return false
  return allowed.some((prefix) => {
    const p = prefix.trim()
    return p !== '' && (trimmed === p || trimmed.startsWith(p + ' '))
  })
}
