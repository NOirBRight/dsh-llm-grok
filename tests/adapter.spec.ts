import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createUserMessage, LlmError, ReasoningEffortId, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { GrokAdapter, resolveGrokAccessToken } from '../src/adapter.ts'
import type { GrokAdapterOptions, GrokConnectionOptions } from '../src/adapter.ts'
import { GROK_CATALOG, GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS } from '../src/client-contract.ts'
import { resolveAdapterOptions } from '../src/index.ts'
import { createGrokAuthRuntime } from '../src/oauth.ts'
import { GROK_PACKED_REASONING_TYPE } from '../src/reasoning-display.ts'
import { injectGrokServerSearchTools } from '../src/responses-tools.ts'
import { writeSession } from '../src/session.ts'
import { closeFakeAuthServers, fakeAuthServer } from './fake-auth-server.ts'
import { closeFakeProxies, fakeChatProxy } from './fake-proxy.ts'

afterEach(async () => {
  await closeFakeProxies()
  await closeFakeAuthServers()
})

const FIXED_POLICY = resolveRetryPolicy(undefined, 'test')
const MODEL_ID = 'grok-4.6'

function connection(overrides: Partial<GrokConnectionOptions> = {}): GrokConnectionOptions {
  return {
    baseURL: 'http://127.0.0.1/v1',
    models: GROK_CATALOG,
    streamIdleTimeoutMs: GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    retryPolicy: FIXED_POLICY,
    ...overrides,
  }
}

function adapter(opts: Partial<GrokAdapterOptions> = {}): GrokAdapter {
  return new GrokAdapter({
    options: opts.options ?? (() => connection()),
    resolveApiKey: opts.resolveApiKey ?? (() => Promise.resolve('test-access')),
    ...opts.resolveAttachments === undefined ? {} : { resolveAttachments: opts.resolveAttachments },
  })
}

function request(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    provider: 'grok',
    model: MODEL_ID,
    messages: [createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } })],
    ...overrides,
  }
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const chunk of stream) out.push(chunk)
  return out
}

const weatherTool = {
  name: 'get_weather',
  description: 'Look up the weather',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string' } },
  },
}

describe('injectGrokServerSearchTools', () => {
  it('appends web_search and x_search after existing function tools', () => {
    expect(injectGrokServerSearchTools({
      model: MODEL_ID,
      tools: [{ type: 'function', name: 'get_weather' }],
    })).toEqual({
      model: MODEL_ID,
      tools: [
        { type: 'function', name: 'get_weather' },
        { type: 'web_search' },
        { type: 'x_search' },
      ],
    })
  })

  it('creates tools when the payload has none', () => {
    expect(injectGrokServerSearchTools({ model: MODEL_ID })).toEqual({
      model: MODEL_ID,
      tools: [{ type: 'web_search' }, { type: 'x_search' }],
    })
  })
})

describe('resolveAdapterOptions', () => {
  it('uses the saved displayed catalog, not the frozen account list', () => {
    const options = resolveAdapterOptions({
      models: [{ id: 'grok-4.6', name: 'Grok 4.6', thinking: true, vision: true }],
    })
    expect(options.models.map(model => model.id)).toEqual(['grok-4.6'])
  })
})

describe('GrokAdapter metadata', () => {
  it('lists frozen catalog models with thinking and vision', async () => {
    const a = adapter({})
    expect(a.providerInfo('grok')).toEqual({ id: 'grok', name: 'Grok' })
    expect(a.providerRetryPolicy('grok')).toBe(FIXED_POLICY)
    await expect(a.listModels('grok')).resolves.toEqual([
      { provider: 'grok', id: 'grok-4.6', name: 'Grok 4.6', inputModalities: ['text', 'image'] },
      { provider: 'grok', id: 'grok-4.5', name: 'Grok 4.5', inputModalities: ['text', 'image'] },
    ])
    const displayed = adapter({
      options: () => connection({
        models: [{ id: 'grok-4.6', name: 'Grok 4.6', thinking: true, vision: true }],
      }),
    })
    await expect(displayed.listModels('grok')).resolves.toEqual([
      { provider: 'grok', id: 'grok-4.6', name: 'Grok 4.6', inputModalities: ['text', 'image'] },
    ])
    expect((await displayed.resolveModel('grok', 'grok-4.6')).context).toEqual({ contextWindow: 500_000 })
    const info = await a.resolveModel('grok', 'grok-4.6')
    expect(info.context).toEqual({ contextWindow: 500_000 })
    expect(info.reasoning?.efforts.map(effort => effort.id)).toEqual(['xhigh', 'high', 'medium', 'low'])
    expect(info.reasoning?.defaultEffort).toBe('high')
    const older = await a.resolveModel('grok', 'grok-4.5')
    expect(older.reasoning?.efforts.map(effort => effort.id)).toEqual(['high', 'medium', 'low'])
    expect(older.reasoning?.defaultEffort).toBe('high')
  })
})

describe('GrokAdapter.stream request shape', () => {
  it('POSTs /v1/responses with DSH function tools plus server-side search', async () => {
    const server = await fakeChatProxy([{ kind: 'json', status: 400, body: { error: { message: 'captured' } } }])
    const a = adapter({ options: () => connection({ baseURL: `${server.url}/v1` }) })

    await collect(a.stream(request({ tools: [weatherTool] })))

    expect(server.requests).toHaveLength(1)
    expect(server.requests[0]?.method).toBe('POST')
    expect(server.requests[0]?.path).toBe('/v1/responses')
    expect(server.requests[0]?.headers.authorization).toBe('Bearer test-access')
    expect(server.requests[0]?.headers['x-grok-client-version']).toBe('1.0.4')
    expect(server.requests[0]?.headers['x-grok-client-identifier']).toBe('grok-shell')
    const body = server.requests[0]?.body as { model?: string, tools?: Array<{ type?: string, name?: string }> }
    expect(body.model).toBe(MODEL_ID)
    expect(body.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'function', name: 'get_weather' }),
      { type: 'web_search' },
      { type: 'x_search' },
    ]))
  })

  it('still sends web_search and x_search when no DSH tools are passed', async () => {
    const server = await fakeChatProxy([{ kind: 'json', status: 400, body: { error: { message: 'captured' } } }])
    const a = adapter({ options: () => connection({ baseURL: `${server.url}/v1` }) })

    await collect(a.stream(request()))

    const body = server.requests[0]?.body as { tools?: Array<{ type?: string }> }
    expect(body.tools).toEqual([{ type: 'web_search' }, { type: 'x_search' }])
  })

  it('sends official reasoning.effort and omits summary / none', async () => {
    const server = await fakeChatProxy([{ kind: 'json', status: 400, body: { error: { message: 'captured' } } }])
    const a = adapter({ options: () => connection({ baseURL: `${server.url}/v1` }) })

    await collect(a.stream(request()))

    const body = server.requests[0]?.body as { reasoning?: { effort?: string, summary?: string } }
    expect(body.reasoning).toEqual({ effort: 'high' })
  })

  it('forwards Extra High as reasoning.effort xhigh', async () => {
    const server = await fakeChatProxy([{ kind: 'json', status: 400, body: { error: { message: 'captured' } } }])
    const a = adapter({ options: () => connection({ baseURL: `${server.url}/v1` }) })

    await collect(a.stream(request({ reasoningEffort: ReasoningEffortId('xhigh') })))

    const body = server.requests[0]?.body as { reasoning?: { effort?: string } }
    expect(body.reasoning).toEqual({ effort: 'xhigh' })
  })

  it('sends grok-4.5 as official high without summary', async () => {
    const server = await fakeChatProxy([{ kind: 'json', status: 400, body: { error: { message: 'captured' } } }])
    const a = adapter({ options: () => connection({ baseURL: `${server.url}/v1` }) })

    await collect(a.stream(request({ model: 'grok-4.5' })))

    const body = server.requests[0]?.body as { reasoning?: { effort?: string, summary?: string } }
    expect(body.reasoning).toEqual({ effort: 'high' })
  })

  it('throws MISSING_CREDENTIAL before any proxy request when resolveApiKey does', async () => {
    const server = await fakeChatProxy([])
    const a = adapter({
      options: () => connection({ baseURL: `${server.url}/v1` }),
      resolveApiKey: () => Promise.reject(new LlmError(
        'llm-grok: not signed in; sign in with an xAI subscription from Plugin configuration',
        'MISSING_CREDENTIAL',
      )),
    })

    await expect(collect(a.stream(request()))).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
    expect(server.requests).toEqual([])
  })

  it('does not emit a Think block per empty tco_ search-reasoning item', async () => {
    const visible = {
      id: 'rs_resp',
      type: 'reasoning',
      status: 'completed',
      summary: [{ type: 'summary_text', text: 'visible think' }],
      encrypted_content: 'enc-rs',
    }
    const tco1 = {
      id: 'tco_resp_call-11',
      type: 'reasoning',
      status: 'completed',
      summary: [],
      encrypted_content: 'enc-tco-11',
    }
    const tco2 = {
      id: 'tco_resp_call-12',
      type: 'reasoning',
      status: 'completed',
      summary: [],
      encrypted_content: 'enc-tco-12',
    }
    const message = {
      id: 'msg_resp',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: 'hello' }],
    }
    const response = {
      id: 'resp_1',
      status: 'completed',
      output: [visible, message, tco1, tco2],
      usage: { input_tokens: 10, output_tokens: 4, output_tokens_details: { reasoning_tokens: 3 } },
    }
    const server = await fakeChatProxy([{
      kind: 'sse',
      events: [
        { type: 'response.created', response: { id: 'resp_1', status: 'in_progress', output: [] } },
        { type: 'response.output_item.added', output_index: 0, item: { ...visible, status: 'in_progress', summary: [] } },
        { type: 'response.reasoning_summary_text.delta', output_index: 0, delta: 'visible think' },
        { type: 'response.output_item.done', output_index: 0, item: visible },
        { type: 'response.output_item.added', output_index: 1, item: { ...message, status: 'in_progress', content: [] } },
        { type: 'response.output_text.delta', output_index: 1, delta: 'hello' },
        { type: 'response.output_item.done', output_index: 1, item: message },
        { type: 'response.output_item.added', output_index: 2, item: { ...tco1, status: 'in_progress' } },
        { type: 'response.output_item.done', output_index: 2, item: tco1 },
        { type: 'response.output_item.added', output_index: 3, item: { ...tco2, status: 'in_progress' } },
        { type: 'response.output_item.done', output_index: 3, item: tco2 },
        { type: 'response.completed', response },
      ],
    }])
    const a = adapter({ options: () => connection({ baseURL: `${server.url}/v1` }) })
    const chunks = await collect(a.stream(request()))

    const reasoningStarts = chunks.filter(chunk => (
      chunk.type === 'block-start' && chunk.blockType === 'reasoning'
    ))
    const reasoningEnds = chunks.filter(chunk => (
      chunk.type === 'block-end' && chunk.block.type === 'reasoning'
    ))
    expect(reasoningStarts).toHaveLength(1)
    expect(reasoningEnds).toHaveLength(1)
    expect(reasoningEnds[0]?.type === 'block-end' && reasoningEnds[0].block.type === 'reasoning'
      ? reasoningEnds[0].block.text
      : undefined).toBe('visible think')

    const finish = chunks.find(chunk => chunk.type === 'finish')
    expect(finish?.type).toBe('finish')
    if (finish?.type !== 'finish') return
    const replay = finish.replayState as { blocks?: Array<{ type?: string, thinkingSignature?: string }> } | undefined
    const reasoning = replay?.blocks?.filter(block => block.type === 'reasoning') ?? []
    expect(reasoning).toHaveLength(1)
    expect(JSON.parse(reasoning[0]?.thinkingSignature ?? '')).toEqual({
      type: GROK_PACKED_REASONING_TYPE,
      items: [visible, tco1, tco2],
    })
  })

  it('does not forward Grok xs_call search echoes as DSH tool-calls', async () => {
    const message = {
      id: 'msg_resp',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: 'hello' }],
    }
    const xs = {
      id: 'ctc_abc_call-3',
      type: 'custom_tool_call',
      status: 'completed',
      call_id: 'xs_call-abc-3',
      name: 'x_keyword_search',
      input: '{"query":"grok-4.6","limit":"10","mode":"Latest"}',
    }
    const run = {
      id: 'fc_run',
      type: 'function_call',
      status: 'completed',
      call_id: 'call_run',
      name: 'run_code',
      arguments: '{"code":"return 1","description":"noop"}',
    }
    const response = {
      id: 'resp_1',
      status: 'completed',
      output: [message, xs, run],
      usage: { input_tokens: 8, output_tokens: 3 },
    }
    const server = await fakeChatProxy([{
      kind: 'sse',
      events: [
        { type: 'response.created', response: { id: 'resp_1', status: 'in_progress', output: [] } },
        { type: 'response.output_item.added', output_index: 0, item: { ...message, status: 'in_progress', content: [] } },
        { type: 'response.output_text.delta', output_index: 0, delta: 'hello' },
        { type: 'response.output_item.done', output_index: 0, item: message },
        { type: 'response.output_item.added', output_index: 1, item: xs },
        { type: 'response.custom_tool_call_input.done', output_index: 1, input: xs.input },
        { type: 'response.output_item.done', output_index: 1, item: xs },
        { type: 'response.output_item.added', output_index: 2, item: run },
        { type: 'response.function_call_arguments.done', output_index: 2, arguments: run.arguments },
        { type: 'response.output_item.done', output_index: 2, item: run },
        { type: 'response.completed', response },
      ],
    }])
    const a = adapter({ options: () => connection({ baseURL: `${server.url}/v1` }) })
    const chunks = await collect(a.stream(request()))
    const starts = chunks.filter(chunk => chunk.type === 'block-start' && chunk.blockType === 'tool-call')
    const ends = chunks.filter(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
    expect(starts).toHaveLength(1)
    expect(ends).toHaveLength(1)
    expect(ends[0]?.type === 'block-end' && ends[0].block.type === 'tool-call'
      ? ends[0].block.name
      : undefined).toBe('run_code')
  })
})

describe('resolveGrokAccessToken', () => {
  it('throws MISSING_CREDENTIAL when no session file exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-llm-grok-token-missing-'))
    const runtime = createGrokAuthRuntime({
      resolveSessionPath: () => join(root, 'grok-oauth.json'),
      issuer: 'http://127.0.0.1:1',
    })

    await expect(resolveGrokAccessToken(runtime)).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
  })

  it('returns the access token from a fresh session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-llm-grok-token-ok-'))
    const path = join(root, 'grok-oauth.json')
    await writeSession(path, {
      accessToken: 'access-live',
      refreshToken: 'refresh-live',
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    })
    const runtime = createGrokAuthRuntime({
      resolveSessionPath: () => path,
      issuer: 'http://127.0.0.1:1',
    })

    await expect(resolveGrokAccessToken(runtime)).resolves.toBe('access-live')
  })

  it('throws AUTH when an existing session cannot be refreshed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-llm-grok-token-auth-'))
    const path = join(root, 'grok-oauth.json')
    const auth = await fakeAuthServer({
      authorizationCode: {
        accessToken: 'access-one',
        refreshToken: 'refresh-one',
        expiresIn: 3600,
      },
      refresh: { fail: true },
    })
    await writeSession(path, {
      accessToken: 'access-stale',
      refreshToken: 'refresh-stale',
      expiresAt: new Date(0).toISOString(),
    })
    const runtime = createGrokAuthRuntime({
      resolveSessionPath: () => path,
      issuer: auth.issuer,
    })

    await expect(resolveGrokAccessToken(runtime)).rejects.toMatchObject({ code: 'AUTH' })
  })
})
