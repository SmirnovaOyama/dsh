import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { expandCommand, listCommands, parseCommand } from '../src/main/commands'
import { Controller } from '../src/main/controller'
import type { ApiUsage, ChatMessage, ChatRequest, ChatResult, StreamHandlers, ToolCall } from '../src/main/deepseek'
import { SessionStore, SettingsStore } from '../src/main/store'
import type { AgentEvent, PermissionMode, PermissionRequest } from '../src/shared/types'

const plainCipher = { available: () => false, encrypt: (s: string) => s, decrypt: (s: string) => s }

let root: string
let ws: string
let events: AgentEvent[]

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'dsh-app-'))
  ws = await mkdtemp(path.join(tmpdir(), 'dsh-ws-'))
  await writeFile(path.join(ws, 'a.txt'), 'one\n')
  events = []
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(ws, { recursive: true, force: true })
})

type Step = Partial<ChatResult> & { wait?: Promise<void> }

function scripted(steps: Step[], seen: ChatRequest[]) {
  return async (request: ChatRequest, handlers: StreamHandlers = {}): Promise<ChatResult> => {
    seen.push(JSON.parse(JSON.stringify({ ...request, signal: undefined })))
    const step = steps.shift()
    if (!step) throw new Error('No more scripted steps')
    if (step.wait) await step.wait
    if (step.content) handlers.onContent?.(step.content)
    return {
      content: step.content ?? '',
      reasoning: '',
      toolCalls: step.toolCalls ?? [],
      finishReason: step.toolCalls?.length ? 'tool_calls' : 'stop',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } satisfies ApiUsage,
    }
  }
}

async function setup(steps: Step[], seen: ChatRequest[] = []) {
  const settings = new SettingsStore(root, plainCipher)
  await settings.load()
  await settings.setApiKey('sk-test')
  const sessions = new SessionStore(root)
  await sessions.load()
  return new Controller({ settings, sessions, emit: (e) => events.push(e), chat: scripted(steps, seen) })
}

const opts = (permissionMode: PermissionMode) => ({ id: randomUUID(), model: 'deepseek-flash', effort: 'none' as const, permissionMode })
const call = (name: string, args: unknown, id = randomUUID()): ToolCall => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const edit = (from: string, to: string) => call('edit_file', { path: 'a.txt', old_string: from, new_string: to })

async function until<T>(find: () => T | undefined, timeout = 2000): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = find()
    if (value) return value
    if (Date.now() - started > timeout) throw new Error('Timed out waiting')
    await new Promise((r) => setTimeout(r, 5))
  }
}

async function idle(controller: Controller, id: string) {
  await until(() => events.some((e) => e.type === 'meta' && e.meta.id === id && e.meta.status === 'idle') || undefined)
  events = []
  return (await controller.snapshot(id))!
}

const permissionRequest = () =>
  [...events].reverse().find((e): e is Extract<AgentEvent, { type: 'permission' }> => e.type === 'permission' && e.request !== null)?.request as
    | PermissionRequest
    | undefined

const userTexts = (messages: ChatMessage[]) => messages.filter((m) => m.role === 'user').map((m) => m.content)

describe('queued messages', () => {
  it('sends a message typed during a step in at the next step', async () => {
    let release!: () => void
    const wait = new Promise<void>((r) => (release = r))
    const seen: ChatRequest[] = []
    const controller = await setup([{ toolCalls: [call('read_file', { path: 'a.txt' })], wait }, { content: 'ok' }], seen)
    const meta = await controller.start(ws, 'first', opts('ask'))
    await until(() => seen.length === 1 || undefined)
    await controller.send(meta.id, 'also this')
    expect(events).toContainEqual({ type: 'queue', sessionId: meta.id, queue: [expect.objectContaining({ text: 'also this' })] })
    release()
    const snap = await idle(controller, meta.id)
    expect(userTexts(seen[1].messages)).toEqual(['first', 'also this'])
    expect(snap.session.items.filter((i) => i.kind === 'user').map((i) => i.kind === 'user' && i.text)).toEqual(['first', 'also this'])
    expect(snap.queue).toEqual([])
  })

  it('starts another turn when the agent finished without tools', async () => {
    let release!: () => void
    const wait = new Promise<void>((r) => (release = r))
    const seen: ChatRequest[] = []
    const controller = await setup([{ content: 'a', wait }, { content: 'b' }], seen)
    const meta = await controller.start(ws, 'first', opts('ask'))
    await until(() => seen.length === 1 || undefined)
    await controller.send(meta.id, 'second')
    release()
    await idle(controller, meta.id)
    expect(seen).toHaveLength(2)
    expect(userTexts(seen[1].messages)).toEqual(['first', 'second'])
  })

  it('gives queued messages back', async () => {
    let release!: () => void
    const wait = new Promise<void>((r) => (release = r))
    const seen: ChatRequest[] = []
    const controller = await setup([{ content: 'a', wait }], seen)
    const meta = await controller.start(ws, 'first', opts('ask'))
    await until(() => seen.length === 1 || undefined)
    await controller.send(meta.id, 'never mind')
    const taken = await controller.unqueue(meta.id)
    expect(taken.map((m) => m.text)).toEqual(['never mind'])
    release()
    await idle(controller, meta.id)
    expect(seen).toHaveLength(1)
  })
})

describe('to-do list', () => {
  it('keeps the list the agent writes', async () => {
    const todos = [
      { content: 'Read the code', status: 'completed' },
      { content: 'Fix the bug', status: 'in_progress' },
    ]
    const controller = await setup([{ toolCalls: [call('todo_write', { todos })] }, { content: 'done' }])
    const meta = await controller.start(ws, 'go', opts('ask'))
    const snap = await idle(controller, meta.id)
    expect(snap.session.todos).toEqual(todos)
    expect(snap.session.items[1]).toMatchObject({ kind: 'tool', name: 'todo_write', status: 'done', target: '1/2' })
  })

  it('tells the model when the list is malformed', async () => {
    const seen: ChatRequest[] = []
    const controller = await setup([{ toolCalls: [call('todo_write', { todos: [{ content: 'x', status: 'later' }] })] }, { content: 'ok' }], seen)
    const meta = await controller.start(ws, 'go', opts('ask'))
    await idle(controller, meta.id)
    expect((seen[1].messages.at(-1) as Extract<ChatMessage, { role: 'tool' }>).content).toMatch(/status/)
  })
})

describe('plan mode', () => {
  it('refuses edits, then switches mode when the plan is approved', async () => {
    const seen: ChatRequest[] = []
    const controller = await setup(
      [{ toolCalls: [edit('one', 'two')] }, { toolCalls: [call('exit_plan_mode', { plan: '# Plan\n\n1. Change a.txt' })] }, { toolCalls: [edit('one', 'two')] }, { content: 'done' }],
      seen,
    )
    const meta = await controller.start(ws, 'change it', opts('plan'))
    const request = await until(() => (permissionRequest()?.kind === 'plan' ? permissionRequest() : undefined))
    expect(request.plan).toContain('Change a.txt')
    expect(await readFile(path.join(ws, 'a.txt'), 'utf8')).toBe('one\n')
    expect(seen[0].tools?.map((t) => t.function.name)).toContain('exit_plan_mode')
    expect(seen[0].messages[0].content).toMatch(/Plan mode is on/)
    expect((seen[1].messages.at(-1) as Extract<ChatMessage, { role: 'tool' }>).content).toMatch(/plan mode is on/)

    controller.respond(meta.id, request.id, { type: 'allow', mode: 'acceptEdits' })
    const snap = await idle(controller, meta.id)
    expect(snap.session.permissionMode).toBe('acceptEdits')
    expect(await readFile(path.join(ws, 'a.txt'), 'utf8')).toBe('two\n')
    expect(seen[2].tools?.map((t) => t.function.name)).not.toContain('exit_plan_mode')
  })

  it('keeps planning when the plan is sent back with a note', async () => {
    const seen: ChatRequest[] = []
    const controller = await setup([{ toolCalls: [call('exit_plan_mode', { plan: 'v1' })] }, { content: 'revised' }], seen)
    const meta = await controller.start(ws, 'plan it', opts('plan'))
    const request = await until(permissionRequest)
    controller.respond(meta.id, request.id, { type: 'deny', feedback: 'add tests' })
    const snap = await idle(controller, meta.id)
    expect(snap.session.permissionMode).toBe('plan')
    expect((seen[1].messages.at(-1) as Extract<ChatMessage, { role: 'tool' }>).content).toMatch(/add tests/)
  })
})

describe('rewind', () => {
  async function twoTurns() {
    const seen: ChatRequest[] = []
    const controller = await setup([{ toolCalls: [edit('one', 'two')] }, { content: 'a' }, { toolCalls: [edit('two', 'three')] }, { content: 'b' }], seen)
    const meta = await controller.start(ws, 'first', opts('acceptEdits'))
    await idle(controller, meta.id)
    await controller.send(meta.id, 'second')
    const snap = await idle(controller, meta.id)
    expect(await readFile(path.join(ws, 'a.txt'), 'utf8')).toBe('three\n')
    const second = snap.session.items.filter((i) => i.kind === 'user')[1]
    return { controller, meta, second, seen }
  }

  it('puts back the conversation and the code', async () => {
    const { controller, meta, second } = await twoTurns()
    const result = await controller.rewind(meta.id, second.id, 'both')
    expect(result).toMatchObject({ ok: true, text: 'second', restored: 1 })
    expect(await readFile(path.join(ws, 'a.txt'), 'utf8')).toBe('two\n')
    const snap = await controller.snapshot(meta.id)
    expect(snap!.session.items.map((i) => i.kind)).toEqual(['user', 'tool', 'text'])
  })

  it('can put back only the code', async () => {
    const { controller, meta, second } = await twoTurns()
    await controller.rewind(meta.id, second.id, 'code')
    expect(await readFile(path.join(ws, 'a.txt'), 'utf8')).toBe('two\n')
    expect((await controller.snapshot(meta.id))!.session.items).toHaveLength(6)
  })

  it('sends only what is left after rewinding the conversation', async () => {
    const seen: ChatRequest[] = []
    const controller = await setup([{ content: 'a' }, { content: 'b' }, { content: 'c' }], seen)
    const meta = await controller.start(ws, 'first', opts('ask'))
    await idle(controller, meta.id)
    await controller.send(meta.id, 'second')
    const snap = await idle(controller, meta.id)
    const second = snap.session.items.filter((i) => i.kind === 'user')[1]
    await controller.rewind(meta.id, second.id, 'conversation')
    await controller.send(meta.id, 'instead')
    await idle(controller, meta.id)
    expect(userTexts(seen[2].messages)).toEqual(['first', 'instead'])
    expect(await readFile(path.join(ws, 'a.txt'), 'utf8')).toBe('one\n')
  })

  it('rewinds to the first message, back to the original file', async () => {
    const { controller, meta } = await twoTurns()
    const first = (await controller.snapshot(meta.id))!.session.items[0]
    await controller.rewind(meta.id, first.id, 'both')
    expect(await readFile(path.join(ws, 'a.txt'), 'utf8')).toBe('one\n')
    expect((await controller.snapshot(meta.id))!.session.items).toEqual([])
  })
})

describe('slash commands', () => {
  it('reads project commands with their descriptions', async () => {
    await mkdir(path.join(ws, '.dsh/commands'), { recursive: true })
    await mkdir(path.join(ws, '.claude/commands'), { recursive: true })
    await writeFile(path.join(ws, '.dsh/commands/fix-lint.md'), '---\ndescription: Fix lint errors\n---\nRun the linter and fix $ARGUMENTS\n')
    await writeFile(path.join(ws, '.claude/commands/explain.md'), '# Explain the code\n\nExplain it simply.\n')
    await writeFile(path.join(ws, '.claude/commands/compact.md'), 'shadowing a built-in\n')
    expect(await listCommands(ws)).toEqual([
      { name: 'fix-lint', description: 'Fix lint errors' },
      { name: 'explain', description: 'Explain the code' },
    ])
    expect(await expandCommand(ws, '/fix-lint src/a.ts')).toEqual({ name: 'fix-lint', prompt: 'Run the linter and fix src/a.ts' })
    expect((await expandCommand(ws, '/explain the parser'))?.prompt).toBe('# Explain the code\n\nExplain it simply.\n\nthe parser')
    expect(await expandCommand(ws, '/nope')).toBeNull()
    expect(await expandCommand(ws, 'not a command')).toBeNull()
  })

  it('expands built-in prompts and shows what was typed', async () => {
    const seen: ChatRequest[] = []
    const controller = await setup([{ content: 'ok' }], seen)
    const meta = await controller.start(ws, '/init', opts('ask'))
    const snap = await idle(controller, meta.id)
    expect(snap.session.items[0]).toMatchObject({ kind: 'user', text: '/init', command: 'init' })
    expect(userTexts(seen[0].messages)[0]).toMatch(/AGENTS\.md/)
  })

  it('parses front matter without a description', () => {
    expect(parseCommand('x', '---\nmodel: a\n---\n\nDo it\n')).toEqual({ name: 'x', description: 'Do it', body: 'Do it' })
  })
})
