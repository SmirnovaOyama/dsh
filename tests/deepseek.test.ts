import { describe, expect, it } from 'vitest'
import { DeepSeekError, createSseParser, errorFromStatus, streamChat } from '../src/main/deepseek'

function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } })
}

const event = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`

describe('createSseParser', () => {
  it('joins data lines split across chunks and skips comments', () => {
    const seen: string[] = []
    const parser = createSseParser((data) => seen.push(data))
    parser.feed(': keep-alive\n\nda')
    parser.feed('ta: {"a":1}\r\n\ndata: [DONE]')
    parser.end()
    expect(seen).toEqual(['{"a":1}', '[DONE]'])
  })
})

describe('streamChat', () => {
  it('collects reasoning, content, split tool calls and usage', async () => {
    const reasoning: string[] = []
    const content: string[] = []
    const chunks = [
      event({ choices: [{ delta: { reasoning_content: '先看' } }] }),
      event({ choices: [{ delta: { reasoning_content: '檔案' } }] }),
      event({ choices: [{ delta: { content: '我來讀' } }] }),
      event({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'read_file', arguments: '{"pa' } }] } }] }),
      event({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.ts"}' } }] } }] }),
      event({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      event({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_cache_hit_tokens: 64 } }),
      'data: [DONE]\n\n',
    ]
    let sentBody: Record<string, unknown> = {}
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sentBody = JSON.parse(String(init.body))
      return sseResponse(chunks)
    }) as unknown as typeof fetch

    const result = await streamChat(
      { baseUrl: 'https://api.deepseek.com/', apiKey: 'sk-test', model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }], fetchImpl },
      { onReasoning: (d) => reasoning.push(d), onContent: (d) => content.push(d) },
    )

    expect(sentBody.stream).toBe(true)
    expect(sentBody.stream_options).toEqual({ include_usage: true })
    expect(reasoning.join('')).toBe('先看檔案')
    expect(content.join('')).toBe('我來讀')
    expect(result.toolCalls).toEqual([{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }])
    expect(result.finishReason).toBe('tool_calls')
    expect(result.usage?.prompt_cache_hit_tokens).toBe(64)
  })

  it('turns HTTP errors into error codes', async () => {
    const fetchImpl = (async () => new Response('{"error":{"message":"Insufficient Balance"}}', { status: 402 })) as unknown as typeof fetch
    await expect(
      streamChat({ baseUrl: 'https://x', apiKey: 'k', model: 'm', messages: [], fetchImpl }),
    ).rejects.toMatchObject({ code: 'balance', message: 'Insufficient Balance' })
  })

  it('reports a network failure as retryable', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const error = await streamChat({ baseUrl: 'https://x', apiKey: 'k', model: 'm', messages: [], fetchImpl }).catch((e) => e)
    expect(error).toBeInstanceOf(DeepSeekError)
    expect(error.code).toBe('network')
    expect(error.retryable).toBe(true)
  })
})

describe('errorFromStatus', () => {
  it('maps the statuses DeepSeek documents', () => {
    expect(errorFromStatus(401, '').code).toBe('auth')
    expect(errorFromStatus(429, '').code).toBe('rate')
    expect(errorFromStatus(422, '').code).toBe('bad-request')
    expect(errorFromStatus(503, '').code).toBe('server')
  })
})
