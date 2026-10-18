import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChangeTracker } from '../src/main/changes'
import { prepareToolCall } from '../src/main/tools'
import { globToRegExp } from '../src/main/tools/files'
import { ToolError } from '../src/main/tools/paths'
import { commandPrefix, isCommandAllowed, runCommand } from '../src/main/tools/shell'

let ws: string
let outside: string

beforeEach(async () => {
  ws = await mkdtemp(path.join(tmpdir(), 'dsh-ws-'))
  outside = await mkdtemp(path.join(tmpdir(), 'dsh-out-'))
  await mkdir(path.join(ws, 'src/auth'), { recursive: true })
  await writeFile(path.join(ws, 'src/auth/session.ts'), 'export function a() {\n  return 1\n}\n\nexport function b() {\n  return 1\n}\n')
  await writeFile(path.join(ws, 'README.md'), '# Hello\n')
  await writeFile(path.join(outside, 'secret.txt'), 'nope')
})

afterEach(async () => {
  await rm(ws, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

async function call(name: string, args: Record<string, unknown>) {
  const prepared = await prepareToolCall(name, JSON.stringify(args), ws)
  const tracker = new ChangeTracker(ws)
  const result = await prepared.run({ workspace: ws, tracker, signal: new AbortController().signal, onOutput: () => {} })
  return { prepared, result, tracker }
}

describe('workspace boundary', () => {
  it('refuses paths that leave the workspace', async () => {
    await expect(prepareToolCall('read_file', JSON.stringify({ path: '../x' }), ws)).rejects.toBeInstanceOf(ToolError)
    await expect(prepareToolCall('read_file', JSON.stringify({ path: path.join(outside, 'secret.txt') }), ws)).rejects.toBeInstanceOf(ToolError)
  })

  it('refuses symlinks that point outside', async () => {
    await symlink(outside, path.join(ws, 'link'))
    await expect(prepareToolCall('write_file', JSON.stringify({ path: 'link/new.txt', content: 'x' }), ws)).rejects.toThrow(/symlink/)
  })

  it('rejects arguments that are not JSON', async () => {
    await expect(prepareToolCall('read_file', '{path:', ws)).rejects.toThrow(/valid JSON/)
  })
})

describe('read_file', () => {
  it('numbers lines and pages with offset and limit', async () => {
    const { result } = await call('read_file', { path: 'src/auth/session.ts', offset: 2, limit: 2 })
    expect(result.text).toContain('lines 2-3 of 7')
    expect(result.text).toContain('2\t  return 1')
    expect(result.text).toContain('offset 4')
    expect(result.info?.lines).toBe(2)
  })
})

describe('edit_file', () => {
  it('asks for a unique match', async () => {
    await expect(prepareToolCall('edit_file', JSON.stringify({ path: 'src/auth/session.ts', old_string: 'return 1', new_string: 'return 2' }), ws)).rejects.toThrow(/appears 2 times/)
  })

  it('reports text that is not there', async () => {
    await expect(prepareToolCall('edit_file', JSON.stringify({ path: 'src/auth/session.ts', old_string: 'nothing', new_string: 'x' }), ws)).rejects.toThrow(/not found/)
  })

  it('replaces one occurrence, shows the diff and records the original', async () => {
    const { prepared, tracker } = await call('edit_file', {
      path: 'src/auth/session.ts',
      old_string: 'export function a() {\n  return 1',
      new_string: 'export function a() {\n  return 2',
    })
    expect(prepared.approval).toMatchObject({ kind: 'edit', path: 'src/auth/session.ts', created: false, stats: { added: 1, removed: 1 } })
    expect(await readFile(path.join(ws, 'src/auth/session.ts'), 'utf8')).toContain('return 2\n}\n\nexport function b() {\n  return 1')
    const changes = await tracker.list()
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ path: 'src/auth/session.ts', status: 'modified', stats: { added: 1, removed: 1 } })
  })

  it('replaces every occurrence when asked', async () => {
    await call('edit_file', { path: 'src/auth/session.ts', old_string: 'return 1', new_string: 'return 3', replace_all: true })
    const text = await readFile(path.join(ws, 'src/auth/session.ts'), 'utf8')
    expect(text.match(/return 3/g)).toHaveLength(2)
  })

  it('keeps Windows line endings', async () => {
    await writeFile(path.join(ws, 'win.txt'), 'one\r\ntwo\r\n')
    await call('edit_file', { path: 'win.txt', old_string: 'one\ntwo', new_string: 'one\nthree' })
    expect(await readFile(path.join(ws, 'win.txt'), 'utf8')).toBe('one\r\nthree\r\n')
  })
})

describe('write_file and reverting', () => {
  it('creates folders, and revert removes the new file', async () => {
    const { prepared, tracker } = await call('write_file', { path: 'src/new/clock.ts', content: 'export const x = 1\n' })
    expect(prepared.created).toBe(true)
    expect(await readFile(path.join(ws, 'src/new/clock.ts'), 'utf8')).toBe('export const x = 1\n')
    expect((await tracker.list())[0]).toMatchObject({ status: 'added', stats: { added: 1, removed: 0 } })
    await tracker.revertAll()
    await expect(readFile(path.join(ws, 'src/new/clock.ts'), 'utf8')).rejects.toThrow()
  })

  it('revert restores a modified file', async () => {
    const tracker = new ChangeTracker(ws)
    const prepared = await prepareToolCall('write_file', JSON.stringify({ path: 'README.md', content: '# Changed\n' }), ws)
    await prepared.run({ workspace: ws, tracker, signal: new AbortController().signal, onOutput: () => {} })
    await tracker.revertAll()
    expect(await readFile(path.join(ws, 'README.md'), 'utf8')).toBe('# Hello\n')
  })
})

describe('find_files and search_files', () => {
  it('finds files by glob', async () => {
    const { result } = await call('find_files', { pattern: '*.ts' })
    expect(result.text).toBe('src/auth/session.ts')
  })

  it('searches contents with a regular expression', async () => {
    const { result } = await call('search_files', { pattern: 'function \\w+', glob: '**/*.ts' })
    expect(result.text.split('\n')).toEqual(['src/auth/session.ts:1: export function a() {', 'src/auth/session.ts:5: export function b() {'])
    expect(result.info?.matches).toBe(2)
  })

  it('translates globs', () => {
    expect(globToRegExp('src/**/*.{ts,tsx}').test('src/a/b/c.tsx')).toBe(true)
    expect(globToRegExp('src/**/*.{ts,tsx}').test('src/c.ts')).toBe(true)
    expect(globToRegExp('*.md').test('docs/guide.md')).toBe(true)
    expect(globToRegExp('src/*.ts').test('src/a/b.ts')).toBe(false)
  })
})

describe('commands', () => {
  it('suggests a prefix to allow', () => {
    expect(commandPrefix('npm install zod')).toBe('npm install')
    expect(commandPrefix('git status --short')).toBe('git status')
    expect(commandPrefix('ls -la')).toBe('ls')
  })

  it('only allows whole commands under an allowed prefix', () => {
    const allowed = ['npm test', 'git status']
    expect(isCommandAllowed('npm test -- auth', allowed)).toBe(true)
    expect(isCommandAllowed('npm testing', allowed)).toBe(false)
    expect(isCommandAllowed('git status && rm -rf /', allowed)).toBe(false)
    expect(isCommandAllowed('npm test > out.txt', allowed)).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('runs a command and reports its exit code', async () => {
    const result = await runCommand('echo hello && exit 3', { cwd: ws })
    expect(result.output).toContain('hello')
    expect(result.exitCode).toBe(3)
  })

  it.skipIf(process.platform === 'win32')('stops a command that runs too long', async () => {
    const result = await runCommand('sleep 5', { cwd: ws, timeoutMs: 300 })
    expect(result.timedOut).toBe(true)
  })
})
