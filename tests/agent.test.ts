import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apiHistory } from '../src/main/agent'
import { COMPACT_SYSTEM, compactedMessages, splitForCompact } from '../src/main/compact'
import { Controller } from '../src/main/controller'
import { DeepSeekError, type ApiUsage, type ChatMessage, type ChatRequest, type ChatResult, type StreamHandlers } from '../src/main/deepseek'
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

type Step = Partial<ChatResult> & { reasoningText?: string; error?: Error; tokens?: number; stream?: Array<[index: number, name: string, args: string]> }

/** A fake DeepSeek that answers each request with the next scripted step. */
function scripted(steps: Step[], seen: ChatRequest[] = []) {
  return async (request: ChatRequest, handlers: StreamHandlers = {}): Promise<ChatResult> => {
    seen.push(JSON.parse(JSON.stringify({ ...request, signal: undefined })))
    const step = steps.shift()
    if (!step) throw new Error('No more scripted steps')
    if (step.error) throw step.error
    if (step.reasoningText) handlers.onReasoning?.(step.reasoningText)
    if (step.content) handlers.onContent?.(step.content)
    for (const [index, name, args] of step.stream ?? []) {
      handlers.onToolCall?.(index, name)
      handlers.onToolArguments?.(index, args)
    }
    return {
      content: step.content ?? '',
      reasoning: step.reasoningText ?? '',
      toolCalls: step.toolCalls ?? [],
      toolCallIndexes: step.toolCallIndexes,
      finishReason: step.finishReason ?? (step.toolCalls?.length ? 'tool_calls' : 'stop'),
      usage: { prompt_tokens: step.tokens ?? 10, completion_tokens: 5, total_tokens: (step.tokens ?? 10) + 5 } satisfies ApiUsage,
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

const opts = (permissionMode: 'ask' | 'acceptEdits') => ({ id: randomUUID(), model: 'deepseek-chat', permissionMode })

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
    const meta = await controller.start(ws, '把 old 改成 new', opts('ask'))

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
    const meta = await controller.start(ws, 'edit it', opts('ask'))
    const request = await until(permissionRequest)
    controller.respond(meta.id, request.id, { type: 'deny' })
    const snap = await idle(controller, meta.id)
    expect(snap.session.items.at(-1)).toMatchObject({ kind: 'tool', status: 'denied' })
    expect(await readFile(path.join(ws, 'a.txt'), 'utf8')).toBe('old\n')
  })

  it('runs edits without asking in acceptEdits mode', async () => {
    const { controller } = await setup([{ toolCalls: [editCall] }, { content: 'done' }])
    const meta = await controller.start(ws, 'edit it', opts('acceptEdits'))
    await idle(controller, meta.id)
    expect(permissionRequest()).toBeUndefined()
    expect(await readFile(path.join(ws, 'a.txt'), 'utf8')).toBe('new\n')
  })

  it('stops while waiting for permission', async () => {
    const { controller } = await setup([{ toolCalls: [editCall] }])
    const meta = await controller.start(ws, 'edit it', opts('ask'))
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
    const meta = await controller.start(ws, 'hi', opts('ask'))
    const snap = await idle(controller, meta.id)
    expect(snap.session.items.at(-1)).toMatchObject({ kind: 'error', code: 'no-key' })
  })

  it('uses the id the renderer picked', async () => {
    const { controller } = await setup([{ content: 'hi' }])
    const options = opts('ask')
    const meta = await controller.start(ws, 'hello', options)
    expect(meta.id).toBe(options.id)
    await idle(controller, meta.id)
  })

  it('removes the error when retrying', async () => {
    const { controller, settings } = await setup([{ content: 'back' }], [], false)
    const meta = await controller.start(ws, 'hi', opts('ask'))
    const failed = await idle(controller, meta.id)
    const error = failed.session.items.at(-1)!
    expect(error.kind).toBe('error')

    await settings.setApiKey('sk-test')
    events = []
    await controller.retry(meta.id)
    const snap = await idle(controller, meta.id)
    expect(events).toContainEqual({ type: 'remove', sessionId: meta.id, itemId: error.id })
    expect(snap.session.items.map((i) => i.kind)).toEqual(['user', 'text'])
  })

  it('reports a tool error back to the model and keeps going', async () => {
    const seen: ChatRequest[] = []
    const bad = { id: 'c2', type: 'function' as const, function: { name: 'read_file', arguments: JSON.stringify({ path: 'missing.txt' }) } }
    const { controller } = await setup([{ toolCalls: [bad] }, { content: 'ok' }], seen)
    const meta = await controller.start(ws, 'read', opts('ask'))
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

describe('compacting', () => {
  it('summarises the history before a request once the context is nearly full', async () => {
    const seen: ChatRequest[] = []
    const { controller } = await setup([{ content: 'first', tokens: 110_000 }, { content: 'SUMMARY' }, { content: 'second' }], seen)
    const meta = await controller.start(ws, 'one', opts('ask'))
    await idle(controller, meta.id)
    events = []
    await controller.send(meta.id, 'two')
    const snap = await idle(controller, meta.id)

    expect(seen[1].messages[0]).toEqual({ role: 'system', content: COMPACT_SYSTEM })
    expect(seen[1].tools).toBeUndefined()
    const after = seen[2].messages
    expect(after.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(after[1].content).toContain('SUMMARY')
    expect(after[3].content).toBe('two')
    expect(snap.session.items.map((i) => i.kind)).toEqual(['user', 'text', 'user', 'compact', 'text'])
    expect(snap.session.items[3]).toMatchObject({ kind: 'compact', auto: true, status: 'done', summary: 'SUMMARY', before: 110_005 })
  })

  it('compacts on request with the focus the person gave', async () => {
    const seen: ChatRequest[] = []
    const { controller } = await setup([{ content: 'done' }, { content: 'SUMMARY' }], seen)
    const meta = await controller.start(ws, 'one', opts('ask'))
    await idle(controller, meta.id)
    events = []
    await controller.compact(meta.id, 'the login bug')
    const snap = await idle(controller, meta.id)
    expect(seen[1].messages[1].content).toContain('focus on: the login bug')
    expect(snap.session.items.at(-1)).toMatchObject({ kind: 'compact', auto: false, status: 'done' })
  })

  it('compacts and asks again when the request is too long for the model', async () => {
    const seen: ChatRequest[] = []
    const overflow = new DeepSeekError('bad-request', "This model's maximum context length is 131072 tokens", 400)
    const { controller } = await setup([{ content: 'a' }, { error: overflow }, { content: 'SUMMARY' }, { content: 'b' }], seen)
    const meta = await controller.start(ws, 'one', opts('ask'))
    await idle(controller, meta.id)
    events = []
    await controller.send(meta.id, 'two')
    const snap = await idle(controller, meta.id)
    expect(snap.session.items.map((i) => i.kind)).toEqual(['user', 'text', 'user', 'compact', 'text'])
    expect(seen[3].messages.at(-1)).toEqual({ role: 'user', content: 'two' })
  })

  it('keeps an unanswered message out of the summary and asks the model to continue a cut-off turn', () => {
    const user: ChatMessage = { role: 'user', content: 'next' }
    const history: ChatMessage[] = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'list_dir', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c', content: 'a.txt' },
    ]
    expect(splitForCompact([...history, user])).toEqual({ history, held: user })
    const midTurn = compactedMessages('S', history, null)
    expect(midTurn).toHaveLength(1)
    expect(midTurn[0].content).toMatch(/Continue the work/)
    expect(compactedMessages('S', history.slice(0, 1), user).map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
  })
})

describe('artifacts in the agent loop', () => {
  const call = (id: string, args: Record<string, unknown> | string) => ({
    id,
    type: 'function' as const,
    function: { name: 'artifact', arguments: typeof args === 'string' ? args : JSON.stringify(args) },
  })
  const create = { command: 'create', id: 'timer', title: '番茄鐘', type: 'html', content: '<b>25:00</b>' }

  it('answers a call cut off at the output limit instead of running it, and keeps its half out of the history', async () => {
    const seen: ChatRequest[] = []
    const cut = call('c2', '{"command":"create","id":"big","title":"Big","type":"html","content":"<p>so much')
    const { controller } = await setup([{ toolCalls: [call('c1', create), cut], finishReason: 'length' }, { content: '好' }], seen)
    const meta = await controller.start(ws, 'make two', opts('ask'))
    const snap = await idle(controller, meta.id)
    const tools = snap.session.items.filter((i) => i.kind === 'tool')
    expect(tools).toMatchObject([
      { status: 'done', artifact: { id: 'timer', version: 1 } },
      { status: 'error', error: expect.stringMatching(/output limit/) },
    ])
    const assistant = seen[1].messages.find((m) => m.role === 'assistant' && m.tool_calls) as Extract<ChatMessage, { role: 'assistant' }>
    expect(assistant.tool_calls?.map((c) => c.function.arguments)).toEqual([JSON.stringify(create), '{}'])
    expect(seen[1].messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'c2', content: expect.stringMatching(/output limit/) })
  })

  it('shows reading an artifact as its own step, not a new version', async () => {
    const { controller } = await setup([{ toolCalls: [call('c1', create)] }, { toolCalls: [call('c2', { command: 'view', id: 'timer' })] }, { content: 'ok' }])
    const meta = await controller.start(ws, 'look', opts('ask'))
    const snap = await idle(controller, meta.id)
    const view = snap.session.items.find((i) => i.kind === 'tool' && i.callId === 'c2')
    expect(view).toMatchObject({ name: 'artifact_view', status: 'done', info: { lines: 1 } })
    expect(view && 'artifact' in view ? view.artifact : undefined).toBeUndefined()
  })

  it('drafts artifacts in the order of their calls, after other tools and reads', async () => {
    const second = { ...create, id: 'notes', title: 'Notes', type: 'markdown', content: '# hi' }
    const { controller } = await setup([
      {
        stream: [
          [0, 'read_file', '{"path":"a.txt"}'],
          [1, 'artifact', '{"command":"view","id":"x"}'],
          [2, 'artifact', JSON.stringify(create)],
          [3, 'artifact', JSON.stringify(second)],
        ],
        toolCalls: [
          { id: 'r', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } },
          call('v', { command: 'view', id: 'timer' }),
          call('a', create),
          call('b', second),
        ],
        toolCallIndexes: [0, 1, 2, 3],
      },
      { content: 'done' },
    ])
    const meta = await controller.start(ws, 'make', opts('ask'))
    const snap = await idle(controller, meta.id)
    const artifacts = snap.session.items.filter((i) => i.kind === 'tool' && i.artifact)
    expect(artifacts.map((i) => (i.kind === 'tool' ? [i.callId, i.artifact?.id, i.status] : null))).toEqual([
      ['a', 'timer', 'done'],
      ['b', 'notes', 'done'],
    ])
    // Both were drafted while the reply streamed, so their cards came before the steps that ran after it.
    const at = (callId: string) => snap.session.items.findIndex((i) => i.kind === 'tool' && i.callId === callId)
    expect(at('a')).toBeLessThan(at('r'))
    expect(at('b')).toBeLessThan(at('r'))
  })

  // Every version of an artifact card that reached the panel, in order.
  const drafted = (callIdOrTitle?: string) =>
    events.flatMap((e) => (e.type === 'item' && e.item.kind === 'tool' && e.item.artifact && (!callIdOrTitle || e.item.callId === callIdOrTitle || e.item.callId === '') ? [{ ...e.item.artifact, status: e.item.status, queued: e.item.queued }] : []))

  it('drafts a change only once its id has arrived, so it never shows as another artifact', async () => {
    const update = { command: 'update', id: 'timer', old_str: '25:00', new_str: '50:00' }
    const { controller } = await setup([
      { toolCalls: [call('c1', create)] },
      {
        stream: [
          [0, 'artifact', '{"command":"update","id":"'],
          [0, 'artifact', '{"command":"update","id":"tim'],
          [0, 'artifact', '{"command":"update","id":"timer","old_str":"25'],
          [0, 'artifact', JSON.stringify(update)],
        ],
        toolCalls: [call('c2', update)],
      },
      { content: 'ok' },
    ])
    const meta = await controller.start(ws, 'make it longer', opts('ask'))
    await idle(controller, meta.id)
    const second = drafted().filter((a) => a.version === 2)
    expect(second.length).toBeGreaterThan(0)
    expect(drafted().every((a) => a.id === 'timer' && a.type === 'html')).toBe(true)
    expect(second.at(-1)).toMatchObject({ status: 'done', content: '<b>50:00</b>' })
  })

  it('builds a change on a version made earlier in the same reply', async () => {
    const update = { command: 'update', id: 'timer', old_str: '25:00', new_str: '50:00' }
    const { controller } = await setup([
      {
        stream: [
          [0, 'artifact', JSON.stringify(create)],
          [1, 'artifact', '{"command":"update","id":"timer"'],
          [1, 'artifact', JSON.stringify(update)],
        ],
        toolCalls: [call('a', create), call('b', update)],
        toolCallIndexes: [0, 1],
      },
      { content: 'ok' },
    ])
    const meta = await controller.start(ws, 'make', opts('ask'))
    const snap = await idle(controller, meta.id)
    // The update was never an empty first version of a code artifact.
    expect(drafted().filter((a) => a.version === 1).every((a) => a.type === 'html' && a.content === '<b>25:00</b>')).toBe(true)
    expect(drafted().filter((a) => a.version === 2).every((a) => a.type === 'html' && a.title === '番茄鐘')).toBe(true)
    const tools = snap.session.items.filter((i) => i.kind === 'tool')
    expect(tools).toMatchObject([
      { callId: 'a', status: 'done', artifact: { version: 1 } },
      { callId: 'b', status: 'done', artifact: { version: 2, content: '<b>50:00</b>' } },
    ])
  })

  it('gives no draft to a change of an artifact that does not exist', async () => {
    const update = { command: 'update', id: 'nope', old_str: 'a', new_str: 'b' }
    const { controller } = await setup([{ stream: [[0, 'artifact', JSON.stringify(update)]], toolCalls: [call('c1', update)] }, { content: 'ok' }])
    const meta = await controller.start(ws, 'change it', opts('ask'))
    const snap = await idle(controller, meta.id)
    expect(drafted()).toEqual([])
    expect(snap.session.items.find((i) => i.kind === 'tool')).toMatchObject({ callId: 'c1', status: 'error' })
  })

  it('marks an artifact that waits behind another step as queued, not still writing', async () => {
    const { controller } = await setup([
      {
        stream: [
          [0, 'edit_file', editCall.function.arguments],
          [1, 'artifact', JSON.stringify(create)],
        ],
        toolCalls: [editCall, call('a', create)],
        toolCallIndexes: [0, 1],
      },
      { content: 'ok' },
    ])
    const meta = await controller.start(ws, 'edit then make', opts('ask'))
    const request = await until(permissionRequest)
    const waiting = (await controller.snapshot(meta.id))!.session.items.find((i) => i.kind === 'tool' && i.callId === 'a')
    expect(waiting).toMatchObject({ status: 'running', queued: true })
    controller.respond(meta.id, request.id, { type: 'allow' })
    const snap = await idle(controller, meta.id)
    const made = snap.session.items.find((i) => i.kind === 'tool' && i.callId === 'a')
    expect(made).toMatchObject({ status: 'done' })
    expect(made && 'queued' in made ? made.queued : undefined).toBeUndefined()
  })

  it('does not queue an artifact that only follows other artifacts', async () => {
    const second = { ...create, id: 'notes', title: 'Notes', type: 'markdown', content: '# hi' }
    const { controller } = await setup([
      {
        stream: [
          [0, 'artifact', JSON.stringify(create)],
          [1, 'artifact', JSON.stringify(second)],
        ],
        toolCalls: [call('a', create), call('b', second)],
        toolCallIndexes: [0, 1],
      },
      { content: 'ok' },
    ])
    const meta = await controller.start(ws, 'make two', opts('ask'))
    await idle(controller, meta.id)
    expect(drafted().some((a) => a.queued)).toBe(false)
  })
})

describe('the output limit', () => {
  it('says so when a reply stops at the limit with nothing to run', async () => {
    const { controller } = await setup([{ content: '寫到一半', finishReason: 'length' }])
    const meta = await controller.start(ws, 'write a lot', opts('ask'))
    const snap = await idle(controller, meta.id)
    expect(snap.session.items.at(-1)).toMatchObject({ kind: 'notice', code: 'length' })
  })

  it('stays quiet when a reply simply ends', async () => {
    const { controller } = await setup([{ content: '好了' }])
    const meta = await controller.start(ws, 'hi', opts('ask'))
    const snap = await idle(controller, meta.id)
    expect(snap.session.items.some((i) => i.kind === 'notice')).toBe(false)
  })
})
