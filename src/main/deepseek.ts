// A streaming client for DeepSeek's OpenAI-compatible chat completions endpoint.

import type { Effort, ErrorCode } from '../shared/types'

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; reasoning_content?: string; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface ToolSpec {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface ApiUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  prompt_cache_hit_tokens?: number
  prompt_cache_miss_tokens?: number
}

export interface ChatRequest {
  baseUrl: string
  apiKey: string
  model: string
  /** Left out, the model's own default applies (thinking, at high effort). */
  effort?: Effort
  messages: ChatMessage[]
  tools?: ToolSpec[]
  temperature?: number
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

export interface StreamHandlers {
  onReasoning?(delta: string): void
  onContent?(delta: string): void
  onToolCall?(index: number, name: string): void
  /** The arguments of a tool call so far, as they stream in. */
  onToolArguments?(index: number, args: string): void
}

export interface ChatResult {
  content: string
  reasoning: string
  toolCalls: ToolCall[]
  /** Where each of toolCalls sat in the stream, the index onToolCall and onToolArguments were given. */
  toolCallIndexes?: number[]
  finishReason: string | null
  usage: ApiUsage | null
}

export class DeepSeekError extends Error {
  constructor(
    readonly code: ErrorCode | 'aborted',
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'DeepSeekError'
  }

  get retryable(): boolean {
    return this.code === 'network' || this.code === 'server' || this.code === 'rate' || this.code === 'balance'
  }
}

export function endpoint(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/+$/, '') + path
}

export function errorFromStatus(status: number, body: string): DeepSeekError {
  const detail = extractErrorMessage(body) ?? `HTTP ${status}`
  if (status === 401 || status === 403) return new DeepSeekError('auth', detail, status)
  if (status === 402) return new DeepSeekError('balance', detail, status)
  if (status === 429) return new DeepSeekError('rate', detail, status)
  if (status === 400 || status === 422) return new DeepSeekError('bad-request', detail, status)
  if (status >= 500) return new DeepSeekError('server', detail, status)
  return new DeepSeekError('unknown', detail, status)
}

function extractErrorMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } }
    return parsed.error?.message ?? null
  } catch {
    return body.trim() ? body.trim().slice(0, 300) : null
  }
}

/**
 * Splits a server-sent event stream into the JSON payloads of its `data:` lines.
 * Comment lines (DeepSeek sends `: keep-alive` while a request is queued) are skipped.
 */
export function createSseParser(onData: (data: string) => void) {
  let buffer = ''
  const flushLine = (line: string) => {
    const trimmed = line.replace(/\r$/, '')
    if (!trimmed.startsWith('data:')) return
    const data = trimmed.slice(5).trimStart()
    if (data) onData(data)
  }
  return {
    feed(chunk: string) {
      buffer += chunk
      let index: number
      while ((index = buffer.indexOf('\n')) !== -1) {
        flushLine(buffer.slice(0, index))
        buffer = buffer.slice(index + 1)
      }
    },
    end() {
      if (buffer) flushLine(buffer)
      buffer = ''
    },
  }
}

interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: Array<{ index: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }>
    }
    finish_reason?: string | null
  }>
  usage?: ApiUsage | null
}

export async function streamChat(request: ChatRequest, handlers: StreamHandlers = {}): Promise<ChatResult> {
  const fetchImpl = request.fetchImpl ?? fetch
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    stream: true,
    stream_options: { include_usage: true },
  }
  if (request.tools?.length) body.tools = request.tools
  if (request.temperature !== undefined) body.temperature = request.temperature
  if (request.effort === 'none') body.thinking = { type: 'disabled' }
  else if (request.effort) {
    body.thinking = { type: 'enabled' }
    body.reasoning_effort = request.effort
  }

  let response: Response
  try {
    response = await fetchImpl(endpoint(request.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${request.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: request.signal,
    })
  } catch (error) {
    throw toNetworkError(error, request.signal)
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw errorFromStatus(response.status, text)
  }
  if (!response.body) throw new DeepSeekError('server', 'Empty response body')

  const result: ChatResult = { content: '', reasoning: '', toolCalls: [], finishReason: null, usage: null }
  const partial: Array<{ id: string; name: string; arguments: string }> = []

  const parser = createSseParser((data) => {
    if (data === '[DONE]') return
    let chunk: StreamChunk
    try {
      chunk = JSON.parse(data) as StreamChunk
    } catch {
      return
    }
    if (chunk.usage) result.usage = chunk.usage
    const choice = chunk.choices?.[0]
    if (!choice) return
    const delta = choice.delta ?? {}
    if (delta.reasoning_content) {
      result.reasoning += delta.reasoning_content
      handlers.onReasoning?.(delta.reasoning_content)
    }
    if (delta.content) {
      result.content += delta.content
      handlers.onContent?.(delta.content)
    }
    for (const call of delta.tool_calls ?? []) {
      const slot = (partial[call.index] ??= { id: '', name: '', arguments: '' })
      if (call.id) slot.id = call.id
      if (call.function?.name) {
        const isNew = !slot.name
        slot.name += call.function.name
        if (isNew) handlers.onToolCall?.(call.index, slot.name)
      }
      if (call.function?.arguments) {
        slot.arguments += call.function.arguments
        handlers.onToolArguments?.(call.index, slot.arguments)
      }
    }
    if (choice.finish_reason) result.finishReason = choice.finish_reason
  })

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      parser.feed(decoder.decode(value, { stream: true }))
    }
    parser.feed(decoder.decode())
    parser.end()
  } catch (error) {
    throw toNetworkError(error, request.signal)
  }

  result.toolCallIndexes = []
  result.toolCalls = partial.flatMap((call, index) => {
    if (!call?.name) return []
    result.toolCallIndexes!.push(index)
    return [{ id: call.id || `call_${index}`, type: 'function' as const, function: { name: call.name, arguments: call.arguments || '{}' } }]
  })
  return result
}

function toNetworkError(error: unknown, signal?: AbortSignal): DeepSeekError {
  if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
    return new DeepSeekError('aborted', 'Request aborted')
  }
  if (error instanceof DeepSeekError) return error
  return new DeepSeekError('network', error instanceof Error ? error.message : String(error))
}

/** A cheap authenticated request, used by "Test connection" in Settings. */
export async function checkConnection(baseUrl: string, apiKey: string, fetchImpl: typeof fetch = fetch) {
  const started = Date.now()
  let response: Response
  try {
    response = await fetchImpl(endpoint(baseUrl, '/models'), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    throw toNetworkError(error)
  }
  if (!response.ok) throw errorFromStatus(response.status, await response.text().catch(() => ''))
  return Date.now() - started
}
