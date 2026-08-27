/**
 * Translate the frozen Grok catalog into the pi-ai profile used for OpenAI
 * Responses against the Grok CLI chat proxy.
 */

import { createRequire } from 'node:module'
import { createProvider } from '@earendil-works/pi-ai'
import type { Model, Provider, ThinkingLevelMap } from '@earendil-works/pi-ai'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type { ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm'
import { GROK_CATALOG, GROK_PROVIDER } from './client-contract.ts'
import type { GrokCatalogModel } from './client-contract.ts'
import { GROK_CLI_REQUEST_HEADERS } from './cli-identity.ts'
import { grokThinkingLevelMap } from './reasoning.ts'
import { grokResponsesApi } from './responses-tools.ts'

/** Chat proxy base used by the Grok CLI (`POST {base}/responses`). */
export const GROK_CHAT_BASE_URL = 'https://cli-chat-proxy.grok.com/v1'
/** Official Grok 4.6 / 4.5 context window; used when a row has none. */
export const GROK_DEFAULT_CONTEXT_WINDOW = 500_000
/** Safe output capability used when the frozen catalog entry has none. */
export const GROK_DEFAULT_MODEL_MAX_TOKENS = 32_768

const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

const { name: PACKAGE_NAME, version: PACKAGE_VERSION } = createRequire(import.meta.url)('../package.json') as {
  name: string
  version: string
}

/** Plugin identity sent beside the required CLI version headers. */
export const GROK_PLUGIN_IDENTITY_HEADER = `${PACKAGE_NAME}/${PACKAGE_VERSION}`

function proxyHeaders(): Record<string, string> {
  return {
    ...GROK_CLI_REQUEST_HEADERS,
    'X-Dsh-Plugin': GROK_PLUGIN_IDENTITY_HEADER,
  }
}

/** Validated connection facts for one chat operation. */
export interface GrokConnectionOptions {
  /** Responses API base, including `/v1`. */
  baseURL: string
  /** Models exposed to the picker and accepted for chat. */
  models: readonly GrokCatalogModel[]
  /** Maximum provider idle time while one stream read is outstanding. */
  streamIdleTimeoutMs: number
  /** Provider-owned model-request retry policy, already resolved. */
  retryPolicy: ResolvedRetryPolicy
}

function thinkingLevelMap(model: GrokCatalogModel): ThinkingLevelMap | undefined {
  if (model.thinking !== true) return undefined
  return grokThinkingLevelMap(model)
}

function toPiAiModel(model: GrokCatalogModel, baseUrl: string): Model<'openai-responses'> {
  const levels = thinkingLevelMap(model)
  return {
    id: model.id,
    name: model.name ?? model.id,
    api: 'openai-responses',
    provider: GROK_PROVIDER,
    baseUrl,
    reasoning: model.thinking === true,
    ...levels === undefined ? {} : { thinkingLevelMap: levels },
    input: model.vision === true ? ['text', 'image'] : ['text'],
    cost: NO_COST,
    contextWindow: model.contextWindow ?? GROK_DEFAULT_CONTEXT_WINDOW,
    maxTokens: model.maxTokens ?? GROK_DEFAULT_MODEL_MAX_TOKENS,
    compat: {
      supportsDeveloperRole: false,
      supportsLongCacheRetention: false,
      supportsStrictMode: false,
      supportsOpenAIGrammarTools: false,
      supportsToolSearch: false,
      supportsExplicitPromptCacheMode: false,
    },
  }
}

/** Harness-authenticated provider auth; the access token is supplied per request. */
function grokAuth(): Provider['auth'] {
  return {
    apiKey: {
      name: 'Grok subscription',
      resolve: ({ credential }) => Promise.resolve({
        auth: credential?.key === undefined ? {} : { apiKey: credential.key },
        source: 'Grok',
      }),
    },
  }
}

/** Resolve the complete pi-ai profile for one Grok options snapshot. */
export function createGrokPiAiProfile(connection: GrokConnectionOptions): ResolvedPiAiProviderProfile {
  const baseURL = connection.baseURL.replace(/\/+$/u, '')
  const source = connection.models.length > 0 ? connection.models : GROK_CATALOG
  const models = source.map(model => toPiAiModel(model, baseURL))
  const configuredMaxTokens = new Map<string, number>()
  const headers = proxyHeaders()
  const piProvider = createProvider({
    id: GROK_PROVIDER,
    name: 'Grok',
    baseUrl: baseURL,
    auth: grokAuth(),
    models,
    api: grokResponsesApi(source),
    headers,
  })
  const profile = {
    provider: GROK_PROVIDER,
    displayName: 'Grok',
    baseURL,
    defaultContextWindow: GROK_DEFAULT_CONTEXT_WINDOW,
    defaultMaxTokens: GROK_DEFAULT_MODEL_MAX_TOKENS,
    defaultInput: ['text'] as 'text'[],
    streamIdleTimeoutMs: connection.streamIdleTimeoutMs,
    retryPolicy: connection.retryPolicy,
    /** Mirrors the official aggregate base64 image limit per request. */
    maxRequestImageBytes: 20 * 1024 * 1024,
    /** Required by the rc.2 resolved-profile contract for deterministic request images. */
    requestImagePixelBudget: 2048 * 2048,
    requestImageMaxBytes: 1024 * 1024,
    piProvider,
    configuredMaxTokens,
    headers,
  }
  return profile
}
