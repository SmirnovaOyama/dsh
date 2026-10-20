// The agent loop: ask DeepSeek, run the tools it calls (asking first where needed), repeat until it answers.

import { randomUUID } from 'node:crypto'
import type {
  AgentEvent,
  ArtifactVersion,
  Effort,
  ErrorCode,
  FileRef,
  PermissionDecision,
  QueuedMessage,
  SessionData,
  SessionStatus,
  Settings,
  TranscriptItem,
} from '../shared/types'
import type { ChangeTracker } from './changes'
import { compactAt, compactedMessages, isContextOverflow, splitForCompact, summaryRequest } from './compact'
import { DeepSeekError, streamChat, type ApiUsage, type ChatMessage, type ChatResult, type ToolCall } from './deepseek'
import { needsApproval, planModeRefusal } from './permissions'
import { withRefs } from './refs'
import { ToolError, prepareToolCall, toolSpecs, type PermissionNeed, type PreparedCall } from './tools'
import { draftArtifact, nextArtifact, streamedCommand, streamedId } from './tools/artifact'

const MAX_TOOL_RESULT_CHARS = 60_000
const STREAM_FLUSH_MS = 50

export type ToolItem = Extract<TranscriptItem, { kind: 'tool' }>
type ReasoningItem = Extract<TranscriptItem, { kind: 'reasoning' }>
type TextItem = Extract<TranscriptItem, { kind: 'text' }>
type CompactItem = Extract<TranscriptItem, { kind: 'compact' }>

/** The request was too long for the model; compacting and asking again may help. */
const OVERFLOW = Symbol('overflow')

export interface SessionState {
  data: SessionData
  /** Conversation in API form, without the system prompt. */
  messages: ChatMessage[]
  tracker: ChangeTracker
  allowEdits: boolean
  allowedPrefixes: string[]
  controller: AbortController | null
  /** Messages typed while the agent works, sent in at its next step. */
  queue: QueuedMessage[]
  /** Where each message of the person's starts in `messages`, for rewinding the conversation. */
  marks: Record<string, number>
}

export interface AgentHost {
  settings(): Settings
  apiKey(): string | null
  emit(event: AgentEvent): void
  persist(state: SessionState): void
  systemPrompt(state: SessionState): Promise<string>
  askPermission(state: SessionState, need: PermissionNeed, toolItemId: string, signal: AbortSignal): Promise<PermissionDecision>
  allowCommandAlways(prefix: string): void
  changesUpdated(state: SessionState): void
  /** A custom slash command's prompt for this text, or null when it is not one. */
  expandCommand?(state: SessionState, text: string): Promise<{ name: string; prompt: string } | null>
  chat?: typeof streamChat
  now?: () => number
}

export function temperatureFor(style: Settings['replyStyle']): number {
  return style === 'varied' ? 1.3 : style === 'balanced' ? 0.7 : 0
}

export function thinks(effort: Effort): boolean {
  return effort !== 'none'
}

/**
 * Thinking models need the reasoning of the current turn sent back between tool calls,
 * but not the reasoning of earlier turns. Other models never get it.
 */
export function apiHistory(messages: ChatMessage[], thinking: boolean): ChatMessage[] {
  const keepReasoning = thinking
  let lastUser = -1
  messages.forEach((m, i) => {
    if (m.role === 'user') lastUser = i
  })
  return messages.map((m, i) => {
    if (m.role !== 'assistant' || m.reasoning_content === undefined) return m
    if (keepReasoning && i > lastUser) return m
    const { reasoning_content: _dropped, ...rest } = m
    return rest
  })
}

export function titleFrom(text: string): string {
  const firstLine = text.trim().split('\n')[0].trim()
  return firstLine.length > 40 ? firstLine.slice(0, 40) : firstLine || 'New conversation'
}

function errorCode(error: unknown): ErrorCode {
  if (error instanceof DeepSeekError && error.code !== 'aborted') return error.code
  return 'unknown'
}

/** The latest finished version of each artifact in the conversation. */
export function latestArtifacts(items: TranscriptItem[]): (id: string) => ArtifactVersion | undefined {
  return (id) => {
    let latest: ArtifactVersion | undefined
    for (const item of items) {
      if (item.kind === 'tool' && item.status === 'done' && item.artifact?.id === id && (!latest || item.artifact.version >= latest.version)) latest = item.artifact
    }
    return latest
  }
}

/** A list of the artifacts made so far, kept with a summary so the model still knows what it can view and change. */
export function artifactNote(items: TranscriptItem[]): string {
  const latest = new Map<string, ArtifactVersion>()
  for (const item of items) {
    if (item.kind !== 'tool' || item.status !== 'done' || !item.artifact) continue
    const known = latest.get(item.artifact.id)
    if (!known || item.artifact.version >= known.version) latest.set(item.artifact.id, item.artifact)
  }
  if (!latest.size) return ''
  const list = [...latest.values()].map((a) => `- ${a.id}: ${a.title} (${a.type}, version ${a.version})`).join('\n')
  return `Artifacts in this conversation. Call the artifact tool's view command to read one before you change it.\n${list}`
}

const CUT_OFF =
  'Your reply reached the output limit and this call was cut off before its arguments were complete, so it was not run. Make it smaller: for an artifact, create a working first version and add to it with update.'

/** The name a tool row shows: reading an artifact is a different action from writing one. */
function itemName(call: ToolCall): string {
  return call.function.name === 'artifact' && streamedCommand(call.function.arguments) === 'view' ? 'artifact_view' : call.function.name
}

function clip(text: string): string {
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text
  const half = MAX_TOOL_RESULT_CHARS / 2
  return `${text.slice(0, half)}\n\n[${text.length - MAX_TOOL_RESULT_CHARS} characters omitted]\n\n${text.slice(-half)}`
}

export class Agent {
  private readonly now: () => number
  private readonly chat: typeof streamChat
  private pending = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private readonly host: AgentHost) {
    this.now = host.now ?? Date.now
    this.chat = host.chat ?? streamChat
  }

  isRunning(state: SessionState): boolean {
    return state.controller !== null
  }

  async send(state: SessionState, text: string, refs: FileRef[] = []): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) return
    if (this.isRunning(state)) {
      // Like Claude Code: what is typed meanwhile waits and goes in at the agent's next step.
      state.queue.push({ id: randomUUID(), text: trimmed, ...(refs.length ? { refs } : {}) })
      this.emitQueue(state)
      return
    }
    // Claim the session now, so a second message sent while the files are read is queued, not lost.
    state.controller = new AbortController()
    try {
      await this.drain(state)
      await this.addUser(state, { id: randomUUID(), text: trimmed, refs })
    } finally {
      state.controller = null
    }
    await this.run(state)
  }

  /** Takes queued messages back before they are sent: one of them, or all. */
  unqueue(state: SessionState, messageId?: string): QueuedMessage[] {
    const taken = messageId ? state.queue.filter((m) => m.id === messageId) : state.queue
    state.queue = messageId ? state.queue.filter((m) => m.id !== messageId) : []
    if (taken.length) this.emitQueue(state)
    return taken
  }

  private async addUser(state: SessionState, message: { id: string; text: string; refs?: FileRef[] }): Promise<void> {
    const refs = message.refs ?? []
    const command = (await this.host.expandCommand?.(state, message.text)) ?? null
    const content = await withRefs(state.data.workspace, command?.prompt ?? message.text, refs)
    if (!state.data.items.some((item) => item.kind === 'user')) state.data.title = titleFrom(message.text)
    state.marks[message.id] = state.messages.length
    state.tracker.checkpoint(message.id)
    this.add(state, {
      kind: 'user',
      id: message.id,
      text: message.text,
      at: this.now(),
      ...(refs.length ? { refs } : {}),
      ...(command ? { command: command.name } : {}),
    })
    state.messages.push({ role: 'user', content })
  }

  /** Sends in the messages that were queued. Returns whether there were any. */
  private async drain(state: SessionState): Promise<boolean> {
    if (!state.queue.length) return false
    const queued = state.queue
    state.queue = []
    this.emitQueue(state)
    for (const message of queued) await this.addUser(state, message)
    this.host.persist(state)
    return true
  }

  private emitQueue(state: SessionState): void {
    this.host.emit({ type: 'queue', sessionId: state.data.id, queue: state.queue.map((m) => ({ ...m })) })
  }

  /** Runs the loop again from where it stopped: after an error, or after the step limit. */
  async resume(state: SessionState): Promise<void> {
    if (this.isRunning(state)) return
    const lastMessage = state.messages[state.messages.length - 1]
    if (!lastMessage || lastMessage.role === 'assistant') return
    const last = state.data.items[state.data.items.length - 1]
    if (last && (last.kind === 'error' || last.kind === 'notice')) {
      state.data.items.pop()
      this.host.emit({ type: 'remove', sessionId: state.data.id, itemId: last.id })
    }
    this.host.persist(state)
    await this.run(state)
  }

  stop(state: SessionState): void {
    state.controller?.abort()
  }

  /** Summarises the conversation now, as /compact does. */
  async compact(state: SessionState, focus?: string): Promise<void> {
    if (this.isRunning(state)) return
    if (!state.messages.some((m) => m.role === 'assistant')) return
    await this.work(state, async (signal) => {
      if (!this.host.apiKey()) {
        this.add(state, { kind: 'error', id: randomUUID(), code: 'no-key', retryable: false })
        return
      }
      await this.summarize(state, signal, false, typeof focus === 'string' ? focus : undefined)
      if (signal.aborted) this.add(state, { kind: 'notice', id: randomUUID(), code: 'stopped' })
    })
  }

  private async work(state: SessionState, task: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const controller = new AbortController()
    state.controller = controller
    this.setStatus(state, 'running')
    try {
      await task(controller.signal)
    } finally {
      state.controller = null
      this.setStatus(state, 'idle')
      this.host.persist(state)
    }
  }

  private run(state: SessionState): Promise<void> {
    return this.work(state, async (signal) => {
      let steps = 0
      let autoCompactFailed = false
      let overflowRetried = false
      for (;;) {
        const settings = this.host.settings()
        if (steps >= settings.maxSteps) {
          this.add(state, { kind: 'notice', id: randomUUID(), code: 'max-steps' })
          break
        }
        if (!autoCompactFailed && state.data.usage.contextTokens >= compactAt(state.data.model) && this.host.apiKey()) {
          // A failed compaction leaves the history as it was, and the request may still fit.
          autoCompactFailed = !(await this.summarize(state, signal, true))
          if (signal.aborted) {
            this.add(state, { kind: 'notice', id: randomUUID(), code: 'stopped' })
            break
          }
        }
        steps++
        const drafts = new Map<string, ToolItem>()
        const result = await this.request(state, settings, signal, !overflowRetried, drafts)
        if (result === OVERFLOW) {
          overflowRetried = true
          steps--
          if (await this.summarize(state, signal, true)) continue
          if (signal.aborted) this.add(state, { kind: 'notice', id: randomUUID(), code: 'stopped' })
          else this.add(state, { kind: 'error', id: randomUUID(), code: 'bad-request', detail: 'The conversation is longer than the model accepts.', retryable: true })
          break
        }
        if (!result) break
        if (!result.toolCalls.length) {
          // The reply stopped at the output limit; say so, with a way to go on.
          if (result.finishReason === 'length') this.add(state, { kind: 'notice', id: randomUUID(), code: 'length' })
          // Messages typed during the last step start the next one.
          if (await this.drain(state)) continue
          break
        }
        // At the output limit the last call is cut off mid-arguments; it is answered, not run.
        const cutOff = result.finishReason === 'length' ? result.toolCalls[result.toolCalls.length - 1].id : null
        const keepGoing = await this.runTools(state, result.toolCalls, signal, drafts, cutOff)
        if (signal.aborted) break
        const queued = await this.drain(state)
        if (!keepGoing && !queued) break
      }
    })
  }

  /** Replaces the history the model sees with a summary. Returns whether it worked. */
  private async summarize(state: SessionState, signal: AbortSignal, auto: boolean, focus?: string): Promise<boolean> {
    const apiKey = this.host.apiKey()
    const { history, held } = splitForCompact(state.messages)
    if (!apiKey || !history.some((m) => m.role === 'assistant')) return false
    const item = this.add<CompactItem>(state, {
      kind: 'compact',
      id: randomUUID(),
      at: this.now(),
      auto,
      status: 'running',
      before: state.data.usage.contextTokens,
    })
    try {
      const settings = this.host.settings()
      const { model, effort } = state.data
      const result = await this.chat({
        baseUrl: settings.baseUrl,
        apiKey,
        model,
        effort,
        messages: summaryRequest(history, focus),
        temperature: thinks(effort) ? undefined : 0,
        signal,
      })
      const summary = result.content.trim()
      if (!summary) throw new Error('The model returned an empty summary.')
      const note = artifactNote(state.data.items)
      state.messages = compactedMessages(note ? `${summary}\n\n${note}` : summary, history, held)
      // The messages the conversation could be rewound to are gone from what the model sees.
      state.marks = {}
      for (const entry of state.data.items) {
        if (entry.kind === 'user' && !entry.compacted) {
          entry.compacted = true
          this.flush(state, entry)
        }
      }
      // Until the next request reports it, the summary is the best measure of the new context.
      this.addUsage(state, result.usage, result.usage?.completion_tokens ?? 0)
      item.status = 'done'
      item.summary = summary
      this.flush(state, item)
      this.host.persist(state)
      return true
    } catch (error) {
      item.status = 'failed'
      if (!signal.aborted) item.detail = error instanceof Error ? error.message : String(error)
      this.flush(state, item)
      return false
    }
  }

  private addUsage(state: SessionState, reported: ApiUsage | null, contextTokens: number): void {
    if (!reported) return
    const usage = state.data.usage
    usage.promptTokens += reported.prompt_tokens
    usage.completionTokens += reported.completion_tokens
    usage.cacheHitTokens += reported.prompt_cache_hit_tokens ?? 0
    usage.contextTokens = contextTokens
    this.host.emit({ type: 'usage', sessionId: state.data.id, usage: { ...usage } })
  }

  /** One request to DeepSeek. Returns null when the turn should end. */
  private async request(
    state: SessionState,
    settings: Settings,
    signal: AbortSignal,
    overflowable: boolean,
    drafts: Map<string, ToolItem>,
  ): Promise<ChatResult | typeof OVERFLOW | null> {
    const apiKey = this.host.apiKey()
    if (!apiKey) {
      this.add(state, { kind: 'error', id: randomUUID(), code: 'no-key', retryable: true })
      return null
    }
    const { model, effort } = state.data
    let reasoning: ReasoningItem | null = null
    let text: TextItem | null = null
    // Artifacts show up while the model is still writing them, keyed by the call's place in the reply.
    // A draft waits until every artifact call before it has its card, so the cards stay in the order of the
    // calls, and until its id has arrived in full, so it never passes for another artifact on the way.
    const streaming = new Map<number, ToolItem>()
    const names = new Map<number, string>()
    const argsOf = new Map<number, string>()
    const settled = new Set<number>()
    // Calls whose complete arguments already show they will fail, with why.
    const failing = new Map<number, string>()
    const latest = latestArtifacts(state.data.items)
    // Versions that earlier calls in this reply will make, so an update right after a create builds on it.
    const made = new Map<string, ArtifactVersion>()
    const lookup = (id: string) => made.get(id) ?? latest(id)
    const draftable = (index: number) => [...names.keys()].every((j) => j >= index || settled.has(j))
    // A call's arguments are complete once the next call starts or the reply ends; its card then shows the
    // version it will make. A call that would fail leaves nothing for later ones to build on.
    const complete = (index: number) => {
      const args = argsOf.get(index)
      argsOf.delete(index)
      settled.add(index)
      if (args === undefined) return
      try {
        const version = nextArtifact(JSON.parse(args) as Record<string, unknown>, lookup)
        made.set(version.id, version)
        const item = streaming.get(index)
        if (!item) return
        item.artifact = version
        item.target = version.title
        this.schedule(state, item)
      } catch (error) {
        // Not a version: it is answered with the error when it runs.
        failing.set(index, error instanceof Error ? error.message : String(error))
      }
    }
    const endDrafts = (status: ToolItem['status']) => {
      for (const item of streaming.values()) {
        item.status = status
        item.endedAt = this.now()
        this.flush(state, item)
      }
    }
    const endReasoning = () => {
      if (reasoning && reasoning.endedAt === undefined) {
        reasoning.endedAt = this.now()
        this.flush(state, reasoning)
      }
    }

    let result: ChatResult
    try {
      const system = await this.host.systemPrompt(state)
      result = await this.chat(
        {
          baseUrl: settings.baseUrl,
          apiKey,
          model,
          effort,
          messages: [{ role: 'system', content: system }, ...apiHistory(state.messages, thinks(effort))],
          tools: toolSpecs(state.data.permissionMode === 'plan'),
          temperature: thinks(effort) ? undefined : temperatureFor(settings.replyStyle),
          signal,
        },
        {
          onReasoning: (delta) => {
            if (!reasoning) reasoning = this.add<ReasoningItem>(state, { kind: 'reasoning', id: randomUUID(), text: '', startedAt: this.now() })
            reasoning.text += delta
            this.schedule(state, reasoning)
          },
          onContent: (delta) => {
            endReasoning()
            if (!text) text = this.add<TextItem>(state, { kind: 'text', id: randomUUID(), text: '', streaming: true })
            text.text += delta
            this.schedule(state, text)
          },
          onToolCall: (index, name) => {
            endReasoning()
            for (const j of [...argsOf.keys()]) if (j < index) complete(j)
            names.set(index, name)
            if (name !== 'artifact') settled.add(index)
          },
          onToolArguments: (index, args) => {
            if (names.get(index) !== 'artifact') return
            argsOf.set(index, args)
            const item = streaming.get(index)
            if (item) {
              const artifact = draftArtifact(args, lookup)
              item.artifact = artifact
              item.target = artifact.title
              this.schedule(state, item)
              return
            }
            if (settled.has(index)) return
            const command = streamedCommand(args)
            const id = streamedId(args)
            // Reading an artifact gets a plain row once it runs, not a card; so does changing one that does
            // not exist, which fails then.
            if (command === 'view' || (command && id !== undefined && command !== 'create' && !lookup(id))) settled.add(index)
            if (!command || id === undefined || settled.has(index) || !draftable(index)) return
            const artifact = draftArtifact(args, lookup)
            streaming.set(index, this.add<ToolItem>(state, { kind: 'tool', id: randomUUID(), callId: '', name: 'artifact', target: artifact.title, status: 'running', startedAt: this.now(), artifact }))
            settled.add(index)
          },
        },
      )
    } catch (error) {
      if (overflowable && !reasoning && !text && !streaming.size && error instanceof DeepSeekError && isContextOverflow(error.status, error.message)) return OVERFLOW
      endReasoning()
      endDrafts(signal.aborted ? 'stopped' : 'error')
      const partial = text as TextItem | null
      if (partial) {
        partial.streaming = false
        this.flush(state, partial)
      }
      if (signal.aborted) {
        if (partial?.text) state.messages.push({ role: 'assistant', content: partial.text })
        this.add(state, { kind: 'notice', id: randomUUID(), code: 'stopped' })
      } else {
        const detail = error instanceof Error ? error.message : String(error)
        const code = errorCode(error)
        const retryable = error instanceof DeepSeekError ? error.retryable : true
        this.add(state, { kind: 'error', id: randomUUID(), code, detail, retryable })
      }
      return null
    }

    endReasoning()
    for (const j of [...argsOf.keys()]) complete(j)
    const finished = text as TextItem | null
    if (finished) {
      finished.streaming = false
      this.flush(state, finished)
    }
    if (result.usage) this.addUsage(state, result.usage, result.usage.prompt_tokens + result.usage.completion_tokens)

    const message: Extract<ChatMessage, { role: 'assistant' }> = { role: 'assistant', content: result.content }
    if (result.reasoning) message.reasoning_content = result.reasoning
    if (result.toolCalls.length) message.tool_calls = result.toolCalls
    // A call cut off at the output limit is kept out of the history, so its half-written arguments are not sent again.
    const cut = result.finishReason === 'length' ? result.toolCalls[result.toolCalls.length - 1] : undefined
    if (cut) message.tool_calls = result.toolCalls.map((c) => (c === cut ? { ...c, function: { ...c.function, arguments: '{}' } } : c))
    // A draft behind another kind of step is written in full but runs after it, maybe after a prompt; its
    // card says it is waiting rather than still writing. One that was cut off, or that can only fail, ends
    // now: nothing more will be written to it. Its answer still goes to the model in the order of the calls.
    let behind = false
    result.toolCalls.forEach((call, i) => {
      const index = result.toolCallIndexes?.[i] ?? i
      const item = streaming.get(index)
      if (item) {
        item.callId = call.id
        const failure = call === cut ? CUT_OFF : failing.get(index)
        if (failure !== undefined) {
          item.status = 'error'
          item.error = failure
          item.endedAt = this.now()
          this.flush(state, item)
        } else if (behind) {
          item.queued = true
          this.flush(state, item)
        }
        drafts.set(call.id, item)
        streaming.delete(index)
      }
      if (call.function.name !== 'artifact') behind = true
    })
    endDrafts('error')
    state.messages.push(message)
    this.host.persist(state)
    return result
  }

  /** Runs each tool call in order. Returns false when the turn should end here. */
  private async runTools(state: SessionState, calls: ToolCall[], signal: AbortSignal, drafts: Map<string, ToolItem>, cutOff: string | null): Promise<boolean> {
    let keepGoing = true
    for (const call of calls) {
      if (call.id === cutOff && !signal.aborted && keepGoing) {
        const item = drafts.get(call.id) ?? this.add<ToolItem>(state, { kind: 'tool', id: randomUUID(), callId: call.id, name: itemName(call), target: '', status: 'running', startedAt: this.now() })
        delete item.queued
        item.status = 'error'
        item.error = CUT_OFF
        item.endedAt = this.now()
        this.flush(state, item)
        state.messages.push({ role: 'tool', tool_call_id: call.id, content: `Error: ${CUT_OFF}` })
        continue
      }
      if (signal.aborted || !keepGoing) {
        const draft = drafts.get(call.id)
        if (draft?.status === 'running') {
          delete draft.queued
          draft.status = 'stopped'
          this.flush(state, draft)
        }
        state.messages.push({ role: 'tool', tool_call_id: call.id, content: 'Not run: the turn ended before this call.' })
        continue
      }
      keepGoing = await this.runTool(state, call, signal, drafts.get(call.id))
    }
    if (signal.aborted) {
      this.add(state, { kind: 'notice', id: randomUUID(), code: 'stopped' })
      return false
    }
    return keepGoing
  }

  private async runTool(state: SessionState, call: ToolCall, signal: AbortSignal, draft?: ToolItem): Promise<boolean> {
    const item = draft ?? this.add<ToolItem>(state, {
      kind: 'tool',
      id: randomUUID(),
      callId: call.id,
      name: itemName(call),
      target: '',
      status: 'running',
      startedAt: this.now(),
    })
    // A queued draft stays queued until its status changes, so it never reads as being written again.
    const reply = (content: string) => state.messages.push({ role: 'tool', tool_call_id: call.id, content: clip(content) })
    const fail = (message: string) => {
      delete item.queued
      item.status = 'error'
      item.error = message
      item.endedAt = this.now()
      this.flush(state, item)
      reply(`Error: ${message}`)
    }

    let prepared: PreparedCall
    try {
      prepared = await prepareToolCall(call.function.name, call.function.arguments, state.data.workspace, latestArtifacts(state.data.items))
    } catch (error) {
      fail(error instanceof ToolError ? error.message : `Could not run ${call.function.name}: ${(error as Error).message}`)
      return true
    }
    item.target = prepared.target
    item.path = prepared.path
    item.created = prepared.created
    item.stats = prepared.stats
    if (prepared.artifact) item.artifact = prepared.artifact
    // The plan stays in the transcript whatever the person decides.
    if (prepared.approval?.kind === 'plan') item.output = prepared.approval.plan
    this.flush(state, item)

    if (prepared.approval) {
      const settings = this.host.settings()
      const context = {
        mode: state.data.permissionMode,
        allowedCommands: settings.allowedCommands,
        sessionAllowsEdits: state.allowEdits,
        sessionCommandPrefixes: state.allowedPrefixes,
      }
      if (prepared.approval.kind === 'plan' && state.data.permissionMode !== 'plan') {
        fail('Plan mode is off, so there is no plan to approve. Go ahead with the task.')
        return true
      }
      const refusal = planModeRefusal(prepared.approval, context)
      if (refusal) {
        item.status = 'denied'
        item.endedAt = this.now()
        this.flush(state, item)
        reply(refusal)
        return true
      }
      const ask = needsApproval(prepared.approval, context)
      if (ask) {
        delete item.queued
        item.status = 'waiting'
        this.flush(state, item)
        this.setStatus(state, 'waiting')
        const decision = await this.host.askPermission(state, prepared.approval, item.id, signal)
        this.setStatus(state, 'running')
        if (decision.type === 'deny') {
          item.status = signal.aborted ? 'stopped' : 'denied'
          item.endedAt = this.now()
          this.flush(state, item)
          if (signal.aborted) {
            reply('Not run: the user stopped the agent.')
            return false
          }
          if (prepared.approval.kind === 'plan') {
            reply(
              decision.feedback?.trim()
                ? `The user wants the plan changed: ${decision.feedback.trim()}\nStay in plan mode, revise the plan and call exit_plan_mode again.`
                : 'The user did not approve the plan. Stay in plan mode and ask them what they would like changed.',
            )
            return !!decision.feedback?.trim()
          }
          if (decision.feedback?.trim()) {
            reply(`The user declined this and said: ${decision.feedback.trim()}`)
            return true
          }
          reply('The user declined this. Do not try it again; ask them what they would like instead.')
          return false
        }
        if (prepared.approval.kind === 'plan') {
          // Approving the plan leaves plan mode for the mode the person picked.
          state.data.permissionMode = decision.type === 'allow' && decision.mode && decision.mode !== 'plan' ? decision.mode : 'acceptEdits'
          this.emitMeta(state)
        }
        if (decision.type === 'allowSession') {
          if (prepared.approval.kind === 'edit') state.allowEdits = true
          else if (prepared.approval.kind === 'command') state.allowedPrefixes.push(prepared.approval.prefix)
        }
        if (decision.type === 'allowAlways') this.host.allowCommandAlways(decision.prefix)
        item.status = 'running'
        item.startedAt = this.now()
        this.flush(state, item)
      }
    }

    let live = ''
    try {
      const result = await prepared.run({
        workspace: state.data.workspace,
        tracker: state.tracker,
        signal,
        onOutput: (chunk) => {
          live = (live + chunk).slice(-8_000)
          item.output = live
          this.schedule(state, item)
        },
      })
      delete item.queued
      item.status = signal.aborted ? 'stopped' : result.isError ? 'error' : 'done'
      item.output = result.display ?? item.output
      item.info = result.info
      item.endedAt = this.now()
      this.flush(state, item)
      reply(result.text)
      if (result.todos) {
        state.data.todos = result.todos
        this.host.emit({ type: 'todos', sessionId: state.data.id, todos: result.todos })
        this.host.persist(state)
      }
    } catch (error) {
      fail(error instanceof ToolError ? error.message : (error as Error).message)
    }
    if (prepared.approval?.kind === 'edit') this.host.changesUpdated(state)
    return true
  }

  private add<T extends TranscriptItem>(state: SessionState, item: T): T {
    state.data.items.push(item)
    state.data.updatedAt = this.now()
    this.host.emit({ type: 'item', sessionId: state.data.id, item: { ...item } })
    return item
  }

  /** Sends the item now, cancelling any pending streamed update. */
  private flush(state: SessionState, item: TranscriptItem): void {
    const timer = this.pending.get(item.id)
    if (timer) {
      clearTimeout(timer)
      this.pending.delete(item.id)
    }
    this.host.emit({ type: 'item', sessionId: state.data.id, item: { ...item } })
  }

  /** Coalesces streamed updates so the window gets at most one per item every 50 ms. */
  private schedule(state: SessionState, item: TranscriptItem): void {
    if (this.pending.has(item.id)) return
    this.pending.set(
      item.id,
      setTimeout(() => {
        this.pending.delete(item.id)
        this.host.emit({ type: 'item', sessionId: state.data.id, item: { ...item } })
      }, STREAM_FLUSH_MS),
    )
  }

  private setStatus(state: SessionState, status: SessionStatus): void {
    if (state.data.status === status) return
    state.data.status = status
    state.data.updatedAt = this.now()
    this.emitMeta(state)
  }

  private emitMeta(state: SessionState): void {
    const { items: _items, usage: _usage, todos: _todos, ...meta } = state.data
    this.host.emit({ type: 'meta', meta })
  }
}
