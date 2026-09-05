import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createUserMessage, LlmError, ReasoningEffortId, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { GrokAdapter, narrowGrokEscalationSchemas, refreshGrokAccessToken, resolveGrokAccessToken } from '../src/adapter.ts'
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

const FIXED_POLICY = resolveRetryPolicy({ mode: 'normal', maxRetries: 8 }, 'test')
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
    ...opts.refreshApiKey === undefined ? {} : { refreshApiKey: opts.refreshApiKey },
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

  it('does not append a server web_search when a function tool already uses that name', () => {
    expect(injectGrokServerSearchTools({
      model: MODEL_ID,
      tools: [{ type: 'function', name: 'web_search' }],
    })).toEqual({
      model: MODEL_ID,
      tools: [
        { type: 'function', name: 'web_search' },
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

describe('narrowGrokEscalationSchemas', () => {
  const options = (mode: string) => ({
    provider: 'grok',
    model: 'grok-4.6',
    messages: [],
    system: 'Current DSH file policy: ' + mode + '.',
    tools: [{
      name: 'write',
      description: 'write',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          sandbox_permissions: { type: 'string', enum: ['workspace-write', 'danger-full-access'] },
          justification: { type: 'string' },
        },
        required: ['file_path'],
      },
    }],
  })

  it('reads the current mode from a DSH context-injection message', () => {
    const request = options('unknown') as unknown as GenerateOptions
    request.system = 'You are a coding agent.'
    request.messages = [{
      role: 'user',
      content: [{ type: 'text', text: 'Current DSH file policy: workspace-write. Writes are confined.' }],
    }] as never
    const narrowed = narrowGrokEscalationSchemas(request as never)
    expect((narrowed.tools?.[0]?.parameters as any).properties.sandbox_permissions.enum).toEqual(['danger-full-access'])
  })

  it('prefers newest message over stale system (messages-first)', () => {
    const request = options('workspace-write') as unknown as GenerateOptions
    request.messages = [{
      role: 'user',
      content: [{ type: 'text', text: 'Current DSH file policy: read-only. original' }],
    }] as never
    const narrowed = narrowGrokEscalationSchemas(request as never)
    expect((narrowed.tools?.[0]?.parameters as any).properties.sandbox_permissions.enum).toEqual(['workspace-write', 'danger-full-access'])
  })

  it('regression: stale system workspace-write + latest message danger-full-access must remove escalation fields', () => {
    const request = options('workspace-write') as unknown as GenerateOptions
    request.messages = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Current DSH file policy: read-only. old' }],
      } as never,
      {
        role: 'user',
        content: [{ type: 'text', text: 'Current DSH file policy: danger-full-access. latest — stale system must be ignored' }],
      } as never,
    ]
    const narrowed = narrowGrokEscalationSchemas(request as never)
    const parameters = narrowed.tools?.[0]?.parameters as any
    expect(parameters.properties.sandbox_permissions).toBeUndefined()
    expect(parameters.properties.justification).toBeUndefined()
    expect(parameters.required).toEqual(['file_path'])
  })

  it('offers only strictly wider modes to a workspace-write session', () => {
    const original = options('workspace-write') as unknown as GenerateOptions
    const narrowed = narrowGrokEscalationSchemas(original as never)
    expect((narrowed.tools?.[0]?.parameters as any).properties.sandbox_permissions.enum).toEqual(['danger-full-access'])
    expect((narrowed.tools?.[0]?.parameters as any).properties.justification).toBeDefined()
    expect((original.tools[0]?.parameters as any).properties.sandbox_permissions.enum).toEqual(['workspace-write', 'danger-full-access'])
  })

  it('removes impossible escalation fields from a danger-full-access session (system)', () => {
    const narrowed = narrowGrokEscalationSchemas(options('danger-full-access') as never)
    const parameters = narrowed.tools?.[0]?.parameters as any
    expect(parameters.properties.sandbox_permissions).toBeUndefined()
    expect(parameters.properties.justification).toBeUndefined()
    expect(parameters.required).toEqual(['file_path'])
  })

  it('removes impossible escalation fields from a danger-full-access session (messages)', () => {
    const request = {
      provider: 'grok',
      model: 'grok-4.6',
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: 'Current DSH file policy: danger-full-access. Already full.' }],
      }],
      tools: [{
        name: 'write',
        description: 'write',
        parameters: {
          type: 'object',
          properties: {
            file_path: { type: 'string' },
            sandbox_permissions: { type: 'string', enum: ['workspace-write', 'danger-full-access'] },
            justification: { type: 'string' },
          },
          required: ['file_path', 'sandbox_permissions', 'justification'],
        },
      }],
    } as unknown as GenerateOptions
    const narrowed = narrowGrokEscalationSchemas(request as never)
    const parameters = narrowed.tools?.[0]?.parameters as any
    expect(parameters.properties.sandbox_permissions).toBeUndefined()
    expect(parameters.properties.justification).toBeUndefined()
    expect(parameters.required).toEqual(['file_path'])
  })

  it('keeps both wider modes available to a read-only session', () => {
    const narrowed = narrowGrokEscalationSchemas(options('read-only') as never)
    expect((narrowed.tools?.[0]?.parameters as any).properties.sandbox_permissions.enum)
      .toEqual(['workspace-write', 'danger-full-access'])
  })

  it('is immutable and does not mutate original when filtering', () => {
    const original = options('danger-full-access') as unknown as GenerateOptions
    const originalEnum = (original.tools[0]?.parameters as any).properties.sandbox_permissions.enum.slice()
    const narrowed = narrowGrokEscalationSchemas(original as never)
    expect(narrowed).not.toBe(original)
    expect((original.tools[0]?.parameters as any).properties.sandbox_permissions.enum).toEqual(originalEnum)
    expect((original.tools[0]?.parameters as any).properties.justification).toBeDefined()
  })

  it('leaves tools without sandbox_permissions untouched', () => {
    const opts = {
      provider: 'grok',
      model: 'grok-4.6',
      messages: [],
      system: 'Current DSH file policy: workspace-write.',
      tools: [{
        name: 'read',
        description: 'read',
        parameters: {
          type: 'object',
          properties: { file_path: { type: 'string' } },
          required: ['file_path'],
        },
      }],
    } as unknown as GenerateOptions
    const narrowed = narrowGrokEscalationSchemas(opts as never)
    expect(narrowed).toBe(opts)
  })

  it('filters danger-full-access tool via direct stream path (before PiAi injection)', async () => {
    const server = await fakeChatProxy([{ kind: 'json', status: 400, body: { error: { message: 'captured' } } }])
    const a = adapter({ options: () => connection({ baseURL: `${server.url}/v1` }) })
    const esTool = {
      name: 'es_tool',
      description: 'es',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          sandbox_permissions: { type: 'string', enum: ['workspace-write', 'danger-full-access'] },
          justification: { type: 'string' },
        },
        required: ['file_path', 'sandbox_permissions', 'justification'],
      },
    }
    await collect(a.stream(request({
      system: 'Current DSH file policy: danger-full-access.',
      tools: [esTool as never],
    })))
    const body = server.requests[0]?.body as { tools?: Array<{ type?: string, name?: string, parameters?: any }> }
    const sent = body.tools?.find(t => t.name === 'es_tool')
    expect(sent?.parameters.properties.sandbox_permissions).toBeUndefined()
    expect(sent?.parameters.properties.justification).toBeUndefined()
    expect(sent?.parameters.required).toEqual(['file_path'])
    // still injects server tools
    expect(body.tools?.some(t => t.type === 'web_search')).toBe(true)
    expect(body.tools?.some(t => t.type === 'x_search')).toBe(true)
  })

  it('filters via prepareCall stream path as well', async () => {
    const server = await fakeChatProxy([{ kind: 'json', status: 400, body: { error: { message: 'captured' } } }])
    const a = adapter({ options: () => connection({ baseURL: `${server.url}/v1` }) })
    const call = await a.prepareCall('grok', 'grok-4.6')
    const esTool = {
      name: 'es_tool2',
      description: 'es2',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          sandbox_permissions: { type: 'string', enum: ['workspace-write', 'danger-full-access'] },
          justification: { type: 'string' },
        },
        required: ['file_path'],
      },
    }
    await collect(call.stream(request({
      system: 'Current DSH file policy: workspace-write.',
      tools: [esTool as never],
    })))
    const body = server.requests[0]?.body as { tools?: Array<{ type?: string, name?: string, parameters?: any }> }
    const sent = body.tools?.find(t => t.name === 'es_tool2')
    expect(sent?.parameters.properties.sandbox_permissions.enum).toEqual(['danger-full-access'])
  })

  it('also filters when policy is in messages injection (not system)', async () => {
    const server = await fakeChatProxy([{ kind: 'json', status: 400, body: { error: { message: 'captured' } } }])
    const a = adapter({ options: () => connection({ baseURL: `${server.url}/v1` }) })
    const esTool = {
      name: 'es_tool3',
      description: 'es3',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          sandbox_permissions: { type: 'string', enum: ['workspace-write', 'danger-full-access'] },
          justification: { type: 'string' },
        },
        required: ['file_path'],
      },
    }
    await collect(a.stream(request({
      system: 'You are helpful',
      messages: [
        createUserMessage({ content: [{ type: 'text', text: 'Current DSH file policy: danger-full-access. Already max.' }], source: { kind: 'user' } }),
      ],
      tools: [esTool as never],
    })))
    const body = server.requests[0]?.body as { tools?: Array<{ type?: string, name?: string, parameters?: any }> }
    const sent = body.tools?.find(t => t.name === 'es_tool3')
    expect(sent?.parameters.properties.sandbox_permissions).toBeUndefined()
  })

  it('regression: stale system workspace-write ignored when latest message is danger-full-access (stream)', async () => {
    const server = await fakeChatProxy([{ kind: 'json', status: 400, body: { error: { message: 'captured' } } }])
    const a = adapter({ options: () => connection({ baseURL: `${server.url}/v1` }) })
    const esTool = {
      name: 'es_stale',
      description: 'es_stale',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          sandbox_permissions: { type: 'string', enum: ['workspace-write', 'danger-full-access'] },
          justification: { type: 'string' },
        },
        required: ['file_path', 'sandbox_permissions', 'justification'],
      },
    }
    await collect(a.stream(request({
      system: 'Current DSH file policy: workspace-write. stale',
      messages: [
        createUserMessage({ content: [{ type: 'text', text: 'Current DSH file policy: read-only. old' }], source: { kind: 'user' } }),
        createUserMessage({ content: [{ type: 'text', text: 'Current DSH file policy: danger-full-access. latest' }], source: { kind: 'user' } }),
      ],
      tools: [esTool as never],
    })))
    const body = server.requests[0]?.body as { tools?: Array<{ type?: string, name?: string, parameters?: any }> }
    const sent = body.tools?.find(t => t.name === 'es_stale')
    expect(sent?.parameters.properties.sandbox_permissions).toBeUndefined()
    expect(sent?.parameters.properties.justification).toBeUndefined()
    expect(sent?.parameters.required).toEqual(['file_path'])
  })
})

describe('resolveAdapterOptions', () => {
  it('uses the saved displayed catalog, not the frozen account list', () => {
    const options = resolveAdapterOptions({
      models: [{ id: 'grok-4.6', name: 'Grok 4.6', thinking: true, vision: true }],
    })
    expect(options.models.map(model => model.id)).toEqual(['grok-4.6'])
  })

  it('resolves the host default and an explicit eight-retry policy', () => {
    expect(resolveAdapterOptions({}).retryPolicy).toMatchObject({ mode: 'normal', maxRetries: 2 })
    expect(resolveAdapterOptions({
      retryPolicy: { mode: 'normal', maxRetries: 8 },
    }).retryPolicy).toMatchObject({ mode: 'normal', maxRetries: 8 })
    expect(resolveAdapterOptions({ retryPolicy: { mode: 'normal', maxRetries: 8 } }).retryPolicy)
      .toMatchObject({ retryableCodes: expect.arrayContaining(['AUTH', 'RATE_LIMIT', 'TRANSPORT']) })
  })
})

describe('GrokAdapter metadata', () => {
  it('lists frozen catalog models with thinking and vision', async () => {
    const a = adapter({})
    expect(a.providerInfo('grok')).toEqual({ id: 'grok', name: 'Grok' })
    expect(a.providerRetryPolicy('grok')).toBe(FIXED_POLICY)
    expect(a.providerRetryPolicy('grok')).toMatchObject({ mode: 'normal', maxRetries: 8 })
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

  it('exposes neutral image pricing (alpha Host calls adapter method directly)', () => {
    expect(Object.hasOwn(GrokAdapter.prototype, 'imageRequestPricing')).toBe(true)
    const a = adapter({})
    expect(a.imageRequestPricing('grok', 'grok-4.6')).toBeUndefined()
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

  it.each([
    [
      'RATE_LIMIT',
      'The model is currently at capacity due to high demand. Please try again in a few minutes, or use a higher service tier for priority processing: https://docs.x.ai/developers/advanced-api-usage/priority-processing',
    ],
    [
      'SERVER',
      "Service temporarily unavailable. The model's availability is currently degraded.",
    ],
  ])('classifies Grok transient errors as %s', async (code, message) => {
    const server = await fakeChatProxy([{
      kind: 'sse',
      events: [{ type: 'error', code: null, message }],
    }])
    const a = adapter({ options: () => connection({ baseURL: `${server.url}/v1` }) })

    const finish = (await collect(a.stream(request()))).find(chunk => chunk.type === 'finish')

    expect(finish).toMatchObject({
      type: 'finish',
      reason: { kind: 'error', failure: { code, message: `Error Code null: ${message}` } },
    })
  })

  it.each([
    ['PI_AI_ERROR', 'boom'],
    ['QUOTA', 'You have run out of credits or need a Grok subscription'],
  ])('leaves %s failures non-retryable', async (code, message) => {
    const server = await fakeChatProxy([{
      kind: 'sse',
      events: [{ type: 'error', code: null, message }],
    }])
    const a = adapter({ options: () => connection({ baseURL: `${server.url}/v1` }) })

    const finish = (await collect(a.stream(request()))).find(chunk => chunk.type === 'finish')

    expect(finish).toMatchObject({
      type: 'finish',
      reason: { kind: 'error', failure: { code } },
    })
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

  it('force-refreshes a still-valid session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-llm-grok-token-force-'))
    const path = join(root, 'grok-oauth.json')
    const auth = await fakeAuthServer({
      authorizationCode: {
        accessToken: 'access-one',
        refreshToken: 'refresh-one',
        expiresIn: 3600,
      },
      refresh: {
        accessToken: 'access-two',
        refreshToken: 'refresh-two',
        expiresIn: 3600,
      },
    })
    await writeSession(path, {
      accessToken: 'access-live',
      refreshToken: 'refresh-one',
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    })
    const runtime = createGrokAuthRuntime({
      resolveSessionPath: () => path,
      issuer: auth.issuer,
    })

    await expect(refreshGrokAccessToken(runtime)).resolves.toBe('access-two')
  })
})

describe('GrokAdapter AUTH retry', () => {
  it('refreshes and retries a content-less 401 finish', async () => {
    const server = await fakeChatProxy([
      { kind: 'json', status: 401, body: { error: { message: 'Authentication required' } } },
      { kind: 'json', status: 400, body: { error: { message: 'retried' } } },
    ])
    let refreshes = 0
    const a = adapter({
      options: () => connection({ baseURL: `${server.url}/v1` }),
      refreshApiKey: async () => {
        refreshes += 1
        return 'refreshed'
      },
    })

    const finish = (await collect(a.stream(request()))).find(chunk => chunk.type === 'finish')

    expect(refreshes).toBe(1)
    expect(server.requests).toHaveLength(2)
    expect(finish).toMatchObject({
      type: 'finish',
      reason: { kind: 'error', failure: { code: 'INVALID_REQUEST' } },
    })
  })

  it('does not retry 401 when refreshApiKey is omitted', async () => {
    const server = await fakeChatProxy([
      { kind: 'json', status: 401, body: { error: { message: 'Authentication required' } } },
    ])
    const a = adapter({ options: () => connection({ baseURL: `${server.url}/v1` }) })

    const finish = (await collect(a.stream(request()))).find(chunk => chunk.type === 'finish')

    expect(server.requests).toHaveLength(1)
    expect(finish).toMatchObject({
      type: 'finish',
      reason: { kind: 'error', failure: { code: 'AUTH' } },
    })
  })

  it('keeps the AUTH finish when force-refresh throws', async () => {
    const server = await fakeChatProxy([
      { kind: 'json', status: 401, body: { error: { message: 'Authentication required' } } },
    ])
    const a = adapter({
      options: () => connection({ baseURL: `${server.url}/v1` }),
      refreshApiKey: () => Promise.reject(new LlmError('refresh failed', 'AUTH')),
    })

    const finish = (await collect(a.stream(request()))).find(chunk => chunk.type === 'finish')

    expect(server.requests).toHaveLength(1)
    expect(finish).toMatchObject({
      type: 'finish',
      reason: { kind: 'error', failure: { code: 'AUTH' } },
    })
  })

  it('rethrows abort during AUTH refresh instead of yielding AUTH', async () => {
    const server = await fakeChatProxy([
      { kind: 'json', status: 401, body: { error: { message: 'Authentication required' } } },
    ])
    const a = adapter({
      options: () => connection({ baseURL: `${server.url}/v1` }),
      refreshApiKey: () => Promise.reject(Object.assign(new Error('stopped'), { name: 'AbortError' })),
    })

    await expect(collect(a.stream(request()))).rejects.toMatchObject({ name: 'AbortError' })
    expect(server.requests).toHaveLength(1)
  })
})
