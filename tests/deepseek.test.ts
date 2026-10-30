import { describe, expect, it } from 'vitest'
import { DeepSeekError, checkConnection, createSseParser, errorFromStatus, streamChat } from '../src/main/deepseek'

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
      { baseUrl: 'https://api.deepseek.com/', apiKey: 'sk-test', model: 'deepseek-flash', messages: [{ role: 'user', content: 'hi' }], fetchImpl },
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

  it('asks for thinking at the chosen effort, or turns it off', async () => {
    const bodies: Record<string, unknown>[] = []
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)))
      return sseResponse(['data: [DONE]\n\n'])
    }) as unknown as typeof fetch
    const base = { baseUrl: 'https://x', apiKey: 'k', model: 'deepseek-v4-pro', messages: [], fetchImpl }
    await streamChat({ ...base, effort: 'max' })
    await streamChat({ ...base, effort: 'none' })
    await streamChat(base)
    expect(bodies[0]).toMatchObject({ thinking: { type: 'enabled' }, reasoning_effort: 'max' })
    expect(bodies[1]).toMatchObject({ thinking: { type: 'disabled' } })
    expect(bodies[1]).not.toHaveProperty('reasoning_effort')
    expect(bodies[2]).not.toHaveProperty('thinking')
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

describe('OpenAI-compatible APIs', () => {
  it('sends extra headers and reads reasoning under its other name', async () => {
    let headers: Record<string, string> = {}
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>
      return sseResponse([event({ choices: [{ delta: { reasoning: '想一下' } }] }), event({ choices: [{ delta: { content: '好' } }] }), 'data: [DONE]\n\n'])
    }) as unknown as typeof fetch
    const result = await streamChat({ baseUrl: 'https://x', apiKey: 'k', model: 'glm-5.3', messages: [], headers: { 'x-opencode-session': 's1' }, fetchImpl })
    expect(headers).toMatchObject({ Authorization: 'Bearer k', 'x-opencode-session': 's1' })
    expect(result.reasoning).toBe('想一下')
    expect(result.content).toBe('好')
  })

  it('lists the models a key can use when testing the connection', async () => {
    let url = ''
    const fetchImpl = (async (input: string) => {
      url = input
      return new Response(JSON.stringify({ object: 'list', data: [{ id: 'glm-5.3' }, { id: 'kimi-k3' }, { nope: 1 }] }))
    }) as unknown as typeof fetch
    const { models } = await checkConnection('https://opencode.ai/inference/go/v1/', 'k', fetchImpl)
    expect(url).toBe('https://opencode.ai/inference/go/v1/models')
    expect(models).toEqual(['glm-5.3', 'kimi-k3'])
  })

  it('treats a refused key as an auth error', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ type: 'error', error: { type: 'AuthError', message: 'Invalid API key.' } }), { status: 401 })) as unknown as typeof fetch
    const error = await checkConnection('https://x', 'bad', fetchImpl).catch((e) => e)
    expect(error).toBeInstanceOf(DeepSeekError)
    expect(error).toMatchObject({ code: 'auth', message: 'Invalid API key.' })
  })
})

