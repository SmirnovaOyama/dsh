// The agent loop: ask DeepSeek, run the tools it calls (asking first where needed), repeat until it answers.

import { randomUUID } from 'node:crypto'
import type {
  AgentEvent,
  ErrorCode,
  FileRef,
  PermissionDecision,
  SessionData,
  SessionStatus,
  Settings,
  TranscriptItem,
} from '../shared/types'
import type { ChangeTracker } from './changes'
import { COMPACT_AT, compactedMessages, isContextOverflow, splitForCompact, summaryRequest } from './compact'
import { DeepSeekError, streamChat, type ApiUsage, type ChatMessage, type ChatResult, type ToolCall } from './deepseek'
import { needsApproval } from './permissions'
import { withRefs } from './refs'
import { TOOL_SPECS, ToolError, prepareToolCall, type PermissionNeed, type PreparedCall } from './tools'

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
  chat?: typeof streamChat
  now?: () => number
}

export function temperatureFor(style: Settings['replyStyle']): number {
  return style === 'varied' ? 1.3 : style === 'balanced' ? 0.7 : 0
}

export function isReasoner(model: string): boolean {
  return /reason/i.test(model)
}

/**
 * Thinking models need the reasoning of the current turn sent back between tool calls,
 * but not the reasoning of earlier turns. Other models never get it.
 */
export function apiHistory(messages: ChatMessage[], model: string): ChatMessage[] {
  const keepReasoning = isReasoner(model)
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
    if (this.isRunning(state)) return
    const trimmed = text.trim()
    if (!trimmed) return
    const content = await withRefs(state.data.workspace, trimmed, refs)
    // Reading the files took a moment; another message may have started a run meanwhile.
    if (this.isRunning(state)) return
    if (!state.data.items.some((item) => item.kind === 'user')) state.data.title = titleFrom(trimmed)
    this.add(state, { kind: 'user', id: randomUUID(), text: trimmed, at: this.now(), ...(refs.length ? { refs } : {}) })
    state.messages.push({ role: 'user', content })
    await this.run(state)
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
        if (!autoCompactFailed && state.data.usage.contextTokens >= COMPACT_AT && this.host.apiKey()) {
          // A failed compaction leaves the history as it was, and the request may still fit.
          autoCompactFailed = !(await this.summarize(state, signal, true))
          if (signal.aborted) {
            this.add(state, { kind: 'notice', id: randomUUID(), code: 'stopped' })
            break
          }
        }
        steps++
        const result = await this.request(state, settings, signal, !overflowRetried)
        if (result === OVERFLOW) {
          overflowRetried = true
          steps--
          if (await this.summarize(state, signal, true)) continue
          if (signal.aborted) this.add(state, { kind: 'notice', id: randomUUID(), code: 'stopped' })
          else this.add(state, { kind: 'error', id: randomUUID(), code: 'bad-request', detail: 'The conversation is longer than the model accepts.', retryable: true })
          break
        }
        if (!result) break
        if (!result.toolCalls.length) break
        const keepGoing = await this.runTools(state, result.toolCalls, signal)
        if (!keepGoing) break
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
      const model = state.data.model
      const result = await this.chat({
        baseUrl: settings.baseUrl,
        apiKey,
        model,
        messages: summaryRequest(history, focus),
        temperature: isReasoner(model) ? undefined : 0,
        signal,
      })
      const summary = result.content.trim()
      if (!summary) throw new Error('The model returned an empty summary.')
      state.messages = compactedMessages(summary, history, held)
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
  private async request(state: SessionState, settings: Settings, signal: AbortSignal, overflowable: boolean): Promise<ChatResult | typeof OVERFLOW | null> {
    const apiKey = this.host.apiKey()
    if (!apiKey) {
      this.add(state, { kind: 'error', id: randomUUID(), code: 'no-key', retryable: true })
      return null
    }
    const model = state.data.model
    let reasoning: ReasoningItem | null = null
    let text: TextItem | null = null
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
          messages: [{ role: 'system', content: system }, ...apiHistory(state.messages, model)],
          tools: TOOL_SPECS,
          temperature: isReasoner(model) ? undefined : temperatureFor(settings.replyStyle),
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
          onToolCall: () => endReasoning(),
        },
      )
    } catch (error) {
      if (overflowable && !reasoning && !text && error instanceof DeepSeekError && isContextOverflow(error.status, error.message)) return OVERFLOW
      endReasoning()
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
    const finished = text as TextItem | null
    if (finished) {
      finished.streaming = false
      this.flush(state, finished)
    }
    if (result.usage) this.addUsage(state, result.usage, result.usage.prompt_tokens + result.usage.completion_tokens)

    const message: Extract<ChatMessage, { role: 'assistant' }> = { role: 'assistant', content: result.content }
    if (result.reasoning) message.reasoning_content = result.reasoning
    if (result.toolCalls.length) message.tool_calls = result.toolCalls
    state.messages.push(message)
    this.host.persist(state)
    return result
  }

  /** Runs each tool call in order. Returns false when the turn should end here. */
  private async runTools(state: SessionState, calls: ToolCall[], signal: AbortSignal): Promise<boolean> {
    let keepGoing = true
    for (const call of calls) {
      if (signal.aborted || !keepGoing) {
        state.messages.push({ role: 'tool', tool_call_id: call.id, content: 'Not run: the turn ended before this call.' })
        continue
      }
      keepGoing = await this.runTool(state, call, signal)
    }
    if (signal.aborted) {
      this.add(state, { kind: 'notice', id: randomUUID(), code: 'stopped' })
      return false
    }
    return keepGoing
  }

  private async runTool(state: SessionState, call: ToolCall, signal: AbortSignal): Promise<boolean> {
    const item = this.add<ToolItem>(state, {
      kind: 'tool',
      id: randomUUID(),
      callId: call.id,
      name: call.function.name,
      target: '',
      status: 'running',
      startedAt: this.now(),
    })
    const reply = (content: string) => state.messages.push({ role: 'tool', tool_call_id: call.id, content: clip(content) })
    const fail = (message: string) => {
      item.status = 'error'
      item.error = message
      item.endedAt = this.now()
      this.flush(state, item)
      reply(`Error: ${message}`)
    }

    let prepared: PreparedCall
    try {
      prepared = await prepareToolCall(call.function.name, call.function.arguments, state.data.workspace)
    } catch (error) {
      fail(error instanceof ToolError ? error.message : `Could not run ${call.function.name}: ${(error as Error).message}`)
      return true
    }
    item.target = prepared.target
    item.path = prepared.path
    item.created = prepared.created
    item.stats = prepared.stats
    this.flush(state, item)

    if (prepared.approval) {
      const settings = this.host.settings()
      const ask = needsApproval(prepared.approval, {
        mode: state.data.permissionMode,
        allowedCommands: settings.allowedCommands,
        sessionAllowsEdits: state.allowEdits,
        sessionCommandPrefixes: state.allowedPrefixes,
      })
      if (ask) {
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
          if (decision.feedback?.trim()) {
            reply(`The user declined this and said: ${decision.feedback.trim()}`)
            return true
          }
          reply('The user declined this. Do not try it again; ask them what they would like instead.')
          return false
        }
        if (decision.type === 'allowSession') {
          if (prepared.approval.kind === 'edit') state.allowEdits = true
          else state.allowedPrefixes.push(prepared.approval.prefix)
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
      item.status = signal.aborted ? 'stopped' : result.isError ? 'error' : 'done'
      item.output = result.display
      item.info = result.info
      item.endedAt = this.now()
      this.flush(state, item)
      reply(result.text)
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
    const { items: _items, usage: _usage, ...meta } = state.data
    this.host.emit({ type: 'meta', meta })
  }
}
