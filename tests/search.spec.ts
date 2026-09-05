import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import { WebRuntime } from '@deepseek-ai/dsh-web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelSwitchAdapterRegistry } from 'dsh-model-switch/adapter-registry'
import { installGrokModelSwitchAdapters } from '../src/model-switch-adapter.ts'
import { GROK_CHAT_BASE_URL } from '../src/pi-ai-profile.ts'
import {
  GROK_SEARCH_LABEL,
  GROK_SEARCH_PROVIDER,
  grokSearchModels,
  isSearchableGrokModel,
  mapGrokSearchResponse,
} from '../src/search.ts'
import type { GrokOAuthRuntime } from '../src/oauth.ts'

class Owner extends Service {
  readonly adapters = new ModelSwitchAdapterRegistry()
  constructor(ctx: Context) { super(ctx, 'modelSwitch') }
}

const MODEL = 'grok-4.6'

function responsesPayload(): unknown {
  return {
    id: 'resp_test',
    object: 'response',
    model: MODEL,
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [{
          type: 'output_text',
          text: 'Grok 4.6 is the current model.',
          annotations: [
            { type: 'url_citation', url: 'https://x.ai/news', title: 'xAI News' },
            { type: 'url_citation', url: 'https://x.ai/news', title: 'dup' },
            { type: 'url_citation', url: 'javascript:alert(1)', title: 'xss' },
          ],
        }],
      },
      {
        type: 'web_search_call',
        id: 'ws_1',
        status: 'completed',
        results: [{ url: 'https://example.com/a', title: 'A', snippet: 'one' }],
      },
    ],
  }
}

function stubResponsesFetch(payload: unknown): { calls: { url: string, init: RequestInit }[] } {
  const calls: { url: string, init: RequestInit }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }))
  return { calls }
}

async function fakeRuntime(): Promise<GrokOAuthRuntime> {
  const dir = await mkdtemp(join(tmpdir(), 'grok-search-'))
  const path = join(dir, 'grok-oauth.json')
  await writeFile(path, JSON.stringify({
    accessToken: 'test-access',
    refreshToken: 'test-refresh',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  }))
  return {
    resolveSessionPath: () => path,
    now: () => Date.now(),
    refreshSkewMs: 60_000,
  } as unknown as GrokOAuthRuntime
}

afterEach(() => { vi.unstubAllGlobals() })

describe('grok searchable models', () => {
  it('declares the frozen chat catalog and keeps supportsModel in sync', () => {
    expect(GROK_SEARCH_PROVIDER).toBe('grok')
    expect(GROK_SEARCH_LABEL).toBe('Grok')
    expect(grokSearchModels()).toEqual([
      { id: 'grok-4.6', name: 'Grok 4.6' },
      { id: 'grok-4.5', name: 'Grok 4.5' },
    ])
    expect(isSearchableGrokModel('grok-4.6')).toBe(true)
    expect(isSearchableGrokModel('grok-imagine-image-quality')).toBe(false)
    expect(isSearchableGrokModel('nope')).toBe(false)
  })
})

describe('mapGrokSearchResponse', () => {
  it('keeps output text and unique http citations from annotations and results', () => {
    expect(mapGrokSearchResponse(responsesPayload())).toEqual({
      content: 'Grok 4.6 is the current model.',
      sources: [
        { url: 'https://x.ai/news', title: 'xAI News' },
        { url: 'https://example.com/a', title: 'A', snippet: 'one' },
      ],
      truncated: false,
    })
  })

  it('rejects a payload without a native output array', () => {
    expect(() => mapGrokSearchResponse({ output_text: 'hi' })).toThrow(/without native output/)
  })

  it('fails explicitly when the response carries no citeable evidence', () => {
    expect(() => mapGrokSearchResponse({
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'no citations', annotations: [] }] }],
    })).toThrow(/no native search evidence/)
  })
})

describe('search seam isolation', () => {
  it('never registers or replaces the official web_search tool', async () => {
    const search = await readFile(new URL('../src/search.ts', import.meta.url), 'utf8')
    expect(search).not.toMatch(/registerSearchProvider/)
    expect(search).not.toMatch(/providerDirectory/)
    const adapter = await readFile(new URL('../src/model-switch-adapter.ts', import.meta.url), 'utf8')
    expect(adapter).not.toMatch(/registerSearchProvider/)
    expect(adapter).not.toMatch(/providerDirectory/)
  })

  it('leaves Provider Directory ownership on the client face', async () => {
    const client = await readFile(new URL('../src/client/index.ts', import.meta.url), 'utf8')
    expect(client).toMatch(/providerDirectory/)
  })
})

describe('official WebRuntime selector into the Grok search adapter', () => {
  it('routes ctx.web.search through the registered adapter over the Responses API (network mocked only)', async () => {
    const seen = stubResponsesFetch(responsesPayload())
    const root = new Context()
    const webFiber = root.plugin(WebRuntime, { searchProvider: 'model-switch' })
    await webFiber
    const owner = root.plugin(Owner)
    await owner
    const runtime = await fakeRuntime()
    const provider = root.plugin(ctx => installGrokModelSwitchAdapters(ctx, runtime))
    await provider
    const entry = root.modelSwitch.adapters.get('grok')
    expect(entry?.search?.supportsModel(MODEL)).toBe(true)
    const thin = {
      id: 'model-switch',
      available: () => entry?.search?.supportsModel(MODEL) === true,
      search: (request: { query: string, maxResults?: number }, signal?: AbortSignal) =>
        entry!.search!.search(MODEL, request, signal),
    }
    root.web.registerSearchProvider(thin as never)
    const result = await root.web.search({ query: 'grok 4.6', maxResults: 1 })
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]).toEqual({ url: 'https://x.ai/news', title: 'xAI News' })
    expect(result.truncated).toBe(true)
    expect(result.content).toBe('Grok 4.6 is the current model.')
    expect(seen.calls).toHaveLength(1)
    expect(seen.calls[0]?.url).toBe(GROK_CHAT_BASE_URL + '/responses')
    const init = seen.calls[0]?.init
    expect(init?.method).toBe('POST')
    const headers = init?.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer test-access')
    expect(headers['x-grok-client-version']).toBe('1.0.4')
    expect(headers['x-grok-client-identifier']).toBe('grok-shell')
    const body = JSON.parse(String(init?.body)) as { model?: string, input?: string, tools?: unknown[] }
    expect(body.model).toBe(MODEL)
    expect(body.input).toBe('grok 4.6')
    expect(body.tools).toEqual([{ type: 'web_search' }, { type: 'x_search' }])
    await provider.dispose()
    expect(root.modelSwitch.adapters.get('grok')).toBeUndefined()
    await owner.dispose()
    await webFiber.dispose()
  })

  it('fails unsupported models without touching the network', async () => {
    const seen = stubResponsesFetch(responsesPayload())
    const root = new Context()
    const owner = root.plugin(Owner)
    await owner
    const runtime = await fakeRuntime()
    const provider = root.plugin(ctx => installGrokModelSwitchAdapters(ctx, runtime))
    await provider
    const entry = root.modelSwitch.adapters.get('grok')
    await expect(entry!.search!.search('grok-imagine-image-quality', { query: 'x' }))
      .rejects.toThrow(/unsupported Grok search model/)
    expect(seen.calls).toHaveLength(0)
    await provider.dispose()
    await owner.dispose()
  })
})
