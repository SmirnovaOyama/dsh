import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apiHistory } from '../src/main/agent'
import { Controller } from '../src/main/controller'
import type { ChatMessage, ChatRequest, ChatResult, StreamHandlers } from '../src/main/deepseek'
import { SessionStore, SettingsStore } from '../src/main/store'
import type { AgentEvent, PermissionRequest, TranscriptItem } from '../src/shared/types'

const plainCipher = { available: () => false, encrypt: (s: string) => s, decrypt: (s: string) => s }

let root: string
let ws: string
let events: AgentEvent[]

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'dsh-app-'))
  ws = await mkdtemp(path.join(tmpdir(), 'dsh-ws-'))
  await writeFile(path.join(ws, 'a.txt'), 'old\n')
  events = []
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(ws, { recursive: true, force: true })
})

type Step = Partial<ChatResult> & { reasoningText?: string }

/** A fake DeepSeek that answers each request with the next scripted step. */
function scripted(steps: Step[], seen: ChatRequest[] = []) {
  return async (request: ChatRequest, handlers: StreamHandlers = {}): Promise<ChatResult> => {
    seen.push(JSON.parse(JSON.stringify({ ...request, signal: undefined })))
    const step = steps.shift()
    if (!step) throw new Error('No more scripted steps')
    if (step.reasoningText) handlers.onReasoning?.(step.reasoningText)
    if (step.content) handlers.onContent?.(step.content)
    return {
      content: step.content ?? '',
      reasoning: step.reasoningText ?? '',
      toolCalls: step.toolCalls ?? [],
      finishReason: step.toolCalls?.length ? 'tool_calls' : 'stop',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }
  }
}

async function setup(steps: Step[], seen: ChatRequest[] = [], withKey = true) {
  const settings = new SettingsStore(root, plainCipher)
  await settings.load()
  if (withKey) await settings.setApiKey('sk-test')
  const sessions = new SessionStore(root)
  await sessions.load()
  const controller = new Controller({ settings, sessions, emit: (e) => events.push(e), chat: scripted(steps, seen) })
  return { controller, settings, sessions }
}

const editCall = {
  id: 'call_1',
  type: 'function' as const,
  function: { name: 'edit_file', arguments: JSON.stringify({ path: 'a.txt', old_string: 'old', new_string: 'new' }) },
}

async function until<T>(find: () => T | undefined, timeout = 2000): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = find()
    if (value) return value
    if (Date.now() - started > timeout) throw new Error('Timed out waiting')
    await new Promise((r) => setTimeout(r, 5))
  }
}

const permissionRequest = () =>
  [...events].reverse().find((e): e is Extract<AgentEvent, { type: 'permission' }> => e.type === 'permission' && e.request !== null)?.request as
    | PermissionRequest
    | undefined

async function idle(controller: Controller, id: string) {
  await until(() => events.some((e) => e.type === 'meta' && e.meta.id === id && e.meta.status === 'idle') || undefined)
  return (await controller.snapshot(id))!
}

describe('agent loop', () => {
  it('asks before an edit, applies it when allowed, then answers', async () => {
    const seen: ChatRequest[] = []
    const { controller } = await setup([{ content: '我來改', toolCalls: [editCall] }, { content: '改好了' }], seen)
    const meta = await controller.start(ws, '把 old 改成 new', { model: 'deepseek-chat', permissionMode: 'ask' })

    const request = await until(permissionRequest)
    expect(request).toMatchObject({ kind: 'edit', path: 'a.txt', stats: { added: 1, removed: 1 } })
    expect(await readFile(path.join(ws, 'a.txt'), 'utf8')).toBe('old\n')

    controller.respond(meta.id, request.id, { type: 'allow' })
    const snap = await idle(controller, meta.id)

    expect(await readFile(path.join(ws, 'a.txt'), 'utf8')).toBe('new\n')
    expect(snap.session.title).toBe('把 old 改成 new')
    expect(snap.session.items.map((i: TranscriptItem) => i.kind)).toEqual(['user', 'text', 'tool', 'text'])
    expect(snap.session.items[2]).toMatchObject({ kind: 'tool', status: 'done', path: 'a.txt' })
    expect(snap.changes.map((c) => c.path)).toEqual(['a.txt'])
    const roles = seen[1].messages.map((m: ChatMessage) => m.role)
    expect(roles).toEqual(['system', 'user', 'assistant', 'tool'])
  })

  it('ends the turn when an edit is declined without a reason', async () => {
    const { controller } = await setup([{ toolCalls: [editCall] }])
    const meta = await controller.start(ws, 'edit it', { model: 'deepseek-chat', permissionMode: 'ask' })
    const request = await until(permissionRequest)
    controller.respond(meta.id, request.id, { type: 'deny' })
    const snap = await idle(controller, meta.id)
    expect(snap.session.items.at(-1)).toMatchObject({ kind: 'tool', status: 'denied' })
    expect(await readFile(path.join(ws, 'a.txt'), 'utf8')).toBe('old\n')
  })

  it('runs edits without asking in acceptEdits mode', async () => {
    const { controller } = await setup([{ toolCalls: [editCall] }, { content: 'done' }])
    const meta = await controller.start(ws, 'edit it', { model: 'deepseek-chat', permissionMode: 'acceptEdits' })
    await idle(controller, meta.id)
    expect(permissionRequest()).toBeUndefined()
    expect(await readFile(path.join(ws, 'a.txt'), 'utf8')).toBe('new\n')
  })

  it('stops while waiting for permission', async () => {
    const { controller } = await setup([{ toolCalls: [editCall] }])
    const meta = await controller.start(ws, 'edit it', { model: 'deepseek-chat', permissionMode: 'ask' })
    await until(permissionRequest)
    controller.stop(meta.id)
    const snap = await idle(controller, meta.id)
    expect(snap.session.items.slice(-2)).toMatchObject([
      { kind: 'tool', status: 'stopped' },
      { kind: 'notice', code: 'stopped' },
    ])
    expect(snap.permission).toBeNull()
  })

  it('shows an error when there is no API key', async () => {
    const { controller } = await setup([], [], false)
    const meta = await controller.start(ws, 'hi', { model: 'deepseek-chat', permissionMode: 'ask' })
    const snap = await idle(controller, meta.id)
    expect(snap.session.items.at(-1)).toMatchObject({ kind: 'error', code: 'no-key' })
  })

  it('reports a tool error back to the model and keeps going', async () => {
    const seen: ChatRequest[] = []
    const bad = { id: 'c2', type: 'function' as const, function: { name: 'read_file', arguments: JSON.stringify({ path: 'missing.txt' }) } }
    const { controller } = await setup([{ toolCalls: [bad] }, { content: 'ok' }], seen)
    const meta = await controller.start(ws, 'read', { model: 'deepseek-chat', permissionMode: 'ask' })
    const snap = await idle(controller, meta.id)
    expect(snap.session.items[1]).toMatchObject({ kind: 'tool', status: 'error' })
    const toolMessage = seen[1].messages.at(-1) as Extract<ChatMessage, { role: 'tool' }>
    expect(toolMessage.content).toMatch(/^Error: missing.txt does not exist/)
  })
})

describe('apiHistory', () => {
  const history: ChatMessage[] = [
    { role: 'user', content: 'one' },
    { role: 'assistant', content: 'a', reasoning_content: 'old thoughts' },
    { role: 'user', content: 'two' },
    { role: 'assistant', content: '', reasoning_content: 'current thoughts', tool_calls: [editCall] },
    { role: 'tool', tool_call_id: 'call_1', content: 'ok' },
  ]

  it('keeps only the current turn reasoning for thinking models', () => {
    const out = apiHistory(history, 'deepseek-reasoner')
    expect(out[1]).not.toHaveProperty('reasoning_content')
    expect(out[3]).toHaveProperty('reasoning_content', 'current thoughts')
  })

  it('drops reasoning for other models', () => {
    const out = apiHistory(history, 'deepseek-chat')
    expect(out.some((m) => 'reasoning_content' in m)).toBe(false)
  })
})
