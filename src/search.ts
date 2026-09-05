/**
 * Grok provider-owned independent web search.
 *
 * One search is one non-streaming Responses request against the same CLI
 * chat proxy the chat adapter streams from ({baseURL}/responses), with the
 * same server-side search tools ({ type: 'web_search' }, { type: 'x_search' })
 * and the same subscription access token resolved through the public
 * credential interface (resolveGrokAccessToken). No scraping, no invented
 * sources: only citeable http(s) URLs actually returned by the proxy become
 * WebSearchSource entries, and a response without any such evidence fails
 * instead of returning an empty guess.
 *
 * Failures are explicit: an unlisted model is rejected before any request,
 * a missing session surfaces as WEB_PROVIDER_CREDENTIAL_MISSING, and a
 * native response without citeable evidence is WEB_PROVIDER_ERROR.
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import { GROK_CLI_REQUEST_HEADERS } from './cli-identity.ts'
import { GROK_CATALOG, GROK_PROVIDER } from './client-contract.ts'
import { GROK_CHAT_BASE_URL, GROK_PLUGIN_IDENTITY_HEADER } from './pi-ai-profile.ts'
import { GROK_SERVER_SEARCH_TOOLS } from './responses-tools.ts'

/** Stable provider id shared with the chat route and the Model Switch adapter. */
export const GROK_SEARCH_PROVIDER = GROK_PROVIDER
/** Display label for the agreed Model Switch search-adapter metadata. */
export const GROK_SEARCH_LABEL = 'Grok'

/** Models whose chat proxy requests accept the server-side search tools. */
export function grokSearchModels(): readonly { readonly id: string, readonly name: string }[] {
  return GROK_CATALOG.map(model => ({ id: model.id, name: model.name ?? model.id }))
}

/** Whether model is a chat model the proxy runs server-side search tools for. */
export function isSearchableGrokModel(model: string): boolean {
  return GROK_CATALOG.some(entry => entry.id === model)
}

/** Non-streaming Responses URL for one search request. */
export function grokSearchResponsesURL(baseURL: string = GROK_CHAT_BASE_URL): string {
  return baseURL.replace(/\/+$/u, '') + '/responses'
}

/** One independent search: bearer token plus test overrides. Production uses global fetch. */
export interface GrokSearchProviderOptions {
  /** Bearer access token for one request (public credential interface, never logged). */
  readonly resolveAccessToken: () => Promise<string>
  /** Chat model id; must satisfy isSearchableGrokModel. */
  readonly model: string
  /** Override the proxy base (default GROK_CHAT_BASE_URL). */
  readonly baseURL?: string
  /** Override global fetch in tests. */
  readonly fetchImpl?: typeof fetch
  /** Override {baseURL}/responses in tests. */
  readonly responsesURL?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function citeableUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Map one native Responses body onto the official result vocabulary.
 * Citations come from output_text url_citation annotations and from results
 * arrays on output items (xAI variance tolerance); anything else is ignored.
 * @param value - decoded JSON body from POST {base}/responses.
 */
export function mapGrokSearchResponse(value: unknown): WebSearchResult {
  if (!isRecord(value) || !Array.isArray(value['output'])) {
    throw new WebError('Grok returned a search response without native output', 'WEB_PROVIDER_ERROR')
  }
  const texts: string[] = []
  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  const push = (url: unknown, title?: string, snippet?: string): void => {
    const citeable = citeableUrl(url)
    if (citeable === undefined || seen.has(citeable)) return
    seen.add(citeable)
    sources.push({
      url: citeable,
      ...title === undefined ? {} : { title },
      ...snippet === undefined ? {} : { snippet },
    })
  }
  for (const item of value['output']) {
    if (!isRecord(item)) continue
    const content = item['content']
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!isRecord(block) || block['type'] !== 'output_text') continue
        const text = optionalString(block, 'text')
        if (text !== undefined) texts.push(text)
        const annotations = block['annotations']
        if (!Array.isArray(annotations)) continue
        for (const annotation of annotations) {
          if (!isRecord(annotation) || annotation['type'] !== 'url_citation') continue
          push(annotation['url'], optionalString(annotation, 'title'))
        }
      }
    }
    const results = item['results']
    if (Array.isArray(results)) {
      for (const result of results) {
        if (!isRecord(result)) continue
        push(result['url'], optionalString(result, 'title'), optionalString(result, 'snippet'))
      }
    }
  }
  if (sources.length === 0) {
    throw new WebError(
      'Grok returned no native search evidence; refusing to invent sources',
      'WEB_PROVIDER_ERROR',
    )
  }
  const content = texts.join('\n').trim()
  return {
    ...content.length === 0 ? {} : { content },
    sources,
    truncated: false,
  }
}

function searchAborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('Grok search aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

function throwIfSearchAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw searchAborted(signal)
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation
  if (signal.aborted) return Promise.reject(searchAborted(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(searchAborted(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function providerMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  const error = value['error']
  const raw = typeof error === 'string'
    ? error
    : isRecord(error) && typeof error['message'] === 'string'
      ? error['message']
      : typeof value['message'] === 'string' ? value['message'] : undefined
  return raw?.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, '[REDACTED]').slice(0, 1000)
}

/** Provider-owned search over the CLI chat proxy Responses API. */
export class GrokSearchProvider implements WebSearchProvider {
  readonly id = GROK_SEARCH_PROVIDER

  constructor(private readonly options: GrokSearchProviderOptions) {}

  /** Cheap local check; never touches the network. */
  available(): boolean {
    return this.options.model.length > 0 && isSearchableGrokModel(this.options.model)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    throwIfSearchAborted(signal)
    if (!isSearchableGrokModel(this.options.model)) {
      throw new WebError(
        'unsupported Grok search model: ' + this.options.model,
        'WEB_PROVIDER_ERROR',
      )
    }
    const query = request.query.trim()
    if (query.length === 0) throw new WebError('Grok search query must not be empty', 'WEB_PROVIDER_ERROR')
    let access: string
    try {
      access = await abortable(this.options.resolveAccessToken(), signal)
    } catch (error: unknown) {
      throwIfSearchAborted(signal)
      if (error instanceof WebError) throw error
      if (isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError('Grok search is signed out; sign in from Plugin configuration', 'WEB_PROVIDER_CREDENTIAL_MISSING', { cause: error })
    }
    if (access.length === 0) {
      throw new WebError('Grok search is signed out; sign in from Plugin configuration', 'WEB_PROVIDER_CREDENTIAL_MISSING')
    }
    throwIfSearchAborted(signal)
    const url = this.options.responsesURL ?? grokSearchResponsesURL(this.options.baseURL)
    const fetchImpl = this.options.fetchImpl ?? fetch
    let response: Response
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        redirect: 'error',
        headers: {
          ...GROK_CLI_REQUEST_HEADERS,
          'X-Dsh-Plugin': GROK_PLUGIN_IDENTITY_HEADER,
          authorization: 'Bearer ' + access,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          model: this.options.model,
          input: query,
          tools: [...GROK_SERVER_SEARCH_TOOLS],
        }),
        ...signal === undefined ? {} : { signal },
      })
    } catch (error: unknown) {
      throwIfSearchAborted(signal)
      if (isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError('Grok search request failed', 'WEB_PROVIDER_ERROR', { cause: error })
    }
    let payload: unknown
    try {
      payload = await response.json()
    } catch (error: unknown) {
      throwIfSearchAborted(signal)
      if (isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(
        'Grok returned an unprocessable search response (HTTP ' + String(response.status) + ')',
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }
    if (!response.ok) {
      const detail = providerMessage(payload)
      const message = detail === undefined
        ? 'Grok search failed (HTTP ' + String(response.status) + ')'
        : 'Grok search failed (HTTP ' + String(response.status) + '): ' + detail
      throw new WebError(
        response.status === 401 || response.status === 403
          ? message + '; sign in again'
          : message,
        response.status === 401 || response.status === 403
          ? 'WEB_PROVIDER_CREDENTIAL_MISSING'
          : 'WEB_PROVIDER_ERROR',
      )
    }
    return mapGrokSearchResponse(payload)
  }
}
